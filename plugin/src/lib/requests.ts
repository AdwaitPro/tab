import { getAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import * as z from "zod/v4";

import { checksum } from "./address.js";
import type { RequestRecord, RequestStatusResponse } from "./api.js";
import { LIMITS } from "./constants.js";
import { findCause } from "./chain.js";
import type { ToolContext } from "./context.js";
import { NetError, ToolError } from "./errors.js";
import { findPayments, type PaymentFinding } from "./matching.js";
import { decodePayload } from "./payload.js";
import { requestUrl } from "./refs.js";
import { formatUsdc } from "./amount.js";
import { sanitizeText } from "./sanitize.js";
import { isoSeconds } from "./time.js";

export interface ResolvedRequest {
  id: string;
  source: "api" | "payload";
  recipient: Address;
  amountAtomic: bigint;
  uniqueAtomic: bigint;
  memo: string | undefined;
  payerLabel: string | undefined;
  requesterLabel: string | undefined;
  createdAt: number;
  expiresAt: number;
  startBlock: bigint;
  signature: Hex | null;
  splitId: string | null;
  apiStatus: RequestStatusResponse | null;
}

function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function fromRecord(record: RequestRecord, apiStatus: RequestStatusResponse | null): ResolvedRequest {
  return {
    id: record.id,
    source: "api",
    recipient: checksum(record.recipient, "recipient"),
    amountAtomic: BigInt(record.amount_atomic),
    uniqueAtomic: BigInt(record.unique_atomic),
    memo: sanitizeText(record.memo, LIMITS.memo),
    payerLabel: sanitizeText(record.payer_label, LIMITS.label),
    requesterLabel: sanitizeText(record.requester_label, LIMITS.label),
    createdAt: unix(record.created_at),
    expiresAt: unix(record.expires_at),
    startBlock: BigInt(record.start_block),
    signature: record.signature && /^0x[0-9a-fA-F]+$/.test(record.signature) ? record.signature as Hex : null,
    splitId: record.split_id,
    apiStatus,
  };
}

export async function resolveRequest(ctx: ToolContext, ref: { kind: "request" | "payload"; id: string }): Promise<ResolvedRequest> {
  if (ref.kind === "payload") {
    const p = decodePayload(ref.id);
    return {
      id: ref.id,
      source: "payload",
      recipient: p.r,
      amountAtomic: BigInt(p.a),
      uniqueAtomic: BigInt(p.u),
      memo: sanitizeText(p.m, LIMITS.memo),
      payerLabel: sanitizeText(p.pl, LIMITS.label),
      requesterLabel: sanitizeText(p.rl, LIMITS.label),
      createdAt: p.c,
      expiresAt: p.e,
      startBlock: BigInt(p.b),
      signature: null,
      splitId: null,
      apiStatus: null,
    };
  }
  const api = ctx.api();
  const [record, status] = await Promise.all([
    api.getRequest(ref.id),
    api.getRequestStatus(ref.id).catch((error: unknown) => {
      if (error instanceof ToolError || error instanceof NetError) return null;
      throw error;
    }),
  ]);
  if (record.id !== ref.id) throw new ToolError("Tab API returned a different request than asked for; refusing to use it.");
  if (BigInt(record.unique_atomic) <= BigInt(record.amount_atomic) || BigInt(record.unique_atomic) - BigInt(record.amount_atomic) > 9_999n) {
    throw new ToolError("Request amounts are inconsistent (matching code out of range); refusing to use it.");
  }
  return fromRecord(record, status);
}

export function signatureMessage(req: ResolvedRequest): string {
  return [
    "Tab payment request",
    `id: ${req.id}`,
    `recipient: ${req.recipient}`,
    `amount: ${req.uniqueAtomic.toString()} USDC base units on Base`,
    `expires: ${isoSeconds(req.expiresAt)}`,
  ].join("\n");
}

export type SignatureCheck = "valid" | "invalid" | "absent" | "unverifiable";

export async function checkSignature(ctx: ToolContext, req: ResolvedRequest): Promise<SignatureCheck> {
  if (!req.signature) return "absent";
  const message = signatureMessage(req);
  try {
    // EOA fast path, no network. Smart-account (ERC-1271/6492) signatures fall through to an on-chain check.
    if ((await recoverMessageAddress({ message, signature: req.signature })).toLowerCase() === req.recipient.toLowerCase()) return "valid";
  } catch {
    // Not a 65-byte ECDSA signature; try ERC-1271 below.
  }
  try {
    const ok = await ctx.chain.client.verifyMessage({ address: req.recipient, message, signature: req.signature });
    return ok ? "valid" : "invalid";
  } catch (error) {
    return findCause(error, NetError) ? "unverifiable" : "invalid";
  }
}

export type RequestStatusValue = "open" | "paid" | "paid_late" | "expired" | "checking";

export interface VerifiedStatus {
  status: RequestStatusValue;
  finding: PaymentFinding;
}

export function statusFromFinding(finding: PaymentFinding, expiresAt: number, nowSeconds: number): RequestStatusValue {
  if (finding.status === "paid" || finding.status === "paid_late" || finding.status === "checking") return finding.status;
  return nowSeconds > expiresAt ? "expired" : "open";
}

export async function verifyRequests(ctx: ToolContext, requests: readonly ResolvedRequest[], reserveMs?: number): Promise<Map<string, VerifiedStatus>> {
  const byRecipient = new Map<string, ResolvedRequest[]>();
  for (const req of requests) {
    const key = req.recipient.toLowerCase();
    byRecipient.set(key, [...(byRecipient.get(key) ?? []), req]);
  }
  const out = new Map<string, VerifiedStatus>();
  const nowSeconds = Math.floor(ctx.now() / 1000);
  await Promise.all([...byRecipient.values()].map(async (group) => {
    const first = group[0];
    if (!first) return;
    const findings = await findPayments(ctx.chain, ctx.budget, first.recipient, group.map((r) => ({
      key: r.id,
      unique: r.uniqueAtomic,
      startBlock: r.startBlock,
      expiresAt: r.expiresAt,
      hintTx: r.apiStatus?.paid_tx as Hex | null | undefined,
    })), reserveMs);
    for (const r of group) {
      const finding = findings.get(r.id) ?? { status: "checking" as const, reason: "not scanned" };
      out.set(r.id, { status: statusFromFinding(finding, r.expiresAt, nowSeconds), finding });
    }
  }));
  return out;
}

export const requestViewSchema = z.object({
  id: z.string(),
  url: z.string(),
  status: z.enum(["open", "paid", "paid_late", "expired", "checking"]),
  recipient: z.string(),
  amount: z.string(),
  amount_atomic: z.string(),
  unique_amount: z.string(),
  unique_atomic: z.string(),
  memo: z.string().nullable(),
  payer_label: z.string().nullable(),
  requester_label: z.string().nullable(),
  expires_at: z.string(),
  paid_tx: z.string().nullable(),
  paid_at: z.string().nullable(),
  payer: z.string().nullable(),
  verified_on_chain: z.boolean(),
  source: z.enum(["api", "payload"]),
  split_id: z.string().nullable(),
}).strict();
export type RequestView = z.infer<typeof requestViewSchema>;

export function requestView(base: string, req: ResolvedRequest, verified: VerifiedStatus): RequestView {
  const paid = verified.finding.status === "paid" || verified.finding.status === "paid_late" ? verified.finding : undefined;
  return {
    id: req.id,
    url: requestUrl(base, req.id),
    status: verified.status,
    recipient: req.recipient,
    amount: formatUsdc(req.amountAtomic),
    amount_atomic: req.amountAtomic.toString(),
    unique_amount: formatUsdc(req.uniqueAtomic),
    unique_atomic: req.uniqueAtomic.toString(),
    memo: req.memo ?? null,
    payer_label: req.payerLabel ?? null,
    requester_label: req.requesterLabel ?? null,
    expires_at: isoSeconds(req.expiresAt),
    paid_tx: paid?.tx ?? null,
    paid_at: paid && paid.paidAt > 0 ? isoSeconds(paid.paidAt) : null,
    payer: paid ? getAddress(paid.payer) : null,
    verified_on_chain: verified.finding.status !== "checking",
    source: req.source,
    split_id: req.splitId,
  };
}
