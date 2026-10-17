import "server-only";
import { getAddress } from "viem";
import { findSettlementRound } from "../chain/find-settlement-round";
import { publicClient } from "../chain/rpc";
import { tabEscrowAbi } from "../chain/tab-escrow-abi";
import type { BetRecord } from "../escrow-types";
import { requireEscrow } from "./escrow";

export type SettlementInfo =
  | { status: "found"; round_id: string; answer: string; updated_at: string }
  | { status: "not-final"; latest_updated_at: string }
  | { status: "not-provable" | "too-late" | "invalid-price"; reason: string };

/** Pre-computes the Chainlink round `settlePrice(id, roundId)` needs, so the page never sends a reverting tx. */
export async function settlementFor(bet: BetRecord, now = Date.now()): Promise<SettlementInfo | null> {
  if (bet.kind !== "Price" || bet.state !== "Matched" || !bet.feed) return null;
  const resolveAt = BigInt(Math.floor(new Date(bet.resolve_at).getTime() / 1000));
  if (now / 1000 < Number(resolveAt)) return null;
  const client = publicClient();
  const feed = getAddress(bet.feed);
  const maxStaleness = await client.readContract({
    address: requireEscrow(),
    abi: tabEscrowAbi,
    functionName: "maxStaleness",
    args: [feed],
  });
  const result = await findSettlementRound({ client, feed, resolveAt, maxStaleness: BigInt(maxStaleness) });
  const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  switch (result.status) {
    case "found":
      return { status: "found", round_id: result.roundId.toString(), answer: result.answer.toString(), updated_at: iso(result.updatedAt) };
    case "not-final":
      return { status: "not-final", latest_updated_at: iso(result.latestUpdatedAt) };
    case "not-provable":
      return { status: "not-provable", reason: result.reason };
    case "too-late":
      return { status: "too-late", reason: "first round after resolve time was published too late" };
    case "invalid-price":
      return { status: "invalid-price", reason: "oracle reported a non-positive price" };
  }
}
