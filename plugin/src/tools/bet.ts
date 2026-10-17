import type { CallToolResult } from "@modelcontextprotocol/server";
import { encodeFunctionData, type Address, type Hex } from "viem";
import * as z from "zod/v4";

import { checksum, nullableAddress, sameAddress, ZERO_ADDRESS } from "../lib/address.js";
import { atomicFromDecimal, formatUnitsExact, formatUsdc, parseUsdc } from "../lib/amount.js";
import { approveProposal, checkFunding } from "../lib/approve.js";
import { findCause } from "../lib/chain.js";
import { requireApiBase, requireEscrow } from "../lib/config.js";
import { ASSETS, CHAIN, ESCROW_TIMING, FEEDS, LIMITS } from "../lib/constants.js";
import type { ToolContext } from "../lib/context.js";
import { NetError, ToolError } from "../lib/errors.js";
import { betActions, betState, joinBriefing, loadBet, roleMatches } from "../lib/escrow.js";
import { tabEscrowAbi } from "../lib/escrowAbi.js";
import { addressInput, isoInput, objectIdInput, usdcInput } from "../lib/inputs.js";
import { log } from "../lib/log.js";
import { betUrl } from "../lib/refs.js";
import { proposalResult } from "../lib/result.js";
import { simulateOrThrow } from "../lib/revert.js";
import { quoteUntrusted, sanitizeText } from "../lib/sanitize.js";
import { settlementCalldata } from "../lib/settlement.js";
import { formatWhen, isoSeconds, parseIsoSeconds, relative } from "../lib/time.js";
import { evmOutputSchema, proposeEvm } from "../paybox.js";
import { withdrawProposal } from "../lib/withdraw.js";
import { termsHash } from "./deal.js";

const MIN_RESOLVE_LEAD_SECONDS = 300;
const MIN_JOIN_GAP_SECONDS = ESCROW_TIMING.minJoinGap;

/** resolveAt − joinBy must be ≥ max(10 min, 25% of the time until resolution). */
export function minJoinGap(resolveAt: number, nowSeconds: number): number {
  return Math.max(MIN_JOIN_GAP_SECONDS, Math.ceil((resolveAt - nowSeconds) / 4));
}

export const betCreateInput = z.object({
  creator: addressInput.describe("The bettor creating the bet (the PayBox wallet that will sign)."),
  opponent: addressInput.optional().describe("Invited opponent. Omit to let anyone with the link join."),
  stake: usdcInput.describe('USDC each side locks, decimal string, e.g. "2". Winner receives 2 × stake.'),
  kind: z.enum(["price", "event"]).describe("price: settled by Chainlink ETH/BTC price. event: real-world outcome settled by both parties' reports."),
  join_within_hours: z.number().min(0.0167).max(168).describe("Hours the opponent has to join. Joining must close at least max(10 min, 25% of the time until resolve_at) before resolve_at."),
  resolve_at: isoInput.describe('When the bet resolves, ISO-8601 with timezone, e.g. "2026-10-18T21:00:00+05:30". ≥ 5 min from now.'),
  price: z.object({
    asset: z.enum(ASSETS),
    side: z.enum(["above", "below"]).describe("Creator wins if the price is ≥ threshold (above) or < threshold (below) at resolve_at."),
    threshold: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/).describe('USD price, decimal string, e.g. "4000".'),
  }).strict().optional().describe("Required when kind = price."),
  event: z.object({
    description: z.string().min(1).max(LIMITS.eventDescription).describe("The claim the creator is betting on, e.g. \"India wins the final on Sunday\"."),
    arbiter: addressInput.optional().describe("Optional arbiter who decides if the two reports conflict."),
  }).strict().optional().describe("Required when kind = event."),
}).strict();

export const betActionInput = z.object({
  bet_id: objectIdInput.optional().describe("On-chain bet id (from tab_list or the /b/<id> link). Required for every action except withdraw."),
  action: z.enum(["join", "settle", "report", "arbitrate", "cancel", "refund", "withdraw"]),
  caller: addressInput.describe("The wallet that will sign."),
  winner: addressInput.optional().describe("report/arbitrate only: the address that won (creator or opponent)."),
}).strict();

export const betOutput = evmOutputSchema;

export const betCreateTool = {
  name: "bet_create",
  title: "Create a friendly bet",
  description:
    "If the user names a PayBox @username, resolve it to a Base address with PayBox's resolve_username tool first, then pass the address. " +
    "Create a two-person USDC bet escrowed in TabEscrow on Base. kind=price settles trustlessly from Chainlink " +
    "ETH/USD or BTC/USD (call tab_quote first to choose a threshold); kind=event settles when both sides report " +
    "the same winner (conflicts go to the optional arbiter, otherwise both are refunded after 7 days). TWO STEPS, " +
    "one proposal each: if the creator's USDC allowance for TabEscrow is below stake, this returns step 1 = approve " +
    "EXACTLY stake; after it confirms, call bet_create again with IDENTICAL arguments for step 2 = create (locks " +
    "the stake). The text includes a preview (current price, threshold, side, resolve time in UTC and IST, tie rule). " +
    "Share the bet page link so the opponent can join; if nobody joins in time the creator can cancel for a full refund.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
} as const;

export const betActionTool = {
  name: "bet_action",
  title: "Act on a bet",
  description:
    "Act on a TabEscrow bet on Base. join: the opponent locks an equal stake. TWO STEPS: if their USDC allowance " +
    "is below stake this returns step 1 = approve EXACTLY stake; after it confirms call bet_action join again for " +
    "step 2 = joinBet. settle (anyone, price bets, after resolve time): pays the winner from the Chainlink price; " +
    "pre-checks the oracle and sequencer and tells you when to retry. report (creator/opponent, event bets): " +
    "report the winner address. arbitrate (arbiter). cancel (creator, before anyone joins). refund (anyone, stale " +
    "bets: 3 days after resolve for price, 7 days for event), withdraw (collect USDC TabEscrow credited to you when a " +
    "direct payout failed; no bet_id needed). Validates role/timing and simulates first; returns " +
    "isError with the reason instead of a failing proposal.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
} as const;

async function bestEffort<T>(task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof ToolError || findCause(error, NetError)) {
      log("bet", "best_effort_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return undefined;
    }
    throw error;
  }
}

export async function betCreate(input: z.infer<typeof betCreateInput>, ctx: ToolContext): Promise<CallToolResult> {
  const escrow = requireEscrow(ctx.config);
  const base = requireApiBase(ctx.config);
  const creator = checksum(input.creator, "creator");
  const opponent: Address = input.opponent ? checksum(input.opponent, "opponent") : ZERO_ADDRESS;
  if (sameAddress(creator, opponent)) throw new ToolError("You cannot bet against yourself.");
  const stake = parseUsdc(input.stake, ctx.config.maxAtomic, "stake");
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const resolveAt = parseIsoSeconds(input.resolve_at, "resolve_at");
  if (resolveAt <= nowSeconds + MIN_RESOLVE_LEAD_SECONDS) throw new ToolError("resolve_at must be more than 5 minutes in the future.");
  const joinBy = nowSeconds + Math.max(60, Math.round(input.join_within_hours * 3600));
  if (joinBy > resolveAt) throw new ToolError(`The join window (until ${isoSeconds(joinBy)}) must end by resolve_at (${isoSeconds(resolveAt)}).`, "Shorten join_within_hours or move resolve_at later.");
  // Free-option guard: a late joiner who already knows the likely outcome would win for free. Keep a real gap
  // between the last moment to join and resolution (the v2 contract enforces at least MIN_JOIN_GAP = 600 s).
  const minGap = minJoinGap(resolveAt, nowSeconds);
  if (resolveAt - joinBy < minGap) {
    const maxHours = Math.floor(((resolveAt - minGap - nowSeconds) / 3600) * 100) / 100;
    throw new ToolError(`Joining must close at least ${Math.ceil(minGap / 60)} min before resolve_at so nobody can join once the outcome is nearly known.`,
      maxHours >= 0.0167 ? `Use join_within_hours ≤ ${maxHours} or move resolve_at later.` : "Move resolve_at later.");
  }

  let data: Hex;
  let terms: string;
  let preview: string;
  if (input.kind === "price") {
    if (!input.price || input.event) throw new ToolError("kind=price needs price {asset, side, threshold} and no event.");
    const feed = FEEDS[input.price.asset];
    const threshold = atomicFromDecimal(input.price.threshold, feed.decimals);
    if (threshold <= 0n) throw new ToolError("threshold must be greater than 0.");
    const thresholdText = formatUnitsExact(threshold, feed.decimals, 2);
    const above = input.price.side === "above";
    terms = `${feed.pair} ${above ? ">=" : "<"} ${thresholdText} at ${isoSeconds(resolveAt)}`;
    data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "createPriceBet",
      args: [opponent, stake, BigInt(joinBy), BigInt(resolveAt), feed.address, threshold, above, termsHash(terms)] });
    const round = await ctx.chain.feedRound(feed.address);
    const now = formatUnitsExact(round.answer, round.decimals, 2);
    preview = `${feed.pair} now ${now} (Chainlink on Base, feed ${feed.address}). Creator wins if ${feed.pair} ${above ? "≥" : "<"} ${thresholdText} ` +
      `at ${formatWhen(resolveAt)}; otherwise the opponent wins. Tie rule: a price exactly equal to the threshold counts as "above". ` +
      `Settles at the first oracle update at or after the resolve time (heartbeat ≤ 20 min).`;
  } else {
    if (!input.event || input.price) throw new ToolError("kind=event needs event {description, arbiter?} and no price.");
    const description = sanitizeText(input.event.description, LIMITS.eventDescription);
    if (!description) throw new ToolError("event.description is empty.");
    const arbiter: Address = input.event.arbiter ? checksum(input.event.arbiter, "event.arbiter") : ZERO_ADDRESS;
    if (arbiter !== ZERO_ADDRESS && (sameAddress(arbiter, creator) || sameAddress(arbiter, opponent))) throw new ToolError("The arbiter must not be a bettor.");
    terms = description;
    data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "createMutualBet",
      args: [opponent, stake, BigInt(joinBy), BigInt(resolveAt), arbiter, termsHash(terms)] });
    preview = `Event (user-provided text): ${quoteUntrusted(description)}. Creator bets it happens. From ${formatWhen(resolveAt)} both sides report ` +
      `the winner; matching reports pay out instantly. ` +
      (arbiter === ZERO_ADDRESS
        ? "Conflicting or missing reports: both stakes are refunded after 7 days. Lying cannot steal funds: the worst case is a refund."
        : `Conflicting or missing reports: arbiter ${arbiter} decides (refund for both after 7 days if unresolved). WARNING: the arbiter can award the whole ${formatUsdc(stake * 2n)} USDC pot to either side.`);
  }

  const funding = await checkFunding(ctx, creator, escrow, stake);
  if (funding.allowance < stake) {
    return approveProposal(escrow, stake, `a ${formatUsdc(stake)} USDC bet stake. Preview: ${preview}`,
      "Call bet_create again with identical arguments to get step 2 (create the bet).");
  }
  await simulateOrThrow(ctx, creator, escrow, data, "Creating the bet");
  const [, nextId] = await Promise.all([
    bestEffort(() => ctx.api().storeTerms(termsHash(terms), terms)),
    bestEffort(() => ctx.chain.nextBetId(escrow)),
  ]);
  const link = nextId ? betUrl(base, nextId) : undefined;
  const proposal = proposeEvm({ chain: CHAIN, to: escrow, value: "0", data });
  const explanation =
    `${funding.allowance > 0n ? "Step 2 of 2" : "Single step"}: lock exactly ${formatUsdc(stake)} USDC (${stake.toString()} base units) from ${creator} ` +
    `in TabEscrow (${escrow}) as your stake. ${opponent === ZERO_ADDRESS ? "Anyone with the link" : `Opponent ${opponent}`} can join with an equal stake ` +
    `until ${formatWhen(joinBy)}; the winner receives ${formatUsdc(stake * 2n)} USDC. If nobody joins, cancel for a full refund. ` +
    `Preview: ${preview} Calls TabEscrow.${input.kind === "price" ? "createPriceBet" : "createMutualBet"}; uses the existing exact allowance; grants no new allowance.`;
  return proposalResult(proposal, explanation, {
    summary: `TabEscrow bet: ${formatUsdc(stake)} USDC each, resolves ${isoSeconds(resolveAt)}${nextId ? ` (expected bet #${nextId.toString()})` : ""}`,
    next_actions: [
      "Show the explanation; the user approves in PayBox.",
      link ? `After confirmation share ${link} with the opponent (id #${nextId?.toString()} unless another bet was created first; confirm with tab_list).`
        : "After confirmation, find the bet id with tab_list for the creator.",
      input.kind === "price" ? `After ${isoSeconds(resolveAt)} anyone can call bet_action settle.` : `After ${isoSeconds(resolveAt)} both sides call bet_action report.`,
    ],
    links: link ? { bet: link } : {},
  });
}

const BET_FUNCTIONS = {
  join: "joinBet",
  settle: "settlePrice",
  report: "report",
  arbitrate: "arbitrate",
  cancel: "cancelUnjoined",
  refund: "refundStale",
} as const;

/** Explains sequencer conditions that would make settlePrice revert (SequencerDown), with a retry time. */
async function precheckSequencer(ctx: ToolContext, nowSeconds: number): Promise<void> {
  const sequencer = await ctx.chain.sequencer();
  if (!sequencer.up) throw new ToolError("Base sequencer is reported down; Chainlink prices are not trusted right now.", "Retry later; after 3 days a refund opens.");
  const graceEnds = Number(sequencer.since) + ESCROW_TIMING.sequencerGrace;
  if (nowSeconds <= graceEnds) throw new ToolError("The Base sequencer restarted less than 1 hour ago.", `Retry ${relative(graceEnds + 1, nowSeconds)}.`);
}

export async function betAction(input: z.infer<typeof betActionInput>, ctx: ToolContext): Promise<CallToolResult> {
  const escrow = requireEscrow(ctx.config);
  const base = requireApiBase(ctx.config);
  const caller = checksum(input.caller, "caller");
  if (input.action === "withdraw") return withdrawProposal(ctx, caller);
  if (input.bet_id === undefined) throw new ToolError(`${input.action} needs bet_id.`);
  const action = input.action;
  const id = BigInt(input.bet_id);
  const bet = await loadBet(ctx, id);
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const state = betState(bet);
  const label = `bet #${id.toString()}`;
  const candidates = betActions(bet, nowSeconds).filter((a) => a.action === input.action);
  if (candidates.length === 0) {
    const kindHint = input.action === "settle" && bet.kind === 1 ? " Event bets settle via report, not settle." : input.action === "report" && bet.kind === 0 ? " Price bets settle via settle." : "";
    throw new ToolError(`Cannot ${input.action} ${label}: it is ${state}.${kindHint}`, `Check tab_status {"ref":"bet:${id.toString()}"}.`);
  }
  const parties = { a: bet.creator, b: bet.opponent, arbiter: bet.arbiter, roleA: "creator" as const, roleB: "opponent" as const };
  const allowed = candidates.filter((a) => roleMatches(a.by, caller, parties));
  if (allowed.length === 0) {
    const who = candidates.map((c) => (c.by === "joiner" ? "anyone except the creator/arbiter" : `the ${c.by}`)).join(" or ");
    throw new ToolError(`${caller} cannot ${input.action} ${label}: only ${who} can.`);
  }
  const ready = allowed.find((a) => a.available_now);
  if (!ready) {
    const at = allowed.find((a) => a.available_at)?.available_at;
    throw new ToolError(`Not possible to ${input.action} ${label} right now.`, at ? `Available after ${formatWhen(Math.floor(Date.parse(at) / 1000))}.` : allowed[0]?.note);
  }

  let data: Hex;
  let consequence: string;
  let briefing: string | undefined;
  if (input.action === "join") {
    const terms = bet.kind === 1 ? (await bestEffort(() => ctx.api().getBetTerms(id)))?.terms ?? undefined : undefined;
    briefing = joinBriefing(bet, nowSeconds, sanitizeText(terms, LIMITS.eventDescription));
    const funding = await checkFunding(ctx, caller, escrow, bet.stake);
    if (funding.allowance < bet.stake) {
      return approveProposal(escrow, bet.stake, `joining ${label} with a ${formatUsdc(bet.stake)} USDC stake`,
        `Call bet_action {"bet_id":${id.toString()},"action":"join","caller":"${caller}"} again to get step 2 (joinBet).`, betUrl(base, id), briefing);
    }
    data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "joinBet", args: [id] });
    consequence = `${funding.allowance > 0n ? "Step 2 of 2: " : ""}locks exactly ${formatUsdc(bet.stake)} USDC (${bet.stake.toString()} base units) from ${caller} as the opponent's stake (pot ${formatUsdc(bet.stake * 2n)} USDC); uses the existing exact allowance`;
  } else if (input.action === "settle") {
    await precheckSequencer(ctx, nowSeconds);
    data = await settlementCalldata(ctx, escrow, id, bet);
    consequence = `settles from the Chainlink price and pays ${formatUsdc(bet.stake * 2n)} USDC to the winner (creator ${bet.creator} or opponent ${bet.opponent}); anyone may call it`;
  } else if (input.action === "report" || input.action === "arbitrate") {
    if (!input.winner) throw new ToolError(`${input.action} needs winner (the creator or opponent address).`);
    const winner = checksum(input.winner, "winner");
    if (!sameAddress(winner, bet.creator) && !sameAddress(winner, bet.opponent)) throw new ToolError("winner must be the bet's creator or opponent.");
    data = encodeFunctionData({ abi: tabEscrowAbi, functionName: input.action, args: [id, winner] });
    const other = sameAddress(caller, bet.creator) ? bet.opponentReport : bet.creatorReport;
    consequence = input.action === "report"
      ? `reports ${winner} as the winner; ${nullableAddress(other) && sameAddress(other, winner) ? `matches the other report, so it pays ${formatUsdc(bet.stake * 2n)} USDC to ${winner} now` : "pays out only once the other side reports the same winner"}`
      : `as arbiter, pays ${formatUsdc(bet.stake * 2n)} USDC to ${winner}`;
  } else if (input.action === "cancel") {
    data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "cancelUnjoined", args: [id] });
    consequence = `cancels the unjoined bet and returns ${formatUsdc(bet.stake)} USDC to the creator`;
  } else {
    data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "refundStale", args: [id] });
    consequence = `refunds ${formatUsdc(bet.stake)} USDC to each side (bet could not be resolved in time); anyone may call it`;
  }
  await simulateOrThrow(ctx, caller, escrow, data, `${input.action} on ${label}`);
  const proposal = proposeEvm({ chain: CHAIN, to: escrow, value: "0", data });
  const link = betUrl(base, id);
  return proposalResult(proposal,
    `Calls TabEscrow.${BET_FUNCTIONS[action]} for ${label} on ${escrow} from ${caller}: ${consequence}. Sends no ETH and grants no new allowance.` +
      (briefing ? `\n\nWhat you are agreeing to: ${briefing}` : ""),
    {
      summary: `TabEscrow.${BET_FUNCTIONS[action]} on ${label}`,
      next_actions: ["Show the explanation; the user approves in PayBox.", `After confirmation, check tab_status {"ref":"bet:${id.toString()}"}.`],
      links: { bet: link },
    });
}
