import type { CallToolResult } from "@modelcontextprotocol/server";
import { encodeFunctionData, erc20Abi } from "viem";
import * as z from "zod/v4";

import { checksum, sameAddress, shortAddress } from "../lib/address.js";
import { formatUnitsExact, formatUsdc } from "../lib/amount.js";
import { requireApiBase } from "../lib/config.js";
import { bestEffortSetPayer } from "../lib/payer.js";
import { CHAIN, DEPOSIT_URL, EXPLORER_TX, USDC } from "../lib/constants.js";
import type { ToolContext } from "../lib/context.js";
import { NetError, ToolError } from "../lib/errors.js";
import { findCause } from "../lib/chain.js";
import { addressInput } from "../lib/inputs.js";
import { parseRef } from "../lib/refs.js";
import { checkSignature, resolveRequest, verifyRequests, type ResolvedRequest } from "../lib/requests.js";
import { proposalResult } from "../lib/result.js";
import { quoteUntrusted } from "../lib/sanitize.js";
import { isoSeconds } from "../lib/time.js";
import { evmOutputSchema, proposeEvm } from "../paybox.js";

// A USDC transfer on Base costs ~45–65k gas; 150k plus a flat L1-data allowance keeps the check conservative.
const TRANSFER_GAS = 150_000n;
const L1_FEE_ALLOWANCE_WEI = 100_000_000_000n;

export const payInput = z.object({
  link_or_id: z.string().min(1).max(2100).describe("The Tab request link (…/r/<id>), its id, or an offline p.… id."),
  sender: addressInput.describe("The payer's own wallet address (the PayBox EVM wallet that will sign)."),
}).strict();

export const payOutput = evmOutputSchema;

export const payTool = {
  name: "tab_pay",
  title: "Pay a Tab request",
  description:
    "Pay a Tab payment request link with USDC on Base. Use when the user says \"pay this Tab: <link>\". Tab " +
    "re-reads the request, checks it is unpaid on-chain and not expired, checks the sender's USDC and ETH (gas) " +
    "balance, then returns ONE unsigned proposal: an ERC-20 USDC transfer of the exact amount to the requester. " +
    "It grants no allowance. Show the user the returned explanation before they approve in PayBox. After it " +
    "confirms, call tab_status with the same link. Not for splits as a whole: pay each person's own request link. " +
    "sender must be the user's own Base address (if they name a PayBox @username, resolve it with PayBox's resolve_username tool first).",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
} as const;

export async function pay(input: z.infer<typeof payInput>, ctx: ToolContext): Promise<CallToolResult> {
  const sender = checksum(input.sender, "sender");
  const ref = parseRef(input.link_or_id);
  if (ref.kind !== "request" && ref.kind !== "payload" && ref.kind !== "request_or_split") {
    throw new ToolError("That is not a payment request link.", ref.kind === "split" ? "Pay your own request link from the split, not the split page." : "Use deal_action or bet_action for escrow.");
  }
  const base = requireApiBase(ctx.config);
  const req = await resolveRequest(ctx, { kind: ref.kind === "payload" ? "payload" : "request", id: ref.id });
  const url = `${base}/r/${req.id}`;
  if (req.source === "payload") await crossCheckPayload(ctx, req);
  if (sameAddress(req.recipient, sender)) throw new ToolError("This request pays the sender's own address; nothing to do.", "Pay from a different wallet, or share the link with the payer.");
  if (req.uniqueAtomic > ctx.config.maxAtomic) {
    throw new ToolError(`Request is for ${formatUsdc(req.uniqueAtomic)} USDC, above the safety cap of ${formatUsdc(ctx.config.maxAtomic)} USDC.`);
  }

  const [signature, statuses, usdc, eth, gasPrice] = await Promise.all([
    checkSignature(ctx, req),
    verifyRequests(ctx, [req], 2_500),
    ctx.chain.usdcBalance(sender),
    ctx.chain.ethBalance(sender),
    ctx.chain.gasPrice(),
  ]);
  if (signature === "invalid") throw new ToolError("The request's creator signature does NOT match its recipient. Possible spoofed link: do not pay it.");
  const verified = statuses.get(req.id);
  const status = verified?.status ?? "checking";
  const nowSeconds = Math.floor(ctx.now() / 1000);
  if (verified && (verified.finding.status === "paid" || verified.finding.status === "paid_late")) {
    throw new ToolError(`Request already paid in tx ${verified.finding.tx}; nothing to do.`, `Receipt: ${EXPLORER_TX}${verified.finding.tx}`);
  }
  if (req.apiStatus && (req.apiStatus.status === "paid" || req.apiStatus.status === "paid_late")) {
    throw new ToolError("Tab reports this request as already paid; not proposing a second payment.", `Check with tab_status {"ref":"${url}"}.`);
  }
  if (nowSeconds > req.expiresAt) throw new ToolError(`Request expired at ${isoSeconds(req.expiresAt)}.`, "Ask the requester for a new link.");
  if (usdc < req.uniqueAtomic) {
    throw new ToolError(`Insufficient USDC: ${sender} holds ${formatUsdc(usdc)} USDC on Base but this request needs ${formatUsdc(req.uniqueAtomic)}.`,
      `Top up USDC on Base at ${DEPOSIT_URL}, then call tab_pay again.`);
  }
  const minGas = TRANSFER_GAS * gasPrice + L1_FEE_ALLOWANCE_WEI;
  if (eth < minGas) {
    throw new ToolError(`Not enough ETH for gas: ${sender} holds ${formatUnitsExact(eth, 18)} ETH on Base; about ${formatUnitsExact(minGas, 18)} ETH is needed.`,
      `Add a little ETH on Base at ${DEPOSIT_URL}, then call tab_pay again.`);
  }

  // All checks passed: record the payer for their "you owe" list (best effort, metadata only).
  if (req.source === "api") await bestEffortSetPayer(ctx, req.id, sender);
  const data = transferCalldata(req.recipient, req.uniqueAtomic);
  const proposal = proposeEvm({ chain: CHAIN, to: USDC, value: "0", data });
  const signedText = signature === "valid" ? `Signed by ${req.recipient} (the recipient). Names/labels are unverified.` : req.source === "payload"
    ? "Unverified offline link: confirm the recipient address with the requester before approving."
    : "Unsigned request: confirm the recipient address with the requester if unsure.";
  const statusText = status === "checking" ? " On-chain payment history could not be fully scanned in time; the Tab server reports it unpaid." : "";
  const who = req.requesterLabel ? ` from ${quoteUntrusted(req.requesterLabel)}` : "";
  const memo = req.memo ? ` ${quoteUntrusted(req.memo)}` : "";
  const explanation =
    `Pays request${memo}${who} (labels are user-provided text): transfer exactly ${formatUsdc(req.uniqueAtomic)} USDC ` +
    `(${req.uniqueAtomic.toString()} base units) on Base to ${req.recipient}. Calls USDC.transfer on ${USDC}; ` +
    `no allowance is granted. ${signedText}${statusText}`;
  return proposalResult(proposal, explanation, {
    summary: `USDC transfer of ${formatUsdc(req.uniqueAtomic)} to ${shortAddress(req.recipient)} for Tab request ${req.id.slice(0, 24)}`,
    next_actions: [
      "Show the explanation to the user; they approve the transaction in PayBox.",
      "Poll the PayBox request until it reaches a terminal status.",
      `Then confirm with tab_status {"ref":"${url}"}.`,
    ],
    links: { request: url },
  });
}

export function transferCalldata(recipient: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] });
}

/**
 * A payload link is self-asserted. If the Tab API knows the same id, its record is authoritative: any disagreement
 * on recipient or amount means the link was altered, so refuse. API unavailability or 404 is not an error here.
 */
async function crossCheckPayload(ctx: ToolContext, req: ResolvedRequest): Promise<void> {
  let record;
  try {
    record = await ctx.api().getRequest(req.id);
  } catch (error) {
    if (error instanceof ToolError || findCause(error, NetError)) return;
    throw error;
  }
  if (!sameAddress(record.recipient, req.recipient) || BigInt(record.unique_atomic) !== req.uniqueAtomic || BigInt(record.amount_atomic) !== req.amountAtomic) {
    throw new ToolError("This offline link does not match the Tab server's record for it (recipient or amount differs). Do not pay it.",
      "Ask the requester for a fresh link.");
  }
}
