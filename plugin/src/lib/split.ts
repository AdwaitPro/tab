import { ToolError } from "./errors.js";

export type SplitMode = "equal" | "custom" | "weighted";

export interface SplitParticipant {
  /** Exact custom amount in atomic USDC (custom mode). */
  amount?: bigint | undefined;
  /** Weight scaled by 1e6 (weighted mode). */
  weight?: bigint | undefined;
}

export interface SplitInput {
  total: bigint;
  participants: readonly SplitParticipant[];
  includeSelf: boolean;
  /** Tip in basis points of `total` (0..5000). */
  tipBps: bigint;
}

export interface SplitResult {
  mode: SplitMode;
  /** One share per participant, same order as the input. */
  shares: bigint[];
  /** What the requester keeps as their own share (never requested from anyone). */
  selfShare: bigint;
  /** total + tip; always equals Σshares + selfShare. */
  grandTotal: bigint;
}

export const WEIGHT_SCALE = 1_000_000n;

export function splitMode(participants: readonly SplitParticipant[]): SplitMode {
  const withAmount = participants.filter((p) => p.amount !== undefined).length;
  const withWeight = participants.filter((p) => p.weight !== undefined).length;
  if (withAmount > 0 && withWeight > 0) throw new ToolError("Use either amount or weight for participants, not both.");
  if (withAmount > 0 && withAmount !== participants.length) throw new ToolError("Custom split: set amount for every participant (or for none).");
  if (withWeight > 0 && withWeight !== participants.length) throw new ToolError("Weighted split: set weight for every participant (or for none).");
  return withAmount > 0 ? "custom" : withWeight > 0 ? "weighted" : "equal";
}

/**
 * Exact atomic split by the largest-remainder method: Σshares + selfShare == total + tip, always.
 * When the requester has a share (include_self, or the remainder of a custom split) they absorb all rounding;
 * otherwise leftover units go to the largest fractional remainders, ties broken by position (deterministic).
 */
export function computeSplit(input: SplitInput): SplitResult {
  const { total, participants, includeSelf, tipBps } = input;
  if (total <= 0n) throw new ToolError("total must be greater than 0.");
  if (participants.length === 0) throw new ToolError("Add at least one participant.");
  if (tipBps < 0n || tipBps > 5_000n) throw new ToolError("tip_percent must be between 0 and 50.");
  const mode = splitMode(participants);

  let weights: bigint[];
  let selfWeight: bigint | undefined;
  if (mode === "custom") {
    weights = participants.map((p) => p.amount ?? 0n);
    if (weights.some((w) => w <= 0n)) throw new ToolError("Custom amounts must each be greater than 0.");
    const sum = weights.reduce((a, b) => a + b, 0n);
    if (sum > total) throw new ToolError("Custom amounts add up to more than the total.", "Lower the amounts or raise total.");
    selfWeight = total - sum;
  } else if (mode === "weighted") {
    weights = participants.map((p) => p.weight ?? 0n);
    if (weights.some((w) => w < 0n)) throw new ToolError("Weights must be ≥ 0.");
    selfWeight = includeSelf ? WEIGHT_SCALE : undefined;
  } else {
    weights = participants.map(() => 1n);
    selfWeight = includeSelf ? 1n : undefined;
  }

  const all = selfWeight === undefined ? weights : [...weights, selfWeight];
  const weightSum = all.reduce((a, b) => a + b, 0n);
  if (weightSum <= 0n) throw new ToolError("All weights are zero; nothing to split.");

  const grandTotal = total + (total * tipBps + 5_000n) / 10_000n;
  const floors = all.map((w) => (w * grandTotal) / weightSum);
  const remainders = all.map((w) => (w * grandTotal) % weightSum);
  let leftover = grandTotal - floors.reduce((a, b) => a + b, 0n);

  if (selfWeight !== undefined) {
    floors[floors.length - 1] = (floors[floors.length - 1] ?? 0n) + leftover;
    leftover = 0n;
  } else {
    const order = remainders.map((r, i) => ({ r, i })).sort((x, y) => (x.r === y.r ? x.i - y.i : x.r > y.r ? -1 : 1));
    for (const { i } of order) {
      if (leftover === 0n) break;
      floors[i] = (floors[i] ?? 0n) + 1n;
      leftover -= 1n;
    }
  }

  const shares = floors.slice(0, participants.length);
  const selfShare = selfWeight === undefined ? 0n : floors[floors.length - 1] ?? 0n;
  const zeroIndex = shares.findIndex((s) => s <= 0n);
  if (zeroIndex >= 0) throw new ToolError(`Participant #${zeroIndex + 1}'s share rounds to 0 USDC.`, "Remove them or raise their weight.");
  return { mode, shares, selfShare, grandTotal };
}

/** Converts a JSON number weight (0..1000, ≤ 6 decimals) to a 1e6-scaled integer without float accumulation. */
export function scaleWeight(weight: number): bigint {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) throw new ToolError("weight must be between 0 and 1000.");
  const scaled = Math.round(weight * 1_000_000);
  if (Math.abs(scaled - weight * 1_000_000) > 1e-3) throw new ToolError("weight supports at most 6 decimal places.");
  return BigInt(scaled);
}

/** tip_percent (0..50, ≤ 2 decimals) → basis points. */
export function tipToBps(tipPercent: number): bigint {
  if (!Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 50) throw new ToolError("tip_percent must be between 0 and 50.");
  const bps = Math.round(tipPercent * 100);
  if (Math.abs(bps - tipPercent * 100) > 1e-6) throw new ToolError("tip_percent supports at most 2 decimal places.");
  return BigInt(bps);
}
