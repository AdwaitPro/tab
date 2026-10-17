import { getAddress, type Address, type Hex } from "viem";
import * as z from "zod/v4";

import { nullableAddress, sameAddress } from "./address.js";
import { formatUnitsExact, formatUsdc } from "./amount.js";
import { ASSETS, ESCROW_TIMING, FEEDS, type Asset } from "./constants.js";
import type { ToolContext } from "./context.js";
import { ToolError } from "./errors.js";
import { requireEscrow } from "./config.js";
import { formatWhen, isoSeconds } from "./time.js";
import { quoteUntrusted } from "./sanitize.js";

export const DEAL_STATES = ["None", "Funded", "Delivered", "Released", "Refunded", "Disputed", "Resolved"] as const;
export const BET_STATES = ["None", "Open", "Matched", "Settled", "Refunded"] as const;
export type DealStateName = (typeof DEAL_STATES)[number];
export type BetStateName = (typeof BET_STATES)[number];

export type Role = "buyer" | "seller" | "arbiter" | "party" | "creator" | "opponent" | "anyone" | "joiner";

export interface ActionAvailability {
  action: string;
  by: Role;
  available_now: boolean;
  /** When it becomes possible (ISO), if it is time-gated and not yet open. */
  available_at: string | null;
  note: string;
}

export const actionSchema = z.object({
  action: z.string(),
  by: z.enum(["buyer", "seller", "arbiter", "party", "creator", "opponent", "anyone", "joiner"]),
  available_now: z.boolean(),
  available_at: z.string().nullable(),
  note: z.string(),
}).strict();

export interface Deal {
  buyer: Address;
  seller: Address;
  arbiter: Address;
  amount: bigint;
  deliverBy: bigint;
  reviewWindow: bigint;
  deliveredAt: bigint;
  state: number;
  termsHash: Hex;
  disputedAt: bigint;
}

export interface Bet {
  creator: Address;
  opponent: Address;
  arbiter: Address;
  stake: bigint;
  joinBy: bigint;
  resolveAt: bigint;
  kind: number;
  state: number;
  feed: Address;
  threshold: bigint;
  creatorAbove: boolean;
  creatorReport: Address;
  opponentReport: Address;
  termsHash: Hex;
}

export function dealState(deal: Deal): DealStateName {
  return DEAL_STATES[deal.state] ?? "None";
}

export function betState(bet: Bet): BetStateName {
  return BET_STATES[bet.state] ?? "None";
}

export function assetForFeed(feed: Address): Asset | undefined {
  return ASSETS.find((asset) => sameAddress(FEEDS[asset].address, feed));
}

function gate(action: string, by: Role, open: boolean, at: bigint | null, now: number, note: string): ActionAvailability {
  const timeOk = at === null || BigInt(now) >= at;
  return {
    action,
    by,
    available_now: open && timeOk,
    available_at: open && !timeOk && at !== null ? isoSeconds(at) : null,
    note,
  };
}

/** Mirrors TabEscrow's guards so the agent sees who can do what, and when. The contract remains the authority. */
export function dealActions(deal: Deal, now: number): ActionAvailability[] {
  const state = dealState(deal);
  const funded = state === "Funded";
  const delivered = state === "Delivered";
  const hasArbiter = nullableAddress(deal.arbiter) !== null;
  const actions: ActionAvailability[] = [];
  if (funded) {
    actions.push(gate("deliver", "seller", BigInt(now) < deal.deliverBy, null, now, `Seller marks the work delivered (before ${isoSeconds(deal.deliverBy)}).`));
    actions.push(gate("refund", "buyer", true, deal.deliverBy, now, "Buyer takes the funds back if the seller never delivered by the deadline."));
    actions.push(gate("cancel", "seller", true, null, now, "Seller declines the deal; funds return to the buyer."));
  }
  if (funded || delivered) {
    actions.push(gate("release", "buyer", true, null, now, "Buyer releases the full amount to the seller."));
    // v2: disputes close at deliver_by (before delivery) or at the end of the review window (after delivery).
    const disputeEnds = funded ? deal.deliverBy : deal.deliveredAt + deal.reviewWindow;
    if (hasArbiter) {
      actions.push(gate("dispute", "party", BigInt(now) < disputeEnds, null, now, `Buyer or seller freezes the deal for the arbiter (dispute window closes ${isoSeconds(disputeEnds)}).`));
    }
  }
  if (delivered) {
    actions.push(gate("claim", "seller", true, deal.deliveredAt + deal.reviewWindow, now, "Seller collects if the buyer stays silent through the review window."));
  }
  if (state === "Disputed") {
    actions.push(gate("resolve", "arbiter", true, null, now, "Arbiter splits the funds by seller_bps (0–10000)."));
    actions.push(gate("refund", "party", true, deal.disputedAt + BigInt(ESCROW_TIMING.disputeTimeout), now,
      "If the arbiter never rules, either party can return the funds to the buyer."));
  }
  return actions;
}

export function betActions(bet: Bet, now: number): ActionAvailability[] {
  const state = betState(bet);
  const price = bet.kind === 0;
  const actions: ActionAvailability[] = [];
  if (state === "Open") {
    const invited = nullableAddress(bet.opponent);
    actions.push(gate("join", invited ? "opponent" : "joiner", BigInt(now) < bet.joinBy, null, now,
      invited ? `The invited opponent locks an equal stake before ${isoSeconds(bet.joinBy)}.` : `Anyone except the creator/arbiter can join before ${isoSeconds(bet.joinBy)}.`));
    actions.push(gate("cancel", "creator", true, null, now, "Creator withdraws the stake while nobody has joined."));
  }
  if (state === "Matched") {
    if (price) {
      actions.push(gate("settle", "anyone", true, bet.resolveAt, now, "Anyone settles from the Chainlink price; the winner receives both stakes."));
      actions.push(gate("refund", "anyone", true, bet.resolveAt + BigInt(ESCROW_TIMING.priceRefundDelay), now, "If settlement was impossible for 3 days (oracle down), both stakes are refunded."));
    } else {
      actions.push(gate("report", "party", true, bet.resolveAt, now, "Each side reports the winner; matching reports pay out immediately."));
      if (nullableAddress(bet.arbiter)) {
        const conflict = nullableAddress(bet.creatorReport) !== null && nullableAddress(bet.opponentReport) !== null;
        actions.push(gate("arbitrate", "arbiter", true, conflict ? null : bet.resolveAt + BigInt(ESCROW_TIMING.arbitrationGrace), now,
          "Arbiter picks the winner after conflicting reports, or 2 days after resolve time."));
      }
      actions.push(gate("refund", "anyone", true, bet.resolveAt + BigInt(ESCROW_TIMING.mutualRefundDelay), now, "Unresolved 7 days after resolve time: both stakes are refunded."));
    }
  }
  return actions;
}

export function roleMatches(by: Role, caller: Address, parties: { a: Address; b: Address; arbiter: Address; roleA: Role; roleB: Role }): boolean {
  switch (by) {
    case "anyone":
      return true;
    case "party":
      return sameAddress(caller, parties.a) || sameAddress(caller, parties.b);
    case "arbiter":
      return nullableAddress(parties.arbiter) !== null && sameAddress(caller, parties.arbiter);
    case "joiner":
      return !sameAddress(caller, parties.a) && !sameAddress(caller, parties.arbiter);
    default:
      return (by === parties.roleA && sameAddress(caller, parties.a)) || (by === parties.roleB && sameAddress(caller, parties.b));
  }
}

export const dealViewSchema = z.object({
  id: z.string(),
  url: z.string(),
  state: z.enum(DEAL_STATES),
  buyer: z.string(),
  seller: z.string(),
  arbiter: z.string().nullable(),
  amount: z.string(),
  amount_atomic: z.string(),
  deliver_by: z.string(),
  review_window_seconds: z.number().int(),
  delivered_at: z.string().nullable(),
  terms_hash: z.string(),
  available_actions: z.array(actionSchema),
  alerts: z.array(z.string()),
}).strict();
export type DealView = z.infer<typeof dealViewSchema>;

export const betViewSchema = z.object({
  id: z.string(),
  url: z.string(),
  kind: z.enum(["price", "event"]),
  state: z.enum(BET_STATES),
  creator: z.string(),
  opponent: z.string().nullable(),
  arbiter: z.string().nullable(),
  stake: z.string(),
  stake_atomic: z.string(),
  pot: z.string(),
  join_by: z.string(),
  resolve_at: z.string(),
  price_condition: z.object({
    asset: z.enum(ASSETS).nullable(),
    feed: z.string(),
    threshold: z.string(),
    creator_wins_if: z.string(),
  }).strict().nullable(),
  creator_report: z.string().nullable(),
  opponent_report: z.string().nullable(),
  terms_hash: z.string(),
  available_actions: z.array(actionSchema),
}).strict();
export type BetView = z.infer<typeof betViewSchema>;

export function dealView(base: string, id: bigint, deal: Deal, now: number, viewer?: Address): DealView {
  return {
    id: id.toString(),
    url: `${base}/d/${id.toString()}`,
    state: dealState(deal),
    buyer: getAddress(deal.buyer),
    seller: getAddress(deal.seller),
    arbiter: nullableAddress(deal.arbiter),
    amount: formatUsdc(deal.amount),
    amount_atomic: deal.amount.toString(),
    deliver_by: isoSeconds(deal.deliverBy),
    review_window_seconds: Number(deal.reviewWindow),
    delivered_at: deal.deliveredAt > 0n ? isoSeconds(deal.deliveredAt) : null,
    terms_hash: deal.termsHash,
    available_actions: dealActions(deal, now),
    alerts: dealAlerts(deal, now, viewer),
  };
}

export function betView(base: string, id: bigint, bet: Bet, now: number): BetView {
  const price = bet.kind === 0;
  const asset = price ? assetForFeed(bet.feed) : undefined;
  const decimals = asset ? FEEDS[asset].decimals : 8;
  const threshold = formatUnitsExact(bet.threshold, decimals, 2);
  return {
    id: id.toString(),
    url: `${base}/b/${id.toString()}`,
    kind: price ? "price" : "event",
    state: betState(bet),
    creator: getAddress(bet.creator),
    opponent: nullableAddress(bet.opponent),
    arbiter: nullableAddress(bet.arbiter),
    stake: formatUsdc(bet.stake),
    stake_atomic: bet.stake.toString(),
    pot: formatUsdc(bet.stake * 2n),
    join_by: isoSeconds(bet.joinBy),
    resolve_at: isoSeconds(bet.resolveAt),
    price_condition: price ? {
      asset: asset ?? null,
      feed: bet.feed,
      threshold,
      creator_wins_if: `${asset ? FEEDS[asset].pair : "price"} ${bet.creatorAbove ? "≥" : "<"} ${threshold} at or after ${isoSeconds(bet.resolveAt)}`,
    } : null,
    creator_report: price ? null : nullableAddress(bet.creatorReport),
    opponent_report: price ? null : nullableAddress(bet.opponentReport),
    terms_hash: bet.termsHash,
    available_actions: betActions(bet, now),
  };
}

export async function loadDeal(ctx: ToolContext, id: bigint): Promise<Deal> {
  const deal = await ctx.chain.getDeal(requireEscrow(ctx.config), id) as Deal;
  if (dealState(deal) === "None") throw new ToolError(`Deal ${id.toString()} does not exist on TabEscrow.`, "Check the id (tab_list shows your deals).");
  return deal;
}

export async function loadBet(ctx: ToolContext, id: bigint): Promise<Bet> {
  const bet = await ctx.chain.getBet(requireEscrow(ctx.config), id) as Bet;
  if (betState(bet) === "None") throw new ToolError(`Bet ${id.toString()} does not exist on TabEscrow.`, "Check the id (tab_list shows your bets).");
  return bet;
}

/** Arbiters are chosen unilaterally by the object's creator; whoever joins must know the arbiter can decide everything. */
export function arbiterWarning(arbiter: Address, chosenBy: "creator" | "buyer", pot: string): string | undefined {
  const a = nullableAddress(arbiter);
  return a ? `WARNING: arbiter ${a} was chosen by the ${chosenBy} and can award the whole ${pot} USDC to either side.` : undefined;
}

/**
 * What a joiner is agreeing to, read from on-chain state: their role, exactly when they win, stake, deadlines and
 * any arbiter power. Bet text from the API (terms) is untrusted and quoted; the on-chain fields are authoritative.
 */
export function joinBriefing(bet: Bet, nowSeconds: number, terms?: string): string {
  const pot = formatUsdc(bet.stake * 2n);
  const parts: string[] = [];
  if (bet.kind === 0) {
    const asset = assetForFeed(bet.feed);
    const pair = asset ? FEEDS[asset].pair : `feed ${bet.feed}`;
    const threshold = formatUnitsExact(bet.threshold, asset ? FEEDS[asset].decimals : 8, 2);
    // Creator wins on ≥ when creatorAbove, so the opponent wins on the strict complement.
    const condition = bet.creatorAbove ? `${pair} < ${threshold}` : `${pair} ≥ ${threshold}`;
    parts.push(`You are the OPPONENT: you win if ${condition} at ${formatWhen(bet.resolveAt)} (first Chainlink update at or after that time; a price exactly at the threshold counts for "above").`);
  } else {
    parts.push(`You are the OPPONENT in an event bet: the creator bets the event happens; you win if it does not${terms ? ` (event, user-provided text: ${quoteUntrusted(terms)})` : " (event text unavailable; check the bet page)"}. Both sides report the winner from ${formatWhen(bet.resolveAt)}.`);
  }
  parts.push(`You lock ${formatUsdc(bet.stake)} USDC; the winner receives ${pot} USDC. Join by ${formatWhen(bet.joinBy)}.`);
  const warning = arbiterWarning(bet.arbiter, "creator", pot);
  if (warning) parts.push(warning);
  else if (bet.kind === 1) parts.push("No arbiter: if reports conflict, both stakes are refunded after 7 days.");
  if (Number(bet.resolveAt) - nowSeconds < 3600) {
    parts.push(`CAUTION: the bet resolves in under 1 hour (${formatWhen(bet.resolveAt)}); the creator may already know more about the outcome than you.`);
  }
  return parts.join(" ");
}

export function deliverBriefing(deal: Deal): string {
  const hours = Number(deal.reviewWindow) / 3600;
  const parts = [
    `You are the SELLER of ${formatUsdc(deal.amount)} USDC locked by buyer ${getAddress(deal.buyer)}. Marking delivered (deadline ${formatWhen(deal.deliverBy)}) starts a ${hours} h review window: ` +
      `the buyer can release at any time; once the window ends you can claim the full amount with deal_action claim.`,
  ];
  const warning = arbiterWarning(deal.arbiter, "buyer", formatUsdc(deal.amount));
  if (warning) parts.push(`${warning} Either party can dispute until the review window ends; after that you can claim and no dispute is possible.`);
  return parts.join(" ");
}

/** Time-sensitive notices for a deal, e.g. a seller who should claim before a late dispute. */
export function dealAlerts(deal: Deal, now: number, viewer?: Address): string[] {
  const alerts: string[] = [];
  if (dealState(deal) !== "Delivered") return alerts;
  const claimAt = deal.deliveredAt + deal.reviewWindow;
  const isSeller = viewer ? sameAddress(viewer, deal.seller) : false;
  const who = isSeller ? "You (seller)" : `Seller ${getAddress(deal.seller)}`;
  if (BigInt(now) >= claimAt) {
    alerts.push(`CLAIM NOW: ${who} can claim ${formatUsdc(deal.amount)} USDC; the review window ended ${isoSeconds(claimAt)} and the buyer can no longer dispute.`);
  } else if (isSeller) {
    const dispute = nullableAddress(deal.arbiter) ? " or disputes" : "";
    alerts.push(`You (seller) can claim ${formatUsdc(deal.amount)} USDC from ${formatWhen(claimAt)}; until then the buyer can release${dispute}.`);
  }
  return alerts;
}
