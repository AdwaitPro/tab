import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getAddress, parseEventLogs, zeroAddress, type Address, type Log, type PublicClient } from "viem";
import { blockChunks } from "../chain/matching";
import { logsClient, publicClient } from "../chain/rpc";
import { tabEscrowAbi } from "../chain/tab-escrow-abi";
import type { Db } from "../db/client";
import { chainCursor, escrowObjects, type EscrowKind, type EscrowObjectData } from "../db/schema";
import { serverEnv } from "./env";

export interface IndexedObject {
  kind: EscrowKind;
  id: bigint;
  participants: string[];
  state: string;
  updatedBlock: bigint;
  data: EscrowObjectData;
}

type EscrowEvent = ReturnType<typeof parseEventLogs<typeof tabEscrowAbi>>[number];

const lower = (a: Address): string => a.toLowerCase();
const withParticipant = (list: string[], a: Address): string[] =>
  a === zeroAddress || list.includes(lower(a)) ? list : [...list, lower(a)];

/** Pure reducer from a decoded TabEscrow event to the participant index row. */
export function applyEscrowEvent(current: IndexedObject | null, event: EscrowEvent): IndexedObject | null {
  const block = event.blockNumber ?? 0n;
  const tx = event.transactionHash ?? undefined;
  const base = (kind: EscrowKind, id: bigint): IndexedObject =>
    current ?? { kind, id, participants: [], state: "None", updatedBlock: block, data: {} };
  const next = (obj: IndexedObject, state: string, data: EscrowObjectData = {}, participants = obj.participants) => ({
    ...obj,
    participants,
    state,
    updatedBlock: block,
    data: { ...obj.data, ...data, lastTx: tx },
  });

  switch (event.eventName) {
    case "DealCreated": {
      const { id, buyer, seller, arbiter } = event.args;
      const obj = base("deal", id);
      let p = withParticipant(obj.participants, buyer);
      p = withParticipant(p, seller);
      p = withParticipant(p, arbiter);
      return next(obj, "Funded", { createdTx: tx, buyer: getAddress(buyer), seller: getAddress(seller) }, p);
    }
    case "DealDelivered":
      return next(base("deal", event.args.id), "Delivered");
    case "DealReleased":
    case "DealClaimed":
      return next(base("deal", event.args.id), "Released");
    case "DealRefunded":
      return next(base("deal", event.args.id), "Refunded");
    case "DealDisputed":
      return next(base("deal", event.args.id), "Disputed");
    case "DealResolved":
      return next(base("deal", event.args.id), "Resolved");
    case "BetCreated": {
      const { id, creator, opponent, arbiter } = event.args;
      const obj = base("bet", id);
      let p = withParticipant(obj.participants, creator);
      p = withParticipant(p, opponent);
      p = withParticipant(p, arbiter);
      return next(obj, "Open", { createdTx: tx, creator: getAddress(creator) }, p);
    }
    case "BetJoined": {
      const obj = base("bet", event.args.id);
      return next(
        obj,
        "Matched",
        { opponent: getAddress(event.args.opponent) },
        withParticipant(obj.participants, event.args.opponent),
      );
    }
    case "BetSettled":
      return next(base("bet", event.args.id), "Settled", {
        winner: getAddress(event.args.winner),
        payout: event.args.payout.toString(),
        price: event.args.price.toString(),
      });
    case "BetRefunded":
    case "BetCancelled":
      return next(base("bet", event.args.id), "Refunded");
    case "BetReported":
    case "PriceBetTerms":
      return current ? { ...current, updatedBlock: block } : null;
    default:
      return current;
  }
}

const cursorName = (escrow: Address) => `tab_escrow:${escrow.toLowerCase()}`;
const MAX_CHUNKS_PER_RUN = 15;

export interface IndexRunResult {
  configured: boolean;
  fromBlock: string | null;
  toBlock: string | null;
  events: number;
  upserts: number;
  caughtUp: boolean;
}

/** Pull TabEscrow events since the cursor into escrow_objects. Bounded per run; safe to call concurrently. */
export async function indexEscrow(
  db: Db,
  options: { client?: PublicClient; budgetMs?: number } = {},
): Promise<IndexRunResult> {
  const { escrowAddress, escrowStartBlock } = serverEnv();
  if (!escrowAddress) return { configured: false, fromBlock: null, toBlock: null, events: 0, upserts: 0, caughtUp: false };
  const client = options.client ?? publicClient();
  const logSource = options.client ?? logsClient();
  const deadline = Date.now() + (options.budgetMs ?? 8000);

  const head = await client.getBlockNumber({ cacheTime: 1000 });
  const [cursor] = await db.select().from(chainCursor).where(eq(chainCursor.name, cursorName(escrowAddress))).limit(1);
  const from = cursor ? cursor.block + 1n : (escrowStartBlock ?? (head > 2000n ? head - 2000n : 0n));
  if (from > head) {
    return { configured: true, fromBlock: from.toString(), toBlock: head.toString(), events: 0, upserts: 0, caughtUp: true };
  }

  const chunks = blockChunks(from, head).slice(0, MAX_CHUNKS_PER_RUN);
  const logs: Log[] = [];
  let scannedTo = from - 1n;
  for (const [a, b] of chunks) {
    if (Date.now() >= deadline) break;
    try {
      logs.push(...(await logSource.getLogs({ address: escrowAddress, fromBlock: a, toBlock: b })));
    } catch {
      break;
    }
    scannedTo = b;
  }
  if (scannedTo < from) {
    return { configured: true, fromBlock: from.toString(), toBlock: null, events: 0, upserts: 0, caughtUp: false };
  }

  const events = parseEventLogs({ abi: tabEscrowAbi, logs, strict: true }).sort((x, y) =>
    x.blockNumber === y.blockNumber ? (x.logIndex ?? 0) - (y.logIndex ?? 0) : x.blockNumber < y.blockNumber ? -1 : 1,
  );

  const upserts = await db.transaction(async (tx) => {
    const touched = new Map<string, IndexedObject | null>();
    const keyOf = (kind: EscrowKind, id: bigint) => `${kind}:${id.toString()}`;
    const ids = { deal: new Set<bigint>(), bet: new Set<bigint>() };
    for (const e of events) {
      if ("id" in e.args) ids[e.eventName.startsWith("Deal") ? "deal" : "bet"].add(e.args.id);
    }
    for (const kind of ["deal", "bet"] as const) {
      if (ids[kind].size === 0) continue;
      const rows = await tx
        .select()
        .from(escrowObjects)
        .where(and(eq(escrowObjects.kind, kind), inArray(escrowObjects.id, [...ids[kind]])));
      for (const r of rows) touched.set(keyOf(kind, r.id), r);
    }
    for (const e of events) {
      if (!("id" in e.args)) continue;
      const kind: EscrowKind = e.eventName.startsWith("Deal") ? "deal" : "bet";
      const key = keyOf(kind, e.args.id);
      touched.set(key, applyEscrowEvent(touched.get(key) ?? null, e));
    }
    let written = 0;
    for (const obj of touched.values()) {
      if (!obj || obj.state === "None") continue;
      await tx
        .insert(escrowObjects)
        .values(obj)
        .onConflictDoUpdate({
          target: [escrowObjects.kind, escrowObjects.id],
          set: { participants: obj.participants, state: obj.state, updatedBlock: obj.updatedBlock, data: obj.data },
        });
      written++;
    }
    await tx
      .insert(chainCursor)
      .values({ name: cursorName(escrowAddress), block: scannedTo })
      .onConflictDoUpdate({
        target: chainCursor.name,
        set: { block: sql`greatest(${chainCursor.block}, ${scannedTo.toString()}::bigint)` },
      });
    return written;
  });

  return {
    configured: true,
    fromBlock: from.toString(),
    toBlock: scannedTo.toString(),
    events: events.length,
    upserts,
    caughtUp: scannedTo >= head,
  };
}

export async function escrowObjectsFor(db: Db, address: Address, kind: EscrowKind) {
  return db
    .select()
    .from(escrowObjects)
    .where(and(eq(escrowObjects.kind, kind), sql`${lower(address)} = any(${escrowObjects.participants})`))
    .orderBy(sql`${escrowObjects.id} desc`)
    .limit(50);
}
