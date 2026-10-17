import "server-only";
import { and, eq } from "drizzle-orm";
import { getAddress, keccak256, stringToBytes, zeroAddress, type Address, type Hex } from "viem";
import { tabEscrowAbi } from "../chain/tab-escrow-abi";
import { publicClient } from "../chain/rpc";
import type { Db } from "../db/client";
import { escrowObjects, terms } from "../db/schema";
import {
  BET_KINDS,
  BET_STATES,
  DEAL_STATES,
  type BetRecord,
  type DealRecord,
  type PriceQuote,
} from "../escrow-types";
import { ApiError } from "./errors";
import { serverEnv } from "./env";
import { isoSeconds } from "./records";

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

export function requireEscrow(): Address {
  const address = serverEnv().escrowAddress;
  if (!address) throw new ApiError("internal", "Escrow not configured", 503);
  return address;
}

const nullable = (a: Address): string | null => (a === zeroAddress ? null : getAddress(a));
const iso = (seconds: bigint): string => isoSeconds(new Date(Number(seconds) * 1000));

async function termsFor(db: Db, hash: Hex): Promise<string | null> {
  const [row] = await db.select().from(terms).where(eq(terms.hash, hash.toLowerCase())).limit(1);
  return row?.body ?? null;
}

async function indexed(db: Db, kind: "deal" | "bet", id: bigint) {
  const [row] = await db
    .select()
    .from(escrowObjects)
    .where(and(eq(escrowObjects.kind, kind), eq(escrowObjects.id, id)))
    .limit(1);
  return row ?? null;
}

/** Decoded `getDeal(id)`; `null` when the id was never created (state None). */
export async function readDeal(db: Db, id: bigint): Promise<DealRecord | null> {
  const address = requireEscrow();
  const d = await publicClient().readContract({ address, abi: tabEscrowAbi, functionName: "getDeal", args: [id] });
  const state = DEAL_STATES[d.state] ?? "None";
  if (state === "None") return null;
  const [body, index] = await Promise.all([termsFor(db, d.termsHash), indexed(db, "deal", id)]);
  return {
    id: id.toString(),
    buyer: getAddress(d.buyer),
    seller: getAddress(d.seller),
    arbiter: nullable(d.arbiter),
    amount_atomic: d.amount.toString(),
    deliver_by: iso(d.deliverBy),
    review_window_seconds: Number(d.reviewWindow),
    delivered_at: d.deliveredAt === 0n ? null : iso(d.deliveredAt),
    disputed_at: d.disputedAt === 0n ? null : iso(d.disputedAt),
    state,
    terms_hash: d.termsHash,
    terms: body,
    created_tx: index?.data.createdTx ?? null,
  };
}

export async function readBet(db: Db, id: bigint): Promise<BetRecord | null> {
  const address = requireEscrow();
  const b = await publicClient().readContract({ address, abi: tabEscrowAbi, functionName: "getBet", args: [id] });
  const state = BET_STATES[b.state] ?? "None";
  if (state === "None") return null;
  const kind = BET_KINDS[b.kind] ?? "Mutual";
  const isPrice = kind === "Price";
  const [body, index, decimals] = await Promise.all([
    termsFor(db, b.termsHash),
    indexed(db, "bet", id),
    isPrice
      ? publicClient().readContract({ address: b.feed, abi: aggregatorAbi, functionName: "decimals" })
      : Promise.resolve(null),
  ]);
  return {
    id: id.toString(),
    kind,
    creator: getAddress(b.creator),
    opponent: nullable(b.opponent),
    arbiter: nullable(b.arbiter),
    stake_atomic: b.stake.toString(),
    join_by: iso(b.joinBy),
    resolve_at: iso(b.resolveAt),
    state,
    feed: isPrice ? getAddress(b.feed) : null,
    threshold: isPrice ? b.threshold.toString() : null,
    feed_decimals: decimals,
    creator_above: isPrice ? b.creatorAbove : null,
    creator_report: nullable(b.creatorReport),
    opponent_report: nullable(b.opponentReport),
    terms_hash: b.termsHash,
    terms: body,
    created_tx: index?.data.createdTx ?? null,
    winner: index?.data.winner ? getAddress(index.data.winner) : null,
    settled_price: index?.data.price ?? null,
  };
}

const HISTORY_ROUNDS = 23;

export async function readPrice(feed: Address): Promise<PriceQuote> {
  const client = publicClient();
  const [round, decimals, description] = await Promise.all([
    client.readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" }),
    client.readContract({ address: feed, abi: aggregatorAbi, functionName: "decimals" }),
    client.readContract({ address: feed, abi: aggregatorAbi, functionName: "description" }),
  ]);
  const ids = Array.from({ length: HISTORY_ROUNDS }, (_, i) => round[0] - BigInt(HISTORY_ROUNDS - i));
  const past = await client
    .multicall({
      contracts: ids.map((id) => ({ address: feed, abi: aggregatorAbi, functionName: "getRoundData" as const, args: [id] as const })),
      allowFailure: true,
    })
    .catch(() => []);
  const history = past
    .flatMap((r) => (r.status === "success" && r.result[3] > 0n ? [{ answer: r.result[1].toString(), updated_at: iso(r.result[3]) }] : []))
    .concat([{ answer: round[1].toString(), updated_at: iso(round[3]) }]);
  return {
    feed: getAddress(feed),
    description,
    answer: round[1].toString(),
    decimals,
    updated_at: iso(round[3]),
    history,
  };
}

export function termsHashMatches(hash: string, body: string): boolean {
  return keccak256(stringToBytes(body)).toLowerCase() === hash.toLowerCase();
}

export async function storeTerms(db: Db, hash: string, body: string): Promise<{ created: boolean; createdAt: Date }> {
  if (!termsHashMatches(hash, body)) throw new ApiError("invalid_input", "hash does not equal keccak256(body)");
  const inserted = await db.insert(terms).values({ hash, body }).onConflictDoNothing().returning();
  if (inserted[0]) return { created: true, createdAt: inserted[0].createdAt };
  const [existing] = await db.select().from(terms).where(eq(terms.hash, hash)).limit(1);
  if (!existing) throw new ApiError("internal", "Terms write failed");
  return { created: false, createdAt: existing.createdAt };
}
