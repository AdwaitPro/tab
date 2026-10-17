import "server-only";
import { connection } from "next/server";
import { getAddress } from "viem";
import { getDb } from "../db/client";
import type { BetRecord, DealRecord, PriceQuote } from "../escrow-types";
import { readBet, readDeal, readPrice } from "./escrow";
import { serverEnv } from "./env";
import { settlementFor, type SettlementInfo } from "./settlement";

export type EscrowLookup<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "not_configured" }
  | { kind: "error" };

const ID_RE = /^[1-9][0-9]{0,18}$/;

export async function lookupDeal(id: string): Promise<EscrowLookup<DealRecord>> {
  await connection();
  if (!serverEnv().escrowAddress) return { kind: "not_configured" };
  if (!ID_RE.test(id)) return { kind: "not_found" };
  try {
    const deal = await readDeal(await getDb(), BigInt(id));
    return deal ? { kind: "ok", value: deal } : { kind: "not_found" };
  } catch {
    return { kind: "error" };
  }
}

export type BetWithLive = BetRecord & { price: PriceQuote | null; settlement: SettlementInfo | null };

export async function lookupBet(id: string): Promise<EscrowLookup<BetWithLive>> {
  await connection();
  if (!serverEnv().escrowAddress) return { kind: "not_configured" };
  if (!ID_RE.test(id)) return { kind: "not_found" };
  try {
    const bet = await readBet(await getDb(), BigInt(id));
    if (!bet) return { kind: "not_found" };
    const [price, settlement] = await Promise.all([
      bet.feed ? readPrice(getAddress(bet.feed)).catch(() => null) : null,
      settlementFor(bet).catch(() => null),
    ]);
    return { kind: "ok", value: { ...bet, price, settlement } };
  } catch {
    return { kind: "error" };
  }
}
