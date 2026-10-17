import { describe, expect, it } from "vitest";
import { USDC_ADDRESS } from "@/lib/constants";
import { PAYER, RECIPIENT } from "@/test/fixtures";
import {
  decodeHeaderJson,
  encodeHeaderJson,
  mismatchReason,
  parsePaymentHeader,
  paymentRequiredV1,
  paymentRequiredV2,
  resourceUrl,
  type ParsedPayment,
  type PayableRequest,
} from "./protocol";

const req: PayableRequest = { id: "4fGh8Kq2LmN0pQrS7tUvWx", recipient: RECIPIENT, uniqueAtomic: 2_000_417n, memo: "Dinner at Toit" };
const resource = resourceUrl("https://tab-pay.vercel.app/", req.id);

const authorization = (over: Record<string, string> = {}) => ({
  from: PAYER,
  to: RECIPIENT.toLowerCase(),
  value: "2000417",
  validAfter: "0",
  validBefore: "1900000000",
  nonce: `0x${"ab".repeat(32)}`,
  ...over,
});
const v1Payload = (auth = authorization(), over: Record<string, unknown> = {}) => ({
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: { signature: `0x${"11".repeat(65)}`, authorization: auth },
  ...over,
});
const v2Payload = (accepted: Record<string, unknown> = {}, auth = authorization()) => ({
  x402Version: 2,
  resource: { url: resource },
  accepted: {
    scheme: "exact",
    network: "eip155:8453",
    amount: "2000417",
    asset: USDC_ADDRESS,
    payTo: RECIPIENT,
    maxTimeoutSeconds: 120,
    extra: { name: "USD Coin", version: "2" },
    ...accepted,
  },
  payload: { signature: `0x${"11".repeat(65)}`, authorization: auth },
});

function parse(headers: Record<string, string>): ParsedPayment {
  const result = parsePaymentHeader(new Headers(headers));
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.payment;
}

describe("payment requirements", () => {
  it("builds v1 exact/base/USDC requirements from the request", () => {
    const body = paymentRequiredV1(req, resource, "pay");
    expect(resource).toBe("https://tab-pay.vercel.app/api/x402/r/4fGh8Kq2LmN0pQrS7tUvWx");
    expect(body).toEqual({
      x402Version: 1,
      error: "pay",
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "2000417",
          resource,
          description: "Tab: Dinner at Toit",
          mimeType: "application/json",
          payTo: RECIPIENT,
          maxTimeoutSeconds: 120,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    });
  });

  it("builds v2 requirements with CAIP-2 network and amount", () => {
    const body = paymentRequiredV2({ ...req, memo: null }, resource, "pay");
    expect(body.resource).toEqual({ url: resource, description: `Tab payment request ${req.id}`, mimeType: "application/json" });
    expect(body.accepts[0]).toEqual({
      scheme: "exact",
      network: "eip155:8453",
      amount: "2000417",
      asset: USDC_ADDRESS,
      payTo: RECIPIENT,
      maxTimeoutSeconds: 120,
      extra: { name: "USD Coin", version: "2" },
    });
    expect(decodeHeaderJson(encodeHeaderJson(body))).toEqual(body);
  });
});

describe("parsePaymentHeader", () => {
  it("returns none without a payment header", () => {
    expect(parsePaymentHeader(new Headers())).toEqual({ kind: "none" });
  });

  it("parses a v1 X-PAYMENT header and keeps the raw payload", () => {
    const raw = v1Payload();
    const payment = parse({ "X-PAYMENT": encodeHeaderJson(raw) });
    expect(payment.version).toBe(1);
    expect(payment.raw).toEqual(raw);
    expect(payment.payload.payload.authorization.to).toBe(RECIPIENT);
  });

  it("parses a v2 PAYMENT-SIGNATURE header, preferring it over X-PAYMENT", () => {
    const payment = parse({ "PAYMENT-SIGNATURE": encodeHeaderJson(v2Payload()), "X-PAYMENT": "garbage" });
    expect(payment.version).toBe(2);
  });

  it("accepts base64url", () => {
    const b64url = encodeHeaderJson(v1Payload()).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(parse({ "X-PAYMENT": b64url }).version).toBe(1);
  });

  it.each([
    ["not base64", "%%%"],
    ["not JSON", Buffer.from("hello").toString("base64")],
    ["wrong version", encodeHeaderJson({ ...v1Payload(), x402Version: 2 })],
    ["bad nonce", encodeHeaderJson(v1Payload(authorization({ nonce: "0x01" })))],
    ["float value", encodeHeaderJson(v1Payload(authorization({ value: "2.5" })))],
    ["too large", "A".repeat(9000)],
  ])("rejects %s", (_name, value) => {
    expect(parsePaymentHeader(new Headers({ "X-PAYMENT": value })).kind).toBe("invalid");
  });
});

describe("mismatchReason", () => {
  it("accepts an exact match (v1 and v2)", () => {
    expect(mismatchReason(parse({ "X-PAYMENT": encodeHeaderJson(v1Payload()) }), req)).toBeNull();
    expect(mismatchReason(parse({ "PAYMENT-SIGNATURE": encodeHeaderJson(v2Payload()) }), req)).toBeNull();
  });

  it.each([
    ["wrong network", v1Payload(authorization(), { network: "base-sepolia" })],
    ["wrong scheme", v1Payload(authorization(), { scheme: "upto" })],
    ["underpay", v1Payload(authorization({ value: "2000000" }))],
    ["overpay (breaks exact-amount matching)", v1Payload(authorization({ value: "2000418" }))],
    ["wrong recipient", v1Payload(authorization({ to: PAYER }))],
  ])("v1 rejects %s", (_name, raw) => {
    expect(mismatchReason(parse({ "X-PAYMENT": encodeHeaderJson(raw) }), req)).not.toBeNull();
  });

  it.each([
    ["testnet", { network: "eip155:84532" }],
    ["other asset", { asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }],
    ["other payTo", { payTo: PAYER }],
    ["other amount", { amount: "1" }],
  ])("v2 rejects %s", (_name, accepted) => {
    expect(mismatchReason(parse({ "PAYMENT-SIGNATURE": encodeHeaderJson(v2Payload(accepted)) }), req)).not.toBeNull();
  });
});
