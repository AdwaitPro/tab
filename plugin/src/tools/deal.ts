import type { CallToolResult } from "@modelcontextprotocol/server";
import { encodeFunctionData, keccak256, stringToBytes, type Address, type Hex } from "viem";
import * as z from "zod/v4";

import { checksum, sameAddress, ZERO_ADDRESS } from "../lib/address.js";
import { formatUsdc, parseUsdc } from "../lib/amount.js";
import { approveProposal, checkFunding } from "../lib/approve.js";
import { requireApiBase, requireEscrow } from "../lib/config.js";
import { CHAIN, ESCROW_TIMING, LIMITS } from "../lib/constants.js";
import type { ToolContext } from "../lib/context.js";
import { findCause } from "../lib/chain.js";
import { NetError, ToolError } from "../lib/errors.js";
import { dealActions, dealState, deliverBriefing, loadDeal, roleMatches } from "../lib/escrow.js";
import { tabEscrowAbi } from "../lib/escrowAbi.js";
import { addressInput, isoInput, objectIdInput, usdcInput } from "../lib/inputs.js";
import { log } from "../lib/log.js";
import { dealUrl } from "../lib/refs.js";
import { proposalResult } from "../lib/result.js";
import { simulateOrThrow } from "../lib/revert.js";
import { quoteUntrusted, sanitizeText } from "../lib/sanitize.js";
import { formatWhen, parseIsoSeconds } from "../lib/time.js";
import { evmOutputSchema, proposeEvm } from "../paybox.js";
import { withdrawProposal } from "../lib/withdraw.js";

const MIN_LEAD_SECONDS = 300;

export const dealCreateInput = z.object({
  buyer: addressInput.describe("The paying client's wallet (the PayBox wallet that will sign)."),
  seller: addressInput.describe("The freelancer/seller who gets paid on delivery."),
  amount: usdcInput.describe('USDC to lock, decimal string, e.g. "3".'),
  deliver_by: isoInput.describe('Delivery deadline, ISO-8601 with timezone, e.g. "2026-10-20T18:00:00Z". ≥ 5 min from now.'),
  review_hours: z.number().min(0.0167).max(720).default(48).describe("Hours the buyer has to release/dispute after delivery before the seller may claim (default 48; min ≈ 1 minute)."),
  arbiter: addressInput.optional().describe("Optional neutral arbiter who can split funds if either party disputes."),
  terms: z.string().min(1).max(LIMITS.dealTerms).describe("What is being delivered (≤500 chars). Hashed on-chain; text stored for the deal page."),
}).strict();

export const dealActionInput = z.object({
  deal_id: objectIdInput.optional().describe("On-chain deal id (from tab_list or the /d/<id> link). Required for every action except withdraw."),
  action: z.enum(["deliver", "release", "claim", "refund", "cancel", "dispute", "resolve", "withdraw"]),
  caller: addressInput.describe("The wallet that will sign (must have the right role for the action)."),
  seller_bps: z.number().int().min(0).max(10_000).optional().describe("resolve only: seller's share in basis points (10000 = all to seller)."),
}).strict();

export const dealOutput = evmOutputSchema;

export const dealCreateTool = {
  name: "deal_create",
  title: "Create an escrowed deal",
  description:
    "Lock USDC in the TabEscrow contract on Base for a buyer→seller deal (\"pay this designer 3 USDC when the logo " +
    "is delivered\"). TWO STEPS, one proposal each: if the buyer's USDC allowance for TabEscrow is below amount, this " +
    "returns step 1 = approve EXACTLY amount (never unlimited). After that transaction confirms, call deal_create " +
    "again with IDENTICAL arguments to get step 2 = createDeal, which moves the USDC into escrow. Funds then " +
    "release to the seller via deal_action (release by buyer, or claim by seller after the review window); the " +
    "buyer can refund if nothing is delivered by deliver_by. Pre-simulated; returns isError instead of a failing proposal.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
} as const;

export const dealActionTool = {
  name: "deal_action",
  title: "Act on an escrowed deal",
  description:
    "Advance an escrowed deal on Base. Actions: deliver (seller marks delivered, before the deadline), release " +
    "(buyer pays the seller), claim (seller collects after the review window), refund (buyer, after deliver_by if " +
    "never delivered; or either party long after an unresolved dispute), cancel (seller declines; buyer refunded), " +
    "dispute (either party, only if an arbiter was set, before deliver_by or before the review window ends), resolve " +
    "(arbiter splits by seller_bps), withdraw (collect USDC TabEscrow credited to you when a direct payout failed; no " +
    "deal_id needed). Validates the " +
    "caller's role and timing against on-chain state and simulates first; if it would revert you get isError with " +
    "the reason and when it becomes possible. Returns one contract-call proposal; no allowance needed.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
} as const;

export function reviewSeconds(hours: number): bigint {
  const seconds = BigInt(Math.round(hours * 3600));
  if (seconds < BigInt(ESCROW_TIMING.minReviewWindow)) return BigInt(ESCROW_TIMING.minReviewWindow);
  if (seconds > BigInt(ESCROW_TIMING.maxReviewWindow)) return BigInt(ESCROW_TIMING.maxReviewWindow);
  return seconds;
}

export function termsHash(terms: string): Hex {
  return keccak256(stringToBytes(terms));
}

/** Best effort: the page shows the text when stored; the on-chain hash is what binds the parties. */
async function storeTerms(ctx: ToolContext, hash: Hex, body: string): Promise<boolean> {
  try {
    await ctx.api().storeTerms(hash, body);
    return true;
  } catch (error) {
    if (error instanceof ToolError || findCause(error, NetError)) {
      log("terms", "store_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return false;
    }
    throw error;
  }
}

async function predictId(read: () => Promise<bigint>): Promise<bigint | undefined> {
  try {
    return await read();
  } catch (error) {
    if (findCause(error, NetError)) return undefined;
    throw error;
  }
}

export async function dealCreate(input: z.infer<typeof dealCreateInput>, ctx: ToolContext): Promise<CallToolResult> {
  const escrow = requireEscrow(ctx.config);
  const base = requireApiBase(ctx.config);
  const buyer = checksum(input.buyer, "buyer");
  const seller = checksum(input.seller, "seller");
  const arbiter: Address = input.arbiter ? checksum(input.arbiter, "arbiter") : ZERO_ADDRESS;
  if (sameAddress(buyer, seller)) throw new ToolError("Buyer and seller must be different addresses.");
  if (arbiter !== ZERO_ADDRESS && (sameAddress(arbiter, buyer) || sameAddress(arbiter, seller))) throw new ToolError("The arbiter must be neither buyer nor seller.");
  const amount = parseUsdc(input.amount, ctx.config.maxAtomic);
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const deliverBy = parseIsoSeconds(input.deliver_by, "deliver_by");
  if (deliverBy < nowSeconds + MIN_LEAD_SECONDS) throw new ToolError("deliver_by must be at least 5 minutes in the future.");
  const review = reviewSeconds(input.review_hours);
  const terms = sanitizeText(input.terms, LIMITS.dealTerms);
  if (!terms) throw new ToolError("terms must describe what is being delivered.");
  const hash = termsHash(terms);

  const funding = await checkFunding(ctx, buyer, escrow, amount);
  const retry = "Call deal_create again with identical arguments to get step 2 (createDeal).";
  if (funding.allowance < amount) {
    return approveProposal(escrow, amount, `a deal paying ${seller} on delivery`, retry);
  }

  const data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "createDeal", args: [seller, amount, BigInt(deliverBy), review, arbiter, hash] });
  await simulateOrThrow(ctx, buyer, escrow, data, "createDeal");
  const [stored, nextId] = await Promise.all([storeTerms(ctx, hash, terms), predictId(() => ctx.chain.nextDealId(escrow))]);
  const proposal = proposeEvm({ chain: CHAIN, to: escrow, value: "0", data });
  const link = nextId ? dealUrl(base, nextId) : undefined;
  const explanation =
    `${funding.allowance > 0n ? "Step 2 of 2" : "Single step (allowance already in place)"}: lock exactly ${formatUsdc(amount)} USDC ` +
    `(${amount.toString()} base units) from ${buyer} in TabEscrow (${escrow}) for seller ${seller}. ` +
    `Seller must mark delivered by ${formatWhen(deliverBy)}; after delivery the buyer has ${Number(review) / 3600} h to release or ` +
    `${arbiter === ZERO_ADDRESS ? "the seller may claim" : `dispute (arbiter ${arbiter}) before the seller may claim`}. ` +
    `If never delivered, the buyer can refund after the deadline. Terms (user-provided text): ${quoteUntrusted(terms)} ` +
    `(keccak256 ${hash}). Calls TabEscrow.createDeal; uses the existing exact allowance; grants no new allowance.` +
    (stored ? "" : " Note: the terms text could not be saved to the Tab server; the deal page will show only its hash.");
  return proposalResult(proposal, explanation, {
    summary: `TabEscrow.createDeal locking ${formatUsdc(amount)} USDC for ${seller}${nextId ? ` (expected deal #${nextId.toString()})` : ""}`,
    next_actions: [
      "Show the explanation; the user approves in PayBox.",
      link ? `After confirmation share the deal page ${link} with the seller (id is #${nextId?.toString()} unless another deal was created first; confirm with tab_list).`
        : "After confirmation, find the deal id with tab_list for the buyer.",
      "Seller marks delivered (page or deal_action deliver); then buyer calls deal_action release.",
    ],
    links: link ? { deal: link } : {},
  });
}

const DEAL_FUNCTIONS = {
  deliver: "markDelivered",
  release: "release",
  claim: "claim",
  refund: "refund",
  cancel: "cancelBySeller",
  dispute: "dispute",
  resolve: "resolve",
} as const;

const CONSEQUENCES: Readonly<Record<keyof typeof DEAL_FUNCTIONS, string>> = {
  deliver: "marks the work as delivered and starts the buyer's review window; moves no funds",
  release: "pays the full escrowed amount to the seller; irreversible",
  claim: "pays the full escrowed amount to the seller (review window elapsed)",
  refund: "returns the full escrowed amount to the buyer",
  cancel: "cancels the deal and returns the full escrowed amount to the buyer",
  dispute: "freezes the deal until the arbiter resolves it; moves no funds",
  resolve: "splits the escrowed amount between seller and buyer",
};

export async function dealAction(input: z.infer<typeof dealActionInput>, ctx: ToolContext): Promise<CallToolResult> {
  const escrow = requireEscrow(ctx.config);
  const base = requireApiBase(ctx.config);
  const caller = checksum(input.caller, "caller");
  if (input.action === "withdraw") return withdrawProposal(ctx, caller);
  if (input.deal_id === undefined) throw new ToolError(`${input.action} needs deal_id.`);
  const action = input.action;
  const id = BigInt(input.deal_id);
  const deal = await loadDeal(ctx, id);
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const state = dealState(deal);
  const candidates = dealActions(deal, nowSeconds).filter((a) => a.action === input.action);
  if (candidates.length === 0) {
    throw new ToolError(`Cannot ${input.action} deal #${id.toString()}: it is ${state}.`, `Check tab_status {"ref":"deal:${id.toString()}"} for what is possible.`);
  }
  const parties = { a: deal.buyer, b: deal.seller, arbiter: deal.arbiter, roleA: "buyer" as const, roleB: "seller" as const };
  const allowed = candidates.filter((a) => roleMatches(a.by, caller, parties));
  if (allowed.length === 0) {
    throw new ToolError(`${caller} cannot ${input.action} deal #${id.toString()}: only the ${candidates.map((c) => c.by).join(" or ")} can.`);
  }
  const ready = allowed.find((a) => a.available_now);
  if (!ready) {
    const at = allowed.find((a) => a.available_at)?.available_at;
    throw new ToolError(`Too early to ${input.action} deal #${id.toString()}.`, at ? `Available after ${formatWhen(Math.floor(Date.parse(at) / 1000))}.` : allowed[0]?.note);
  }
  if (input.action === "resolve" && input.seller_bps === undefined) throw new ToolError("resolve needs seller_bps (0–10000).");

  const data = input.action === "resolve"
    ? encodeFunctionData({ abi: tabEscrowAbi, functionName: "resolve", args: [id, input.seller_bps ?? 0] })
    : encodeFunctionData({ abi: tabEscrowAbi, functionName: DEAL_FUNCTIONS[action], args: [id] });
  await simulateOrThrow(ctx, caller, escrow, data, `${input.action} on deal #${id.toString()}`,
    { TooLate: action === "dispute" ? "The dispute window has closed (it ends at deliver_by before delivery, or when the review window ends after delivery)." : "Too late: the deadline for this action has passed." });
  const proposal = proposeEvm({ chain: CHAIN, to: escrow, value: "0", data });
  const link = dealUrl(base, id);
  const split = input.action === "resolve"
    ? (() => {
      const sellerAmount = (deal.amount * BigInt(input.seller_bps ?? 0)) / 10_000n;
      return ` Seller gets ${formatUsdc(sellerAmount)} USDC, buyer gets ${formatUsdc(deal.amount - sellerAmount)} USDC.`;
    })()
    : "";
  const explanation =
    `Calls TabEscrow.${DEAL_FUNCTIONS[action]}(${id.toString()}${input.action === "resolve" ? `, ${input.seller_bps ?? 0}` : ""}) on ${escrow} from ${caller}: ` +
    `${CONSEQUENCES[action]}. Deal #${id.toString()} holds ${formatUsdc(deal.amount)} USDC (buyer ${deal.buyer}, seller ${deal.seller}).${split} ` +
    `Sends no ETH and grants no allowance.` +
    (input.action === "deliver" ? `\n\n${deliverBriefing(deal)}` : "");
  return proposalResult(proposal, explanation, {
    summary: `TabEscrow.${DEAL_FUNCTIONS[action]} on deal #${id.toString()}`,
    next_actions: ["Show the explanation; the user approves in PayBox.", `After confirmation, check tab_status {"ref":"deal:${id.toString()}"}.`],
    links: { deal: link },
  });
}
