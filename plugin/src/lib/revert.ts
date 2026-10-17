import type { Address, Hex } from "viem";

import type { ToolContext } from "./context.js";
import { ToolError } from "./errors.js";

const EXPLANATIONS: Readonly<Record<string, string>> = {
  InvalidAmount: "The amount must be greater than zero.",
  InvalidCounterparty: "The counterparty is not allowed (it is you, zero, or the arbiter).",
  InvalidArbiter: "The arbiter cannot be one of the two parties.",
  InvalidDeadline: "A deadline is in the past or out of order (join deadline must be before resolve time).",
  InvalidReviewWindow: "Review window must be between 1 minute and 30 days.",
  InvalidState: "The deal/bet is not in a state that allows this action.",
  InvalidBps: "seller_bps must be between 0 and 10000.",
  InvalidThreshold: "The price threshold must be positive.",
  InvalidWinner: "The winner must be the creator or the opponent.",
  NotBuyer: "Only the buyer can do this.",
  NotSeller: "Only the seller can do this.",
  NotParty: "Only the buyer/seller (or bet creator/opponent) can do this.",
  NotArbiter: "Only the arbiter can do this.",
  NotCreator: "Only the bet creator can do this.",
  NotInvited: "This bet is reserved for a specific opponent.",
  NoArbiter: "This deal has no arbiter, so it cannot be disputed.",
  TooEarly: "Too early: the time window for this action has not opened yet.",
  TooLate: "Too late: the deadline for this action has passed.",
  JoinClosed: "The join deadline has passed.",
  WrongKind: "That action does not apply to this kind of bet.",
  FeedNotAllowed: "That price feed is not allowlisted in TabEscrow.",
  SequencerDown: "The Base sequencer is down or restarted less than 1 hour ago; prices are not trusted yet. Retry later.",
  InvalidPrice: "The oracle returned an invalid price. Retry later.",
  StalePrice: "The first oracle price after the resolve time arrived too late (stale); this bet can only be refunded (bet_action refund) 3 days after resolve time.",
  PriceNotFinal: "The oracle has not published a price at or after the resolve time yet. Retry in a few minutes (heartbeat ≤ 20 min).",
  NotFirstRound: "That oracle round is not the first one at or after the resolve time; Tab will pick the right round on retry.",
  RoundNotProvable: "The settlement round cannot be proven on-chain (oracle phase change); a refund opens 3 days after resolve time.",
  NothingOwed: "TabEscrow owes this address nothing.",
  ArbitrationNotAllowed: "The arbiter can rule only after conflicting reports or 2 days after the resolve time.",
};

export function explainRevert(errorName: string, message: string, overrides: Readonly<Record<string, string>> = {}): string {
  return overrides[errorName] ?? EXPLANATIONS[errorName] ?? (/allowance/i.test(message) ? "USDC allowance is too low." : /balance/i.test(message) ? "USDC balance is too low." : message);
}

/** eth_call the exact proposal from the caller; a revert becomes a domain error and no proposal is returned. */
export async function simulateOrThrow(ctx: ToolContext, caller: Address, to: Address, data: Hex, what: string,
  overrides: Readonly<Record<string, string>> = {}): Promise<void> {
  const result = await ctx.chain.simulate(caller, { to, data });
  if (!result.ok) {
    throw new ToolError(`${what} would fail on-chain (${result.errorName}): ${explainRevert(result.errorName, result.message, overrides)}`, "No proposal was created.");
  }
}
