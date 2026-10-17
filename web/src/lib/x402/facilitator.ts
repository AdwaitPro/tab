import { z } from "zod";

/** PayAI's public lane settles ordinary `exact` payments on Base mainnet without an API key. */
export const DEFAULT_FACILITATOR_URL = "https://facilitator.payai.network";
const VERIFY_TIMEOUT_MS = 15_000;
/** PayAI answers `settlement_pending` after ~100 s; stay under the function's maxDuration. */
const SETTLE_TIMEOUT_MS = 90_000;

const verifyResponse = z.object({
  isValid: z.boolean(),
  invalidReason: z.string().nullish(),
  payer: z.string().nullish(),
});

const settleResponse = z.object({
  success: z.boolean(),
  errorReason: z.string().nullish(),
  errorMessage: z.string().nullish(),
  transaction: z.string().nullish(),
  network: z.string().nullish(),
  payer: z.string().nullish(),
});

export type VerifyResponse = z.infer<typeof verifyResponse>;
export type SettleResponse = z.infer<typeof settleResponse>;

export interface FacilitatorRequest {
  x402Version: 1 | 2;
  paymentPayload: unknown;
  paymentRequirements: unknown;
}

export interface Facilitator {
  verify(body: FacilitatorRequest): Promise<VerifyResponse>;
  settle(body: FacilitatorRequest): Promise<SettleResponse>;
}

export class FacilitatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacilitatorError";
  }
}

export function facilitatorUrl(): string {
  return (process.env.X402_FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL).replace(/\/+$/, "");
}

async function post<S extends z.ZodType>(
  base: string,
  path: string,
  body: FacilitatorRequest,
  schema: S,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new FacilitatorError(`facilitator ${path} unreachable: ${error instanceof Error ? error.message : "unknown"}`);
  }
  const text = await response.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FacilitatorError(`facilitator ${path} returned non-JSON (HTTP ${response.status})`);
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // 409 duplicate_settlement and similar carry a reason but not the settle shape.
  const reason = typeof raw === "object" && raw && "error" in raw ? String((raw as { error: unknown }).error) : "";
  throw new FacilitatorError(`facilitator ${path} HTTP ${response.status}${reason ? `: ${reason}` : ""}`);
}

export function httpFacilitator(base: string = facilitatorUrl(), fetchImpl: typeof fetch = fetch): Facilitator {
  return {
    verify: (body) => post(base, "/verify", body, verifyResponse, VERIFY_TIMEOUT_MS, fetchImpl),
    settle: (body) => post(base, "/settle", body, settleResponse, SETTLE_TIMEOUT_MS, fetchImpl),
  };
}
