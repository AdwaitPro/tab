import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { checksum, sameAddress } from "../lib/address.js";
import { formatUsdc, formatUsdcCents, parseUsdc } from "../lib/amount.js";
import { requireApiBase } from "../lib/config.js";
import { LIMITS } from "../lib/constants.js";
import type { ToolContext } from "../lib/context.js";
import { NetError, ToolError } from "../lib/errors.js";
import { addressInput, labelInput, memoInput, usdcInput } from "../lib/inputs.js";
import { log } from "../lib/log.js";
import { buildPayload, encodePayload } from "../lib/payload.js";
import { requestUrl, splitUrl } from "../lib/refs.js";
import { readResult } from "../lib/result.js";
import { quoteUntrusted, sanitizeText } from "../lib/sanitize.js";
import { computeSplit, scaleWeight, tipToBps } from "../lib/split.js";
import { isoSeconds } from "../lib/time.js";
import { assertRecordMatches, shareText } from "./request.js";

const SPLIT_EXPIRY_HOURS = 168;

export const splitInput = z.object({
  recipient: addressInput.describe("Address that receives everyone's USDC (usually the user's own PayBox EVM wallet)."),
  total: usdcInput.describe('Full bill in USDC as a decimal string, before tip, including the requester\'s own share. e.g. "60".'),
  participants: z.array(z.object({
    label: labelInput.min(1).describe("Who owes, e.g. a first name (≤40 chars)."),
    amount: usdcInput.optional().describe("Custom mode: exact USDC this person owes. Set for all participants or none."),
    weight: z.number().min(0).max(1000).optional().describe("Weighted mode: relative share (e.g. 2 = double). Set for all or none."),
  }).strict()).min(1).max(LIMITS.participants).describe("People who owe (1–20). Do not include the requester here."),
  include_self: z.boolean().default(true).describe("Equal/weighted modes: the requester also takes a share (weight 1) and absorbs rounding. Default true."),
  memo: memoInput.optional().describe("What the bill is for (≤140 chars). Visible to anyone with a link."),
  tip_percent: z.number().min(0).max(50).optional().describe("Optional tip added on top of total, 0–50 (max 2 decimals), split in the same proportions."),
  requester_label: labelInput.optional().describe("How the requester is shown on pay pages (≤40 chars)."),
}).strict();

const personOutput = z.object({
  label: z.string(),
  request_id: z.string(),
  amount: z.string(),
  amount_atomic: z.string(),
  unique_amount: z.string(),
  unique_atomic: z.string(),
  url: z.string(),
  share_text: z.string(),
  pay_prompt: z.string(),
}).strict();

export const splitOutput = z.object({
  split_id: z.string().nullable(),
  split_url: z.string().nullable(),
  mode: z.enum(["equal", "custom", "weighted"]),
  total: z.string(),
  total_atomic: z.string(),
  tip: z.string(),
  per_person: z.array(personOutput),
  your_share: z.string(),
  your_share_atomic: z.string(),
  recipient: z.string(),
  expires_at: z.string(),
  offline: z.boolean(),
  next_actions: z.array(z.string()),
}).strict();
export type SplitOutput = z.infer<typeof splitOutput>;

export const splitTool = {
  name: "tab_split",
  title: "Split a bill",
  description:
    "Split a USDC bill among 1–20 people and create one payment link per person in a single call (\"split 60 USDC " +
    "dinner with Meera and Aarav, I paid\"). Modes: equal (default), custom (every participant has amount; the " +
    "remainder is the requester's share) or weighted (every participant has weight). Math is exact in USDC base " +
    "units; shares always sum to the total (+ tip), and the requester absorbs rounding. Each link carries a unique " +
    "matching code (< 0.01 USDC) for on-chain proof. Returns per-person links and share text plus a split page. " +
    "Do not list the requester in participants; use include_self instead. No wallet approval needed.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
} as const;

export async function split(input: z.infer<typeof splitInput>, ctx: ToolContext): Promise<CallToolResult> {
  const recipient = checksum(input.recipient, "recipient");
  const total = parseUsdc(input.total, ctx.config.maxAtomic, "total");
  const memo = sanitizeText(input.memo, LIMITS.memo);
  const requesterLabel = sanitizeText(input.requester_label, LIMITS.label);
  const labels = input.participants.map((p, i) => {
    const label = sanitizeText(p.label, LIMITS.label);
    if (!label) throw new ToolError(`Participant #${i + 1} needs a label.`);
    return label;
  });
  const result = computeSplit({
    total,
    participants: input.participants.map((p) => ({
      amount: p.amount === undefined ? undefined : parseUsdc(p.amount, ctx.config.maxAtomic, `${p.label} amount`),
      weight: p.weight === undefined ? undefined : scaleWeight(p.weight),
    })),
    includeSelf: input.include_self,
    tipBps: tipToBps(input.tip_percent ?? 0),
  });
  if (result.grandTotal > ctx.config.maxAtomic) {
    throw new ToolError(`Total with tip (${formatUsdc(result.grandTotal)} USDC) exceeds the safety cap of ${formatUsdc(ctx.config.maxAtomic)} USDC.`);
  }
  const base = requireApiBase(ctx.config);
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const expiresAt = nowSeconds + SPLIT_EXPIRY_HOURS * 3600;
  const startBlock = await ctx.chain.blockNumber();

  let splitId: string | null = null;
  let people: { id: string; unique: bigint }[];
  try {
    const response = await ctx.api().createSplit({
      recipient,
      total_atomic: result.grandTotal.toString(),
      ...(memo ? { memo } : {}),
      ...(requesterLabel ? { requester_label: requesterLabel } : {}),
      expires_at: isoSeconds(expiresAt),
      start_block: startBlock.toString(),
      requests: labels.map((label, i) => ({ payer_label: label, amount_atomic: (result.shares[i] ?? 0n).toString() })),
    });
    if (response.requests.length !== labels.length || !sameAddress(response.split.recipient, recipient)) {
      throw new ToolError("Tab API returned a split that does not match the input; refusing to share it.");
    }
    response.requests.forEach((record, i) => assertRecordMatches(record, recipient, result.shares[i] ?? 0n));
    splitId = response.split.id;
    people = response.requests.map((r) => ({ id: r.id, unique: BigInt(r.unique_atomic) }));
  } catch (error) {
    if (!(error instanceof NetError) || !error.retryable) throw error;
    log("tab_split", "offline_fallback", { kind: error.kind });
    people = labels.map((label, i) => {
      const payload = buildPayload({ recipient, amount: result.shares[i] ?? 0n, createdAt: nowSeconds, expiresAt, startBlock, nonce: ctx.randomHex(8), memo, payerLabel: label, requesterLabel });
      return { id: encodePayload(payload), unique: BigInt(payload.u) };
    });
  }

  const perPerson = labels.map((label, i) => {
    const share = result.shares[i] ?? 0n;
    const person = people[i];
    if (!person) throw new ToolError("Internal mismatch building split links.");
    const url = requestUrl(base, person.id);
    return {
      label,
      request_id: person.id,
      amount: formatUsdc(share),
      amount_atomic: share.toString(),
      unique_amount: formatUsdc(person.unique),
      unique_atomic: person.unique.toString(),
      url,
      share_text: shareText(label, formatUsdcCents(share), memo, url, true),
      pay_prompt: `Pay this Tab: ${url}`,
    };
  });
  const tip = result.grandTotal - total;
  const output: SplitOutput = {
    split_id: splitId,
    split_url: splitId ? splitUrl(base, splitId) : null,
    mode: result.mode,
    total: formatUsdc(result.grandTotal),
    total_atomic: result.grandTotal.toString(),
    tip: formatUsdc(tip),
    per_person: perPerson,
    your_share: formatUsdc(result.selfShare),
    your_share_atomic: result.selfShare.toString(),
    recipient,
    expires_at: isoSeconds(expiresAt),
    offline: splitId === null,
    next_actions: [
      "Send each person their share_text (or url).",
      splitId ? `Track everyone with tab_status {"ref":"split:${splitId}"} or tab_list for the recipient.` : "Track each link with tab_status.",
    ],
  };
  const lines = [
    `Split ${formatUsdc(result.grandTotal)} USDC${tip > 0n ? ` (incl. ${formatUsdc(tip)} tip)` : ""} → ${recipient} on Base (${result.mode}).`,
    memo ? `Memo (user-provided text): ${quoteUntrusted(memo)}` : undefined,
    ...perPerson.map((p) => `• ${p.label} owes ${p.amount} USDC → pays exactly ${p.unique_amount} USDC at ${p.url}`),
    `Your share: ${output.your_share} USDC.`,
    output.split_url ? `Split page: ${output.split_url}` : "Tab server was unreachable: these are offline links (they work, but show as Unverified).",
  ];
  return readResult(output, lines.filter((l): l is string => l !== undefined).join("\n"));
}
