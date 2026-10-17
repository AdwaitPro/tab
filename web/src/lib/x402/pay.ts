import "server-only";
import { getAddress, type Hex } from "viem";
import type { UsdcTransfer } from "../chain/matching";
import type { Db } from "../db/client";
import type { RequestRow } from "../db/schema";
import { displayStatus, toRequestRecord, type RequestRecord } from "../server/records";
import { clearStatusCache, getRequestRow, refreshRequestStatus, type ChainDeps } from "../server/requests";
import { FacilitatorError, type Facilitator, type SettleResponse } from "./facilitator";
import {
  mismatchReason,
  requirementsV1,
  requirementsV2,
  X402_NETWORK_V1,
  X402_NETWORK_V2,
  type ParsedPayment,
  type PayableRequest,
} from "./protocol";
import { singleTxSource } from "./receipt";

export interface PayDeps {
  facilitator: Facilitator;
  receiptTransfers: (hash: Hex) => Promise<UsdcTransfer[]>;
  blockTime: (block: bigint) => Promise<Date>;
  /** Full chain scan run before settling so a payer who already paid by plain transfer isn't charged twice. */
  liveChain?: ChainDeps;
}

export type PayOutcome =
  | { kind: "paid"; record: RequestRecord; settlement: SettleResponse | null }
  | { kind: "expired" }
  | { kind: "payment_required"; error: string }
  | { kind: "pending"; settlement: SettleResponse }
  | { kind: "failed"; error: string };

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function payableFrom(row: RequestRow): PayableRequest {
  return { id: row.id, recipient: getAddress(row.recipient), uniqueAtomic: BigInt(row.uniqueAtomic), memo: row.memo };
}

function isPaid(row: RequestRow): boolean {
  return row.status === "paid" || row.status === "paid_late";
}

/** Receipt the settlement would have produced, for idempotent replays of an already-paid request. */
export function settlementFromRecord(record: RequestRecord, version: 1 | 2): SettleResponse | null {
  if (!record.paid_tx) return null;
  return {
    success: true,
    transaction: record.paid_tx,
    network: version === 2 ? X402_NETWORK_V2 : X402_NETWORK_V1,
    payer: record.payer_address,
  };
}

/**
 * verify → settle → confirm on-chain → mark paid. The DB write goes through the same matcher the
 * status endpoint uses, fed only the settlement tx, so a request is marked paid iff that tx carries
 * a USDC Transfer(to = recipient, value = unique_atomic) not already assigned to another request.
 */
export async function payWithX402(
  db: Db,
  row: RequestRow,
  payment: ParsedPayment,
  resource: string,
  deps: PayDeps,
  now = new Date(),
): Promise<PayOutcome> {
  if (isPaid(row)) return { kind: "paid", record: toRequestRecord(row, now), settlement: null };
  if (displayStatus(row, now) === "expired") return { kind: "expired" };

  const req = payableFrom(row);
  const mismatch = mismatchReason(payment, req);
  if (mismatch) return { kind: "payment_required", error: mismatch };

  if (deps.liveChain) {
    const status = await refreshRequestStatus(db, row, deps.liveChain, now);
    if (status.status === "paid" || status.status === "paid_late") {
      const fresh = await getRequestRow(db, row.id);
      if (fresh) return { kind: "paid", record: toRequestRecord(fresh, now), settlement: null };
    }
  }

  const body = {
    x402Version: payment.version,
    paymentPayload: payment.raw,
    paymentRequirements: payment.version === 2 ? requirementsV2(req) : requirementsV1(req, resource),
  };

  let settlement: SettleResponse;
  try {
    const verified = await deps.facilitator.verify(body);
    if (!verified.isValid) {
      return { kind: "payment_required", error: `Payment rejected: ${verified.invalidReason ?? "invalid"}` };
    }
    settlement = await deps.facilitator.settle(body);
  } catch (error) {
    if (error instanceof FacilitatorError) return { kind: "failed", error: error.message };
    throw error;
  }

  if (!settlement.success) {
    if (settlement.errorReason === "settlement_pending") return { kind: "pending", settlement };
    return { kind: "payment_required", error: `Settlement failed: ${settlement.errorReason ?? "unknown"}` };
  }
  const tx = settlement.transaction ?? "";
  if (!TX_HASH_RE.test(tx)) return { kind: "failed", error: "Facilitator reported success without a transaction hash" };

  let transfers: UsdcTransfer[];
  try {
    transfers = await deps.receiptTransfers(tx as Hex);
  } catch {
    // Broadcast but not confirmed yet: the client retries with the same header and the
    // facilitator replays the recorded outcome for that identical payload.
    return { kind: "pending", settlement };
  }

  clearStatusCache();
  const status = await refreshRequestStatus(db, row, { source: singleTxSource(transfers), blockTime: deps.blockTime }, now);
  if (status.status !== "paid" && status.status !== "paid_late") {
    return { kind: "failed", error: `Settlement tx ${tx} does not pay this request's exact amount to its recipient` };
  }
  const fresh = await getRequestRow(db, row.id);
  return { kind: "paid", record: toRequestRecord(fresh ?? row, now), settlement };
}
