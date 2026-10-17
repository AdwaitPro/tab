import { beforeEach, describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { MIN_SCAN_BLOCK } from "@/lib/constants";
import { createPgliteDb, type Db } from "@/lib/db/client";
import type { RequestRow } from "@/lib/db/schema";
import { clearStatusCache, createRequest, getRequestRow } from "@/lib/server/requests";
import { PAYER, RECIPIENT, transfer } from "@/test/fixtures";
import type { UsdcTransfer } from "@/lib/chain/matching";
import type { Facilitator, FacilitatorRequest, SettleResponse, VerifyResponse } from "./facilitator";
import { FacilitatorError } from "./facilitator";
import { payWithX402, type PayDeps } from "./pay";
import { encodeHeaderJson, parsePaymentHeader, type ParsedPayment } from "./protocol";

const TX = `0x${"cd".repeat(32)}` as Hex;
const RESOURCE = "https://tab-pay.vercel.app/api/x402/r/x";
let db: Db;
let row: RequestRow;

beforeEach(async () => {
  db = await createPgliteDb();
  clearStatusCache();
  const created = await createRequest(db, {
    recipient: RECIPIENT,
    amountAtomic: 50_000n,
    memo: "Chai",
    payerLabel: null,
    requesterLabel: null,
    expiresAt: new Date(Date.now() + 3600_000),
    startBlock: MIN_SCAN_BLOCK,
  });
  row = (await getRequestRow(db, created.id))!;
});

function payment(value = row.uniqueAtomic): ParsedPayment {
  const raw = {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: { from: PAYER, to: RECIPIENT, value, validAfter: "0", validBefore: "1900000000", nonce: `0x${"ab".repeat(32)}` },
    },
  };
  const parsed = parsePaymentHeader(new Headers({ "X-PAYMENT": encodeHeaderJson(raw) }));
  if (parsed.kind !== "ok") throw new Error("bad fixture");
  return parsed.payment;
}

class FakeFacilitator implements Facilitator {
  calls: Array<["verify" | "settle", FacilitatorRequest]> = [];
  constructor(
    public verdict: VerifyResponse = { isValid: true, invalidReason: null, payer: PAYER },
    public settlement: SettleResponse | Error = { success: true, transaction: TX, network: "base", payer: PAYER },
  ) {}
  async verify(body: FacilitatorRequest) {
    this.calls.push(["verify", body]);
    return this.verdict;
  }
  async settle(body: FacilitatorRequest) {
    this.calls.push(["settle", body]);
    if (this.settlement instanceof Error) throw this.settlement;
    return this.settlement;
  }
}

function deps(facilitator: Facilitator, transfers: UsdcTransfer[] | Error): PayDeps {
  return {
    facilitator,
    receiptTransfers: async () => {
      if (transfers instanceof Error) throw transfers;
      return transfers;
    },
    blockTime: async () => new Date(),
  };
}

const settledTransfer = () =>
  transfer({ txHash: TX, logIndex: 7, value: BigInt(row.uniqueAtomic), blockNumber: MIN_SCAN_BLOCK + 10n });

describe("payWithX402", () => {
  it("verifies, settles with our own requirements, confirms on-chain, and marks the request paid", async () => {
    const f = new FakeFacilitator();
    const outcome = await payWithX402(db, row, payment(), RESOURCE, deps(f, [settledTransfer()]));
    expect(outcome.kind).toBe("paid");
    expect(f.calls.map((c) => c[0])).toEqual(["verify", "settle"]);
    expect(f.calls[0][1].paymentRequirements).toMatchObject({
      network: "base",
      maxAmountRequired: row.uniqueAtomic,
      payTo: RECIPIENT,
      resource: RESOURCE,
    });
    const stored = await getRequestRow(db, row.id);
    expect(stored).toMatchObject({ status: "paid", paidTx: TX, paidLogIndex: 7, payerAddress: PAYER });
  });

  it("is idempotent: an already-paid request returns the receipt without touching the facilitator", async () => {
    await payWithX402(db, row, payment(), RESOURCE, deps(new FakeFacilitator(), [settledTransfer()]));
    const f = new FakeFacilitator();
    const again = await payWithX402(db, (await getRequestRow(db, row.id))!, payment(), RESOURCE, deps(f, []));
    expect(again).toMatchObject({ kind: "paid", record: { paid_tx: TX } });
    expect(f.calls).toHaveLength(0);
  });

  it("rejects a wrong amount locally before calling the facilitator", async () => {
    const f = new FakeFacilitator();
    const outcome = await payWithX402(db, row, payment("1"), RESOURCE, deps(f, []));
    expect(outcome.kind).toBe("payment_required");
    expect(f.calls).toHaveLength(0);
  });

  it("returns payment_required when the facilitator says the signature is invalid", async () => {
    const f = new FakeFacilitator({ isValid: false, invalidReason: "invalid_exact_evm_signature", payer: PAYER });
    const outcome = await payWithX402(db, row, payment(), RESOURCE, deps(f, []));
    expect(outcome).toEqual({ kind: "payment_required", error: "Payment rejected: invalid_exact_evm_signature" });
    expect(f.calls.map((c) => c[0])).toEqual(["verify"]);
  });

  it("surfaces settlement_pending as pending and leaves the request open", async () => {
    const f = new FakeFacilitator(undefined, { success: false, errorReason: "settlement_pending", transaction: "" });
    expect((await payWithX402(db, row, payment(), RESOURCE, deps(f, []))).kind).toBe("pending");
    expect((await getRequestRow(db, row.id))?.status).toBe("open");
  });

  it("treats an unconfirmed receipt as pending", async () => {
    const outcome = await payWithX402(db, row, payment(), RESOURCE, deps(new FakeFacilitator(), new Error("timeout")));
    expect(outcome.kind).toBe("pending");
  });

  it("refuses to mark paid if the settlement tx doesn't carry the exact transfer", async () => {
    const wrong = transfer({ txHash: TX, value: 1n, blockNumber: MIN_SCAN_BLOCK + 10n });
    const outcome = await payWithX402(db, row, payment(), RESOURCE, deps(new FakeFacilitator(), [wrong]));
    expect(outcome.kind).toBe("failed");
    expect((await getRequestRow(db, row.id))?.status).toBe("open");
  });

  it("maps facilitator transport errors to failed", async () => {
    const f = new FakeFacilitator(undefined, new FacilitatorError("facilitator /settle unreachable"));
    expect((await payWithX402(db, row, payment(), RESOURCE, deps(f, []))).kind).toBe("failed");
  });

  it("returns expired for an expired request", async () => {
    const outcome = await payWithX402(db, row, payment(), RESOURCE, deps(new FakeFacilitator(), []), new Date(Date.now() + 7200_000));
    expect(outcome.kind).toBe("expired");
  });
});
