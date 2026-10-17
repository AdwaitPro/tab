import { z } from "zod";
import { BET_KINDS, BET_STATES, DEAL_STATES } from "./escrow-types";
import { getJson } from "./api-client";

const nullableStr = z.string().nullable();

export const dealSchema = z.object({
  id: z.string(),
  buyer: z.string(),
  seller: z.string(),
  arbiter: nullableStr,
  amount_atomic: z.string(),
  deliver_by: z.string(),
  review_window_seconds: z.number(),
  delivered_at: nullableStr,
  disputed_at: nullableStr,
  state: z.enum(DEAL_STATES),
  terms_hash: z.string(),
  terms: nullableStr,
  created_tx: nullableStr,
});
export type ClientDeal = z.infer<typeof dealSchema>;

const priceSchema = z
  .object({
    feed: z.string(),
    description: z.string(),
    answer: z.string(),
    decimals: z.number(),
    updated_at: z.string(),
    history: z.array(z.object({ answer: z.string(), updated_at: z.string() })),
  })
  .nullable();

const settlementSchema = z
  .union([
    z.object({ status: z.literal("found"), round_id: z.string(), answer: z.string(), updated_at: z.string() }),
    z.object({ status: z.literal("not-final"), latest_updated_at: z.string() }),
    z.object({ status: z.enum(["not-provable", "too-late", "invalid-price"]), reason: z.string() }),
  ])
  .nullable();

export const betSchema = z.object({
  id: z.string(),
  kind: z.enum(BET_KINDS),
  creator: z.string(),
  opponent: nullableStr,
  arbiter: nullableStr,
  stake_atomic: z.string(),
  join_by: z.string(),
  resolve_at: z.string(),
  state: z.enum(BET_STATES),
  feed: nullableStr,
  threshold: nullableStr,
  feed_decimals: z.number().nullable(),
  creator_above: z.boolean().nullable(),
  creator_report: nullableStr,
  opponent_report: nullableStr,
  terms_hash: z.string(),
  terms: nullableStr,
  created_tx: nullableStr,
  winner: nullableStr,
  settled_price: nullableStr,
  price: priceSchema,
  settlement: settlementSchema,
});
export type ClientBet = z.infer<typeof betSchema>;

export const fetchDeal = (id: string, signal?: AbortSignal) => getJson(`/api/escrow/deals/${id}`, dealSchema, signal);
export const fetchBet = (id: string, signal?: AbortSignal) => getJson(`/api/escrow/bets/${id}`, betSchema, signal);
