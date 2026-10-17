import type { Address, PublicClient } from "viem";

/**
 * Locates the Chainlink round that `TabEscrow.settlePrice(id, roundId)` will accept: the first round of `feed`
 * with `updatedAt >= resolveAt`, whose predecessor (same phase) has `updatedAt < resolveAt`.
 *
 * Mirrors the on-chain proof so callers can pre-check and explain outcomes instead of sending a reverting tx.
 */

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

export type SettlementRound = {
  status: "found";
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
};

export type SettlementRoundResult =
  | SettlementRound
  /** No round at/after resolveAt yet: retry after the next heartbeat. */
  | { status: "not-final"; latestUpdatedAt: bigint }
  /**
   * The first round cannot be proven on-chain (phase boundary, missing predecessor, or beyond the search bound).
   * Settlement is impossible; `refundStale` applies after resolveAt + 3 days.
   */
  | { status: "not-provable"; reason: "phase-boundary" | "missing-round" | "search-limit" }
  /** The first round landed more than `maxStaleness` after resolveAt; the contract reverts `StalePrice`. */
  | { status: "too-late"; roundId: bigint; updatedAt: bigint }
  /** The first round carries a non-positive answer; the contract reverts `InvalidPrice`. */
  | { status: "invalid-price"; roundId: bigint; answer: bigint };

/** Only the reads used here, so chain-specific clients (e.g. Base, with deposit txs) are accepted as-is. */
export type SettlementRoundClient = Pick<PublicClient, "readContract" | "multicall">;

export type FindSettlementRoundParams = {
  client: SettlementRoundClient;
  feed: Address;
  /** Bet `resolveAt`, unix seconds. */
  resolveAt: bigint;
  /** `TabEscrow.maxStaleness(feed)`; when given, rounds published too late are reported as `too-late`. */
  maxStaleness?: bigint;
  /** Upper bound on rounds walked back from the latest one. */
  maxSteps?: number;
  /** Rounds fetched per multicall batch. */
  batchSize?: number;
};

const PHASE_SHIFT = 64n;
const AGGREGATOR_ROUND_MASK = (1n << PHASE_SHIFT) - 1n;

type RoundRead = { ok: true; answer: bigint; updatedAt: bigint } | { ok: false };

async function readRounds(client: SettlementRoundClient, feed: Address, ids: readonly bigint[]): Promise<RoundRead[]> {
  const contracts = ids.map((roundId) => ({
    address: feed,
    abi: aggregatorAbi,
    functionName: "getRoundData" as const,
    args: [roundId] as const,
  }));
  const results = await client.multicall({ contracts, allowFailure: true });
  return results.map((r) =>
    r.status === "success" && r.result[3] !== 0n
      ? { ok: true, answer: r.result[1], updatedAt: r.result[3] }
      : { ok: false },
  );
}

function classify(
  roundId: bigint,
  answer: bigint,
  updatedAt: bigint,
  resolveAt: bigint,
  maxStaleness: bigint | undefined,
): SettlementRoundResult {
  if (answer <= 0n) return { status: "invalid-price", roundId, answer };
  if (maxStaleness !== undefined && updatedAt - resolveAt > maxStaleness) {
    return { status: "too-late", roundId, updatedAt };
  }
  return { status: "found", roundId, answer, updatedAt };
}

export async function findSettlementRound({
  client,
  feed,
  resolveAt,
  maxStaleness,
  maxSteps = 200,
  batchSize = 25,
}: FindSettlementRoundParams): Promise<SettlementRoundResult> {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError("maxSteps must be a positive integer");
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError("batchSize must be a positive integer");

  const [latestId, latestAnswer, , latestUpdatedAt] = await client.readContract({
    address: feed,
    abi: aggregatorAbi,
    functionName: "latestRoundData",
  });
  if (latestUpdatedAt < resolveAt) return { status: "not-final", latestUpdatedAt };

  // Invariant while walking: `candidate` has updatedAt >= resolveAt; we look for its predecessor below resolveAt.
  let candidate = { roundId: latestId, answer: latestAnswer, updatedAt: latestUpdatedAt };
  let steps = 0;
  while (steps < maxSteps) {
    const phaseRound = candidate.roundId & AGGREGATOR_ROUND_MASK;
    if (phaseRound <= 1n) return { status: "not-provable", reason: "phase-boundary" };

    // Predecessors of the candidate, nearest first, never crossing into the previous phase.
    const count = BigInt(Math.min(batchSize, maxSteps - steps));
    const available = phaseRound - 1n < count ? phaseRound - 1n : count;
    const ids = Array.from({ length: Number(available) }, (_, i) => candidate.roundId - 1n - BigInt(i));
    const rounds = await readRounds(client, feed, ids);

    for (const [i, round] of rounds.entries()) {
      steps += 1;
      if (!round.ok) return { status: "not-provable", reason: "missing-round" };
      if (round.updatedAt < resolveAt) {
        return classify(candidate.roundId, candidate.answer, candidate.updatedAt, resolveAt, maxStaleness);
      }
      candidate = { roundId: ids[i]!, answer: round.answer, updatedAt: round.updatedAt };
    }
  }
  return { status: "not-provable", reason: "search-limit" };
}
