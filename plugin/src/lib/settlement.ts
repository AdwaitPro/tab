import { encodeFunctionData, type Address, type Hex } from "viem";

import { findCause } from "./chain.js";
import { assetForFeed, type Bet } from "./escrow.js";
import { tabEscrowAbi } from "./escrowAbi.js";
import { FEEDS } from "./constants.js";
import type { ToolContext } from "./context.js";
import { NetError, ToolError } from "./errors.js";
import { relative } from "./time.js";

// Adapted from shared/findSettlementRound.ts (contracts workstream). Same algorithm and result type; reads are
// parallel `getRoundData` calls instead of Multicall3 so the plugin needs no chain definition, and transport
// failures surface as NetError instead of being mistaken for a missing round.

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
] as const;

export type SettlementRoundResult =
  | { status: "found"; roundId: bigint; answer: bigint; updatedAt: bigint }
  | { status: "not-final"; latestUpdatedAt: bigint }
  | { status: "not-provable"; reason: "phase-boundary" | "missing-round" | "search-limit" }
  | { status: "too-late"; roundId: bigint; updatedAt: bigint }
  | { status: "invalid-price"; roundId: bigint; answer: bigint };

const PHASE_SHIFT = 64n;
const AGGREGATOR_ROUND_MASK = (1n << PHASE_SHIFT) - 1n;

type RoundRead = { ok: true; answer: bigint; updatedAt: bigint } | { ok: false };

async function readRounds(ctx: ToolContext, feed: Address, ids: readonly bigint[]): Promise<RoundRead[]> {
  return Promise.all(ids.map(async (roundId): Promise<RoundRead> => {
    try {
      const r = await ctx.chain.client.readContract({ address: feed, abi: aggregatorAbi, functionName: "getRoundData", args: [roundId] });
      return r[3] !== 0n ? { ok: true, answer: r[1], updatedAt: r[3] } : { ok: false };
    } catch (error) {
      const net = findCause(error, NetError);
      if (net) throw net;
      return { ok: false };
    }
  }));
}

function classify(roundId: bigint, answer: bigint, updatedAt: bigint, resolveAt: bigint, maxStaleness: bigint): SettlementRoundResult {
  if (answer <= 0n) return { status: "invalid-price", roundId, answer };
  if (updatedAt - resolveAt > maxStaleness) return { status: "too-late", roundId, updatedAt };
  return { status: "found", roundId, answer, updatedAt };
}

export async function findSettlementRound(ctx: ToolContext, feed: Address, resolveAt: bigint, maxStaleness: bigint,
  maxSteps = 60, batchSize = 12): Promise<SettlementRoundResult> {
  const [latestId, latestAnswer, , latestUpdatedAt] = await ctx.chain.client.readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" });
  if (latestUpdatedAt < resolveAt) return { status: "not-final", latestUpdatedAt };
  let candidate = { roundId: latestId, answer: latestAnswer, updatedAt: latestUpdatedAt };
  let steps = 0;
  while (steps < maxSteps) {
    const phaseRound = candidate.roundId & AGGREGATOR_ROUND_MASK;
    if (phaseRound <= 1n) return { status: "not-provable", reason: "phase-boundary" };
    const count = BigInt(Math.min(batchSize, maxSteps - steps));
    const available = phaseRound - 1n < count ? phaseRound - 1n : count;
    const ids = Array.from({ length: Number(available) }, (_, i) => candidate.roundId - 1n - BigInt(i));
    const rounds = await readRounds(ctx, feed, ids);
    for (const [i, round] of rounds.entries()) {
      steps += 1;
      if (!round.ok) return { status: "not-provable", reason: "missing-round" };
      if (round.updatedAt < resolveAt) return classify(candidate.roundId, candidate.answer, candidate.updatedAt, resolveAt, maxStaleness);
      const id = ids[i];
      if (id === undefined) return { status: "not-provable", reason: "missing-round" };
      candidate = { roundId: id, answer: round.answer, updatedAt: round.updatedAt };
    }
  }
  return { status: "not-provable", reason: "search-limit" };
}

/** Finds the settlement round and returns `settlePrice(id, roundId)` calldata, or explains when to retry. */
export async function settlementCalldata(ctx: ToolContext, _escrow: Address, id: bigint, bet: Bet): Promise<Hex> {
  const asset = assetForFeed(bet.feed);
  const feed = asset ? FEEDS[asset] : undefined;
  const heartbeat = feed?.heartbeatSeconds ?? 1200;
  const result = await findSettlementRound(ctx, bet.feed, bet.resolveAt, BigInt(feed?.maxStalenessSeconds ?? 3600));
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const refundAt = Number(bet.resolveAt) + 3 * 86_400;
  switch (result.status) {
    case "found":
      return encodeFunctionData({ abi: tabEscrowAbi, functionName: "settlePrice", args: [id, result.roundId] });
    case "not-final": {
      const eta = Number(result.latestUpdatedAt) + heartbeat;
      throw new ToolError("Not final yet: the oracle has not published a price at or after the resolve time.",
        `Retry ${eta > nowSeconds ? relative(eta, nowSeconds) : "in a few minutes"} (feed heartbeat ${heartbeat / 60} min).`);
    }
    case "too-late":
    case "not-provable":
      throw new ToolError(`This bet cannot be settled from the oracle (${result.status === "too-late" ? "the first price after resolve time was too stale" : `round ${result.reason}`}).`,
        `Both stakes can be refunded with bet_action refund ${nowSeconds >= refundAt ? "now" : relative(refundAt, nowSeconds)}.`);
    case "invalid-price":
      throw new ToolError("The oracle's settlement round has an invalid (non-positive) price.", "Use bet_action refund after the 3-day fallback.");
  }
}
