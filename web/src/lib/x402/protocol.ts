import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { BASE_CHAIN_ID, USDC_ADDRESS } from "../constants";

/**
 * x402 wire format for the Tab "exact" USDC rail on Base mainnet. v1 clients read the JSON body
 * (`accepts`) and send `X-PAYMENT`; v2 clients read the `PAYMENT-REQUIRED` header and send
 * `PAYMENT-SIGNATURE`. Both carry an EIP-3009 transferWithAuthorization the facilitator submits.
 */
export const X402_NETWORK_V1 = "base";
export const X402_NETWORK_V2 = `eip155:${BASE_CHAIN_ID}`;
export const X402_MAX_TIMEOUT_SECONDS = 120;
export const X402_MIME_TYPE = "application/json";
/** EIP-712 domain of native USDC on Base; clients need it to sign the authorization. */
export const USDC_EIP712_DOMAIN = { name: "USD Coin", version: "2" } as const;

export const HEADER_PAYMENT_V1 = "x-payment";
export const HEADER_PAYMENT_V2 = "payment-signature";
export const HEADER_REQUIRED_V2 = "PAYMENT-REQUIRED";
export const HEADER_RESPONSE_V1 = "X-PAYMENT-RESPONSE";
export const HEADER_RESPONSE_V2 = "PAYMENT-RESPONSE";

const MAX_HEADER_CHARS = 8192;

export interface PayableRequest {
  id: string;
  recipient: Address;
  uniqueAtomic: bigint;
  memo: string | null;
}

export interface RequirementsV1 {
  scheme: "exact";
  network: typeof X402_NETWORK_V1;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: typeof USDC_EIP712_DOMAIN;
}

export interface RequirementsV2 {
  scheme: "exact";
  network: typeof X402_NETWORK_V2;
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra: typeof USDC_EIP712_DOMAIN;
}

export interface PaymentRequiredV1 {
  x402Version: 1;
  error: string;
  accepts: [RequirementsV1];
}

export interface PaymentRequiredV2 {
  x402Version: 2;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: [RequirementsV2];
  extensions: Record<string, never>;
}

export function resourceUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/x402/r/${encodeURIComponent(id)}`;
}

export function describe(req: PayableRequest): string {
  return req.memo ? `Tab: ${req.memo}` : `Tab payment request ${req.id}`;
}

export function requirementsV1(req: PayableRequest, resource: string): RequirementsV1 {
  return {
    scheme: "exact",
    network: X402_NETWORK_V1,
    maxAmountRequired: req.uniqueAtomic.toString(),
    resource,
    description: describe(req),
    mimeType: X402_MIME_TYPE,
    payTo: getAddress(req.recipient),
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    asset: USDC_ADDRESS,
    extra: USDC_EIP712_DOMAIN,
  };
}

export function requirementsV2(req: PayableRequest): RequirementsV2 {
  return {
    scheme: "exact",
    network: X402_NETWORK_V2,
    amount: req.uniqueAtomic.toString(),
    asset: USDC_ADDRESS,
    payTo: getAddress(req.recipient),
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    extra: USDC_EIP712_DOMAIN,
  };
}

export function paymentRequiredV1(req: PayableRequest, resource: string, error: string): PaymentRequiredV1 {
  return { x402Version: 1, error, accepts: [requirementsV1(req, resource)] };
}

export function paymentRequiredV2(req: PayableRequest, resource: string, error: string): PaymentRequiredV2 {
  return {
    x402Version: 2,
    error,
    resource: { url: resource, description: describe(req), mimeType: X402_MIME_TYPE },
    accepts: [requirementsV2(req)],
    extensions: {},
  };
}

export function encodeHeaderJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeaderJson(value: string): unknown {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error("not base64");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
}

const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "invalid address")
  .transform((v) => getAddress(v));
const uint = z.string().regex(/^(0|[1-9][0-9]*)$/).max(78);
const hex = (bytes?: number) =>
  z.string().regex(bytes ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`) : /^0x[0-9a-fA-F]+$/);

const exactEvmPayload = z.object({
  signature: hex().max(2 + 2 * 4096),
  authorization: z.object({
    from: address,
    to: address,
    value: uint,
    validAfter: uint,
    validBefore: uint,
    nonce: hex(32),
  }),
});

const paymentPayloadV1 = z.object({
  x402Version: z.literal(1),
  scheme: z.string(),
  network: z.string(),
  payload: exactEvmPayload,
});

const paymentPayloadV2 = z.object({
  x402Version: z.literal(2),
  resource: z.unknown().optional(),
  accepted: z.object({
    scheme: z.string(),
    network: z.string(),
    amount: uint,
    asset: address,
    payTo: address,
    maxTimeoutSeconds: z.number().optional(),
    extra: z.unknown().optional(),
  }),
  payload: exactEvmPayload,
  extensions: z.unknown().optional(),
});

export type PaymentPayloadV1 = z.infer<typeof paymentPayloadV1>;
export type PaymentPayloadV2 = z.infer<typeof paymentPayloadV2>;

/** `raw` is the decoded JSON exactly as the client sent it; facilitators verify that, not our re-serialization. */
export type ParsedPayment =
  | { version: 1; payload: PaymentPayloadV1; raw: unknown }
  | { version: 2; payload: PaymentPayloadV2; raw: unknown };

export type ParseResult = { kind: "none" } | { kind: "invalid"; error: string } | { kind: "ok"; payment: ParsedPayment };

/** Reads the payment header; v2 `PAYMENT-SIGNATURE` wins if a client sends both. */
export function parsePaymentHeader(headers: Headers): ParseResult {
  const v2 = headers.get(HEADER_PAYMENT_V2);
  const v1 = headers.get(HEADER_PAYMENT_V1);
  const value = v2 ?? v1;
  if (value == null || value.trim() === "") return { kind: "none" };
  if (value.length > MAX_HEADER_CHARS) return { kind: "invalid", error: "Payment header too large" };

  let raw: unknown;
  try {
    raw = decodeHeaderJson(value);
  } catch {
    return { kind: "invalid", error: "Payment header is not base64-encoded JSON" };
  }
  const expectV2 = v2 != null;
  const parsed = expectV2 ? paymentPayloadV2.safeParse(raw) : paymentPayloadV1.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { kind: "invalid", error: `Malformed x402 v${expectV2 ? 2 : 1} payment: ${where}${issue?.message ?? "invalid"}` };
  }
  return {
    kind: "ok",
    payment: expectV2
      ? { version: 2, payload: parsed.data as PaymentPayloadV2, raw }
      : { version: 1, payload: parsed.data as PaymentPayloadV1, raw },
  };
}

/**
 * Local pre-check before spending a facilitator round trip: the signed authorization must pay
 * exactly this request's unique amount to its recipient on Base. Exact equality matters because
 * the chain matcher pairs transfers to requests by (recipient, unique_atomic).
 */
export function mismatchReason(payment: ParsedPayment, req: PayableRequest): string | null {
  const p = payment.payload;
  if (payment.version === 1) {
    const v1 = p as PaymentPayloadV1;
    if (v1.scheme !== "exact") return "Unsupported scheme; expected exact";
    if (v1.network !== X402_NETWORK_V1) return `Unsupported network; expected ${X402_NETWORK_V1}`;
  } else {
    const v2 = p as PaymentPayloadV2;
    if (v2.accepted.scheme !== "exact") return "Unsupported scheme; expected exact";
    if (v2.accepted.network !== X402_NETWORK_V2) return `Unsupported network; expected ${X402_NETWORK_V2}`;
    if (v2.accepted.asset !== USDC_ADDRESS) return "Unsupported asset; expected Base USDC";
    if (v2.accepted.payTo !== getAddress(req.recipient)) return "accepted.payTo does not match the request recipient";
    if (BigInt(v2.accepted.amount) !== req.uniqueAtomic) return "accepted.amount does not match the request amount";
  }
  const auth = p.payload.authorization;
  if (auth.to !== getAddress(req.recipient)) return "Authorization recipient does not match the request";
  if (BigInt(auth.value) !== req.uniqueAtomic) return "Authorization value must equal the request's exact amount";
  return null;
}
