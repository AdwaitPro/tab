import "server-only";
import { and, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { SUFFIX_MAX, SUFFIX_MIN } from "../constants";
import type { Db } from "../db/client";
import { requests, splits, type RequestRow } from "../db/schema";
import { scanForPayment, type TransferSource, type UsdcTransfer } from "../chain/matching";
import { newId } from "../ids";
import { ApiError, isUniqueViolation } from "./errors";
import {
  displayStatus,
  isoSeconds,
  toRequestRecord,
  toSplitRecord,
  type RequestRecord,
  type SplitRecord,
  type StatusRecord,
} from "./records";

/** Open requests stay reserved this long after expiry so a late payment can't match a newer request. */
const EXPIRED_RESERVATION_MS = 7 * 24 * 3600 * 1000;
const MAX_ALLOCATION_ATTEMPTS = 24;

export interface NewRequest {
  recipient: Address;
  amountAtomic: bigint;
  memo: string | null;
  payerLabel: string | null;
  requesterLabel: string | null;
  expiresAt: Date;
  startBlock: bigint;
  splitId?: string | null;
  splitIndex?: number | null;
}

export type RandomInt = (minInclusive: number, maxInclusive: number) => number;

export const cryptoRandomInt: RandomInt = (min, max) => {
  const range = max - min + 1;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return min + (buf[0] % range);
};

/** Free unique amounts held by requests that expired long enough ago. */
async function releaseStale(db: Db, recipient: Address, now: Date): Promise<void> {
  await db
    .update(requests)
    .set({ status: "expired" })
    .where(
      and(
        eq(requests.recipient, recipient),
        eq(requests.status, "open"),
        lt(requests.expiresAt, new Date(now.getTime() - EXPIRED_RESERVATION_MS)),
      ),
    );
}

/**
 * Allocate s ∈ [1, 9999] so that amount + s is unique among the recipient's open requests,
 * then insert. The partial unique index is the real guard: concurrent allocators that pick
 * the same value lose the insert and retry inside a savepoint, so an enclosing split
 * transaction survives the conflict.
 */
export async function insertWithUniqueAmount(
  db: Db,
  input: NewRequest,
  random: RandomInt = cryptoRandomInt,
): Promise<RequestRow> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const taken = await db
      .select({ unique: requests.uniqueAtomic })
      .from(requests)
      .where(
        and(
          eq(requests.recipient, input.recipient),
          eq(requests.status, "open"),
          sql`${requests.uniqueAtomic} between ${(input.amountAtomic + BigInt(SUFFIX_MIN)).toString()} and ${(input.amountAtomic + BigInt(SUFFIX_MAX)).toString()}`,
        ),
      );
    const used = new Set(taken.map((t) => BigInt(t.unique) - input.amountAtomic));
    if (used.size >= SUFFIX_MAX - SUFFIX_MIN + 1) {
      throw new ApiError("conflict", "No unique amount left for this recipient and amount; try a different amount");
    }
    let suffix = BigInt(random(SUFFIX_MIN, SUFFIX_MAX));
    while (used.has(suffix)) suffix = suffix >= BigInt(SUFFIX_MAX) ? BigInt(SUFFIX_MIN) : suffix + 1n;

    try {
      return await db.transaction(async (sp) => {
        const [row] = await sp
          .insert(requests)
          .values({
            id: newId(),
            splitId: input.splitId ?? null,
            splitIndex: input.splitIndex ?? null,
            recipient: input.recipient,
            amountAtomic: input.amountAtomic.toString(),
            uniqueAtomic: (input.amountAtomic + suffix).toString(),
            memo: input.memo,
            payerLabel: input.payerLabel,
            requesterLabel: input.requesterLabel,
            expiresAt: input.expiresAt,
            startBlock: input.startBlock,
            status: "open",
          })
          .returning();
        return row;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new ApiError("conflict", "Could not allocate a unique amount; please retry");
}

export async function createRequest(db: Db, input: NewRequest, now = new Date()): Promise<RequestRecord> {
  await releaseStale(db, input.recipient, now);
  const row = await insertWithUniqueAmount(db, input);
  return toRequestRecord(row, now);
}

export interface NewSplit {
  recipient: Address;
  totalAtomic: bigint;
  memo: string | null;
  requesterLabel: string | null;
  expiresAt: Date;
  startBlock: bigint;
  members: Array<{ payerLabel: string; amountAtomic: bigint }>;
}

export async function createSplit(
  db: Db,
  input: NewSplit,
  now = new Date(),
): Promise<{ split: SplitRecord; requests: RequestRecord[] }> {
  const sum = input.members.reduce((acc, m) => acc + m.amountAtomic, 0n);
  if (sum > input.totalAtomic) throw new ApiError("invalid_input", "Sum of request amounts exceeds total_atomic");
  await releaseStale(db, input.recipient, now);

  return db.transaction(async (tx) => {
    const [split] = await tx
      .insert(splits)
      .values({
        id: newId(),
        recipient: input.recipient,
        totalAtomic: input.totalAtomic.toString(),
        memo: input.memo,
        requesterLabel: input.requesterLabel,
      })
      .returning();
    const rows: RequestRow[] = [];
    for (const [index, member] of input.members.entries()) {
      rows.push(
        await insertWithUniqueAmount(tx, {
          recipient: input.recipient,
          amountAtomic: member.amountAtomic,
          memo: input.memo,
          payerLabel: member.payerLabel,
          requesterLabel: input.requesterLabel,
          expiresAt: input.expiresAt,
          startBlock: input.startBlock,
          splitId: split.id,
          splitIndex: index,
        }),
      );
    }
    return { split: toSplitRecord(split), requests: rows.map((r) => toRequestRecord(r, now)) };
  });
}

export async function getRequestRow(db: Db, id: string): Promise<RequestRow | null> {
  const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  return row ?? null;
}

export async function getSplit(
  db: Db,
  id: string,
  now = new Date(),
): Promise<{ split: SplitRecord; requests: RequestRecord[]; collected_atomic: string; outstanding_atomic: string } | null> {
  const [split] = await db.select().from(splits).where(eq(splits.id, id)).limit(1);
  if (!split) return null;
  const rows = await db.select().from(requests).where(eq(requests.splitId, id)).orderBy(requests.splitIndex);
  const records = rows.map((r) => toRequestRecord(r, now));
  let collected = 0n;
  let outstanding = 0n;
  for (const r of records) {
    if (r.status === "paid" || r.status === "paid_late") collected += BigInt(r.unique_atomic);
    else outstanding += BigInt(r.unique_atomic);
  }
  return {
    split: toSplitRecord(split),
    requests: records,
    collected_atomic: collected.toString(),
    outstanding_atomic: outstanding.toString(),
  };
}

export interface ChainDeps {
  source: TransferSource;
  blockTime: (block: bigint) => Promise<Date>;
  budgetMs?: number;
  floorBlock?: bigint;
}

const STATUS_CACHE_MS = 3000;
const globalForStatus = globalThis as unknown as { __tabStatusCache?: Map<string, { at: number; value: StatusRecord }> };
const statusCache = (globalForStatus.__tabStatusCache ??= new Map());

export function clearStatusCache(): void {
  statusCache.clear();
}

/** Server-side verification of a stored request against Base. Never reports "open" on a partial scan. */
export async function refreshRequestStatus(
  db: Db,
  row: RequestRow,
  chain: ChainDeps,
  now = new Date(),
): Promise<StatusRecord> {
  if (row.status === "paid" || row.status === "paid_late") return statusFromRow(row, now);

  const cached = statusCache.get(row.id);
  if (cached && now.getTime() - cached.at < STATUS_CACHE_MS) return cached.value;

  const recipient = getAddress(row.recipient);
  const result = await scanForPayment({
    source: chain.source,
    recipient,
    uniqueAtomic: BigInt(row.uniqueAtomic),
    startBlock: row.startBlock,
    resumeAfter: row.scannedBlock,
    budgetMs: chain.budgetMs,
    floorBlock: chain.floorBlock,
    isExcluded: async (t) => isTransferAssigned(db, t, row.id),
  });

  let value: StatusRecord;
  if (result.kind === "found") {
    const paidAt = await chain.blockTime(result.transfer.blockNumber).catch(() => null);
    if (!paidAt) {
      value = checking(row.id, now);
    } else {
      const status = paidAt.getTime() > row.expiresAt.getTime() ? "paid_late" : "paid";
      try {
        const [updated] = await db
          .update(requests)
          .set({
            status,
            paidTx: result.transfer.txHash,
            paidLogIndex: result.transfer.logIndex,
            paidBlock: result.transfer.blockNumber,
            paidAt,
            payerAddress: getAddress(result.transfer.from),
            scannedBlock: result.scannedTo,
          })
          .where(and(eq(requests.id, row.id), inArray(requests.status, ["open", "expired"])))
          .returning();
        value = statusFromRow(updated ?? (await getRequestRow(db, row.id)) ?? row, now);
      } catch (error) {
        // Another request claimed this transfer concurrently; the next poll re-scans past it.
        if (!isUniqueViolation(error)) throw error;
        value = checking(row.id, now);
      }
    }
  } else {
    if (row.scannedBlock == null || result.scannedTo > row.scannedBlock) {
      await db.update(requests).set({ scannedBlock: result.scannedTo }).where(eq(requests.id, row.id));
    }
    value =
      result.kind === "partial"
        ? checking(row.id, now)
        : { ...statusFromRow(row, now), status: displayStatus(row, now) };
  }
  statusCache.set(row.id, { at: now.getTime(), value });
  return value;
}

async function isTransferAssigned(db: Db, t: UsdcTransfer, selfId: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.paidTx, t.txHash), eq(requests.paidLogIndex, t.logIndex), ne(requests.id, selfId)))
    .limit(1);
  return Boolean(hit);
}

function checking(id: string, now: Date): StatusRecord {
  return { id, status: "checking", paid_tx: null, paid_at: null, payer_address: null, checked_at: isoSeconds(now) };
}

function statusFromRow(row: RequestRow, now: Date): StatusRecord {
  const record = toRequestRecord(row, now);
  return {
    id: row.id,
    status: record.status,
    paid_tx: record.paid_tx,
    paid_at: record.paid_at,
    payer_address: record.status === "paid" || record.status === "paid_late" ? record.payer_address : null,
    checked_at: isoSeconds(now),
  };
}

/** Status for an offline payload link: chain-only, nothing persisted. */
export async function payloadStatus(
  input: { id: string; recipient: Address; uniqueAtomic: bigint; startBlock: bigint; expiresAt: Date },
  chain: ChainDeps,
  now = new Date(),
): Promise<StatusRecord> {
  const result = await scanForPayment({
    source: chain.source,
    recipient: input.recipient,
    uniqueAtomic: input.uniqueAtomic,
    startBlock: input.startBlock,
    budgetMs: chain.budgetMs,
    floorBlock: chain.floorBlock,
  });
  if (result.kind === "partial") return checking(input.id, now);
  if (result.kind === "not_found") {
    return {
      id: input.id,
      status: input.expiresAt.getTime() <= now.getTime() ? "expired" : "open",
      paid_tx: null,
      paid_at: null,
      payer_address: null,
      checked_at: isoSeconds(now),
    };
  }
  const paidAt = await chain.blockTime(result.transfer.blockNumber).catch(() => null);
  if (!paidAt) return checking(input.id, now);
  return {
    id: input.id,
    status: paidAt.getTime() > input.expiresAt.getTime() ? "paid_late" : "paid",
    paid_tx: result.transfer.txHash as Hex,
    paid_at: isoSeconds(paidAt),
    payer_address: getAddress(result.transfer.from),
    checked_at: isoSeconds(now),
  };
}

export async function attachSignature(db: Db, id: string, signature: Hex): Promise<RequestRecord> {
  const [row] = await db.update(requests).set({ signature }).where(eq(requests.id, id)).returning();
  if (!row) throw new ApiError("not_found", "Request not found");
  return toRequestRecord(row);
}

export async function listRequestsFor(
  db: Db,
  address: Address,
  scope: "open" | "all",
  now = new Date(),
): Promise<{ owedToYou: RequestRecord[]; youOwe: RequestRecord[] }> {
  const openOnly = scope === "open" ? eq(requests.status, "open") : undefined;
  const [owed, owe] = await Promise.all([
    db
      .select()
      .from(requests)
      .where(and(eq(requests.recipient, address), openOnly))
      .orderBy(desc(requests.createdAt))
      .limit(100),
    db
      .select()
      .from(requests)
      .where(and(eq(requests.payerAddress, address), openOnly))
      .orderBy(desc(requests.createdAt))
      .limit(100),
  ]);
  const keep = (r: RequestRecord) => scope === "all" || r.status === "open" || r.status === "checking";
  return {
    owedToYou: owed.map((r) => toRequestRecord(r, now)).filter(keep),
    youOwe: owe.map((r) => toRequestRecord(r, now)).filter(keep),
  };
}

/** Sets payer_address only when unknown; a matched transfer's `from` later overwrites it with chain truth. */
export async function setPayerIfUnknown(db: Db, id: string, payer: Address): Promise<RequestRecord | null> {
  await db
    .update(requests)
    .set({ payerAddress: payer })
    .where(and(eq(requests.id, id), isNull(requests.payerAddress)));
  const row = await getRequestRow(db, id);
  return row ? toRequestRecord(row) : null;
}
