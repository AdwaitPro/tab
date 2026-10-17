import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { checksum, sameAddress } from "../lib/address.js";
import { formatUsdc, formatUsdcCents, parseUsdc } from "../lib/amount.js";
import type { RequestRecord } from "../lib/api.js";
import { requireApiBase } from "../lib/config.js";
import { LIMITS } from "../lib/constants.js";
import type { ToolContext } from "../lib/context.js";
import { NetError, ToolError } from "../lib/errors.js";
import { addressInput, labelInput, memoInput, usdcInput } from "../lib/inputs.js";
import { log } from "../lib/log.js";
import { buildPayload, encodePayload } from "../lib/payload.js";
import { requestUrl } from "../lib/refs.js";
import { readResult } from "../lib/result.js";
import { bestEffortSetPayer, payAnyAgent } from "../lib/payer.js";
import { quoteUntrusted, sanitizeText } from "../lib/sanitize.js";
import { isoSeconds } from "../lib/time.js";

export const requestInput = z.object({
  recipient: addressInput.describe("Address that receives the USDC (usually the user's own PayBox EVM wallet)."),
  amount: usdcInput.describe('USDC amount as a decimal string, e.g. "2" or "12.50". Max 6 decimals.'),
  memo: memoInput.optional().describe("What it is for (≤140 chars). Visible to anyone with the link."),
  payer_label: labelInput.optional().describe("Who should pay, e.g. a first name (≤40 chars)."),
  payer_address: addressInput.optional().describe("Optional: the payer's Base address, so the request shows up in their \"you owe\" list."),
  requester_label: labelInput.optional().describe("How the requester is shown, e.g. a first name (≤40 chars)."),
  expires_in_hours: z.number().int().min(1).max(720).default(168).describe("Link lifetime in hours (default 168 = 7 days)."),
}).strict();

export const requestOutput = z.object({
  id: z.string(),
  url: z.string(),
  amount_display: z.string(),
  amount_atomic: z.string(),
  unique_amount_display: z.string(),
  unique_atomic: z.string(),
  recipient: z.string(),
  memo: z.string().nullable(),
  payer_label: z.string().nullable(),
  expires_at: z.string(),
  share_text: z.string(),
  pay_prompt: z.string(),
  pay_any_agent: z.string().describe("Plain-transfer instructions for any wallet or agent without Tab."),
  mode: z.enum(["api", "offline"]),
  next_actions: z.array(z.string()),
}).strict();
export type RequestOutput = z.infer<typeof requestOutput>;

export const requestTool = {
  name: "tab_request",
  title: "Request a USDC payment",
  description:
    "Create one shareable payment request link for USDC on Base (\"ask Meera for 5 USDC\"). Use tab_split instead " +
    "when dividing a bill among several people. The payer opens the link and pays from any wallet, or their agent " +
    "pays it with tab_pay. Tab adds a tiny unique matching code (< 0.01 USDC) to the amount so the payment can be " +
    "proven on-chain. Amounts are decimal USDC strings. Returns the link, share text to send, and a pay prompt " +
    "for the payer's agent. Creates a record on the Tab server; no wallet approval needed. " +
    "If the user names a PayBox @username, resolve it to a Base address with PayBox's resolve_username tool first, then pass the address.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
} as const;

export function shareText(payer: string | undefined, cents: string, memo: string | undefined, url: string, split: boolean): string {
  const greeting = payer ? `Hey ${payer}, ` : "";
  const what = split
    ? `your share${memo ? ` of ${memo}` : ""} is ${cents} USDC`
    : `${greeting ? "please pay" : "Please pay"} ${cents} USDC${memo ? ` for ${memo}` : ""}`;
  return `${greeting}${what} → ${url}`;
}

/** Checks the server echoed what we asked for; a mismatch means a buggy or compromised API. */
export function assertRecordMatches(record: RequestRecord, recipient: string, amount: bigint): void {
  const unique = BigInt(record.unique_atomic);
  if (!sameAddress(record.recipient, recipient) || BigInt(record.amount_atomic) !== amount || unique <= amount || unique - amount > 9_999n) {
    throw new ToolError("Tab API returned a request that does not match the input; refusing to share it.");
  }
}

export async function request(input: z.infer<typeof requestInput>, ctx: ToolContext): Promise<CallToolResult> {
  const recipient = checksum(input.recipient, "recipient");
  const amount = parseUsdc(input.amount, ctx.config.maxAtomic);
  const memo = sanitizeText(input.memo, LIMITS.memo);
  const payerLabel = sanitizeText(input.payer_label, LIMITS.label);
  const requesterLabel = sanitizeText(input.requester_label, LIMITS.label);
  const payerAddress = input.payer_address ? checksum(input.payer_address, "payer_address") : undefined;
  if (payerAddress && sameAddress(payerAddress, recipient)) throw new ToolError("payer_address is the recipient itself.");
  const base = requireApiBase(ctx.config);
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const expiresAt = nowSeconds + input.expires_in_hours * 3600;
  const startBlock = await ctx.chain.blockNumber();

  let id: string;
  let unique: bigint;
  let mode: "api" | "offline" = "api";
  try {
    const record = await ctx.api().createRequest({
      recipient,
      amount_atomic: amount.toString(),
      ...(memo ? { memo } : {}),
      ...(payerLabel ? { payer_label: payerLabel } : {}),
      ...(requesterLabel ? { requester_label: requesterLabel } : {}),
      expires_at: isoSeconds(expiresAt),
      start_block: startBlock.toString(),
    });
    assertRecordMatches(record, recipient, amount);
    id = record.id;
    unique = BigInt(record.unique_atomic);
    if (payerAddress) await bestEffortSetPayer(ctx, id, payerAddress);
  } catch (error) {
    if (!(error instanceof NetError) || !error.retryable) throw error;
    log("tab_request", "offline_fallback", { kind: error.kind });
    const payload = buildPayload({ recipient, amount, createdAt: nowSeconds, expiresAt, startBlock, nonce: ctx.randomHex(8), memo, payerLabel, requesterLabel });
    id = encodePayload(payload);
    unique = BigInt(payload.u);
    mode = "offline";
  }

  const url = requestUrl(base, id);
  const cents = formatUsdcCents(amount);
  const next = [
    "Send share_text to the payer (any chat app).",
    "If the payer uses an agent, they can say pay_prompt to it (tab_pay).",
    `Check payment with tab_status {"ref":"${url}"} or tab_list for the recipient.`,
  ];
  if (mode === "offline") next.unshift("Tab server was unreachable: this is a self-contained offline link (works, but shows as Unverified).");
  const output: RequestOutput = {
    id,
    url,
    amount_display: formatUsdc(amount),
    amount_atomic: amount.toString(),
    unique_amount_display: formatUsdc(unique),
    unique_atomic: unique.toString(),
    recipient,
    memo: memo ?? null,
    payer_label: payerLabel ?? null,
    expires_at: isoSeconds(expiresAt),
    share_text: shareText(payerLabel, cents, memo, url, false),
    pay_prompt: `Pay this Tab: ${url}`,
    pay_any_agent: payAnyAgent(formatUsdc(unique), recipient),
    mode,
    next_actions: next,
  };
  const text = [
    `Request created${mode === "offline" ? " (offline link; Tab server unreachable)" : ""}: ${formatUsdc(amount)} USDC to ${recipient} on Base.`,
    `Exact amount to pay: ${formatUsdc(unique)} USDC (includes a ${formatUsdc(unique - amount)} matching code).`,
    memo ? `Memo (user-provided text): ${quoteUntrusted(memo)}` : undefined,
    `Link: ${url}`,
    `Share text: ${output.share_text}`,
    output.pay_any_agent,
    `Expires: ${output.expires_at}`,
  ].filter((line): line is string => line !== undefined).join("\n");
  return readResult(output, text);
}
