import { getAddress } from "viem";
import type { RequestRow, SplitRow } from "../db/schema";
import type { OfflinePayload } from "../payload";

export type RequestStatus = "open" | "paid" | "expired" | "paid_late" | "checking";

/** Wire shape from shared/api-contract.md. */
export interface RequestRecord {
  id: string;
  split_id: string | null;
  recipient: string;
  amount_atomic: string;
  unique_atomic: string;
  memo: string | null;
  payer_label: string | null;
  requester_label: string | null;
  created_at: string;
  expires_at: string;
  start_block: string;
  signature: string | null;
  status: RequestStatus;
  paid_tx: string | null;
  paid_at: string | null;
  payer_address: string | null;
}

export interface SplitRecord {
  id: string;
  recipient: string;
  total_atomic: string;
  memo: string | null;
  requester_label: string | null;
  created_at: string;
}

export interface StatusRecord {
  id: string;
  status: RequestStatus;
  paid_tx: string | null;
  paid_at: string | null;
  payer_address: string | null;
  checked_at: string;
}

/** Whole-second ISO-8601 UTC with Z. */
export function isoSeconds(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

export function displayStatus(row: Pick<RequestRow, "status" | "expiresAt">, now: Date): RequestStatus {
  if (row.status === "open" && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return row.status;
}

export function toRequestRecord(row: RequestRow, now: Date = new Date()): RequestRecord {
  const paid = row.status === "paid" || row.status === "paid_late";
  return {
    id: row.id,
    split_id: row.splitId,
    recipient: getAddress(row.recipient),
    amount_atomic: row.amountAtomic,
    unique_atomic: row.uniqueAtomic,
    memo: row.memo,
    payer_label: row.payerLabel,
    requester_label: row.requesterLabel,
    created_at: isoSeconds(row.createdAt),
    expires_at: isoSeconds(row.expiresAt),
    start_block: row.startBlock.toString(),
    signature: row.signature,
    status: displayStatus(row, now),
    paid_tx: paid ? row.paidTx : null,
    paid_at: paid && row.paidAt ? isoSeconds(row.paidAt) : null,
    payer_address: row.payerAddress ? getAddress(row.payerAddress) : null,
  };
}

export function toSplitRecord(row: SplitRow): SplitRecord {
  return {
    id: row.id,
    recipient: getAddress(row.recipient),
    total_atomic: row.totalAtomic,
    memo: row.memo,
    requester_label: row.requesterLabel,
    created_at: isoSeconds(row.createdAt),
  };
}

/** Synthesized record for an offline `p.` link; never persisted. */
export function payloadToRecord(id: string, p: OfflinePayload, now: Date = new Date()): RequestRecord {
  const expires = new Date(p.e * 1000);
  return {
    id,
    split_id: null,
    recipient: p.r,
    amount_atomic: p.a,
    unique_atomic: p.u,
    memo: p.m || null,
    payer_label: p.pl || null,
    requester_label: p.rl || null,
    created_at: isoSeconds(new Date(p.c * 1000)),
    expires_at: isoSeconds(expires),
    start_block: p.b,
    signature: null,
    status: expires.getTime() <= now.getTime() ? "expired" : "open",
    paid_tx: null,
    paid_at: null,
    payer_address: null,
  };
}
