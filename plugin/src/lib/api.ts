import * as z from "zod/v4";

import { NetError, ToolError } from "./errors.js";
import { fetchJson, type Budget, type FetchFn } from "./net.js";

// Wire types for the Tab API. Spec: shared/api-contract.md. Responses are parsed leniently (extra fields are
// ignored so the server can evolve) but every field we rely on is validated.

const atomic = z.string().regex(/^(0|[1-9][0-9]{0,40})$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const isoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const id = z.string().min(1).max(2048);

export const requestStatusSchema = z.enum(["open", "paid", "expired", "paid_late", "checking"]);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const requestRecordSchema = z.object({
  id,
  split_id: z.string().nullable(),
  recipient: address,
  amount_atomic: atomic,
  unique_atomic: atomic,
  memo: z.string().nullable(),
  payer_label: z.string().nullable(),
  requester_label: z.string().nullable(),
  created_at: isoTime,
  expires_at: isoTime,
  start_block: atomic,
  signature: z.string().nullable(),
  status: requestStatusSchema,
  paid_tx: txHash.nullable(),
  paid_at: isoTime.nullable(),
  payer_address: address.nullable(),
});
export type RequestRecord = z.infer<typeof requestRecordSchema>;

export const splitRecordSchema = z.object({
  id,
  recipient: address,
  total_atomic: atomic,
  memo: z.string().nullable(),
  requester_label: z.string().nullable(),
  created_at: isoTime,
});
export type SplitRecord = z.infer<typeof splitRecordSchema>;

export const createSplitResponseSchema = z.object({
  split: splitRecordSchema,
  requests: z.array(requestRecordSchema),
});
export type CreateSplitResponse = z.infer<typeof createSplitResponseSchema>;

export const requestStatusResponseSchema = z.object({
  id,
  status: requestStatusSchema,
  paid_tx: txHash.nullable(),
  paid_at: isoTime.nullable(),
  payer_address: address.nullable(),
  checked_at: isoTime,
});
export type RequestStatusResponse = z.infer<typeof requestStatusResponseSchema>;

export const splitDetailSchema = z.object({
  split: splitRecordSchema,
  requests: z.array(requestRecordSchema),
  collected_atomic: atomic,
  outstanding_atomic: atomic,
});
export type SplitDetail = z.infer<typeof splitDetailSchema>;

const escrowRef = z.object({ id: z.string().regex(/^[1-9][0-9]{0,30}$/), role: z.string(), state: z.string() });
export const addressTabsSchema = z.object({
  address,
  owed_to_you: z.array(requestRecordSchema),
  you_owe: z.array(requestRecordSchema),
  deals: z.array(escrowRef),
  bets: z.array(escrowRef),
});
export type AddressTabs = z.infer<typeof addressTabsSchema>;

export const termsResponseSchema = z.object({ hash: z.string(), created_at: isoTime });

export const dealDetailSchema = z.object({ id: z.string(), terms: z.string().nullable() });
export const betDetailSchema = z.object({ id: z.string(), terms: z.string().nullable() });

const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export interface CreateRequestBody {
  recipient: string;
  amount_atomic: string;
  memo?: string;
  payer_label?: string;
  requester_label?: string;
  expires_at: string;
  start_block: string;
}

export interface CreateSplitBody {
  recipient: string;
  total_atomic: string;
  memo?: string;
  requester_label?: string;
  expires_at: string;
  start_block: string;
  requests: { payer_label: string; amount_atomic: string }[];
}

/** API answered with a 4xx error body. Distinct from `NetError` (unreachable), which callers may degrade on. */
export class ApiError extends ToolError {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`Tab API rejected the call (${status} ${code}): ${message.slice(0, 200)}`,
      status === 401 || status === 403 ? "The plugin's Authorization secret for the Tab API host is missing or wrong in the PayBox portal." : undefined);
    this.status = status;
    this.code = code;
  }
}

export class TabApi {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchFn,
    private readonly budget: Budget,
  ) {}

  private async call<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}): Promise<T> {
    const { status, json } = await fetchJson(this.fetchFn, this.budget, `${this.base}${path}`, init);
    if (status < 200 || status >= 300) {
      const parsed = apiErrorSchema.safeParse(json);
      throw new ApiError(status, parsed.success ? parsed.data.error.code : "error", parsed.success ? parsed.data.error.message : `HTTP ${status}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new NetError("parse", new URL(this.base).host, `Tab API returned an unexpected response shape for ${path.split("?")[0]}.`);
    return parsed.data;
  }

  createRequest(body: CreateRequestBody): Promise<RequestRecord> {
    return this.call(requestRecordSchema, "/api/requests", { method: "POST", body: JSON.stringify(body) });
  }

  createSplit(body: CreateSplitBody): Promise<CreateSplitResponse> {
    return this.call(createSplitResponseSchema, "/api/splits", { method: "POST", body: JSON.stringify(body) });
  }

  storeTerms(hash: string, body: string): Promise<z.infer<typeof termsResponseSchema>> {
    return this.call(termsResponseSchema, "/api/terms", { method: "POST", body: JSON.stringify({ hash, body }) });
  }

  setPayer(requestId: string, payerAddress: string): Promise<RequestRecord> {
    return this.call(requestRecordSchema, `/api/requests/${encodeURIComponent(requestId)}/payer`, { method: "POST", body: JSON.stringify({ payer_address: payerAddress }) });
  }

  getRequest(requestId: string): Promise<RequestRecord> {
    return this.call(requestRecordSchema, `/api/requests/${encodeURIComponent(requestId)}`);
  }

  getRequestStatus(requestId: string): Promise<RequestStatusResponse> {
    return this.call(requestStatusResponseSchema, `/api/requests/${encodeURIComponent(requestId)}/status`);
  }

  getSplit(splitId: string): Promise<SplitDetail> {
    return this.call(splitDetailSchema, `/api/splits/${encodeURIComponent(splitId)}`);
  }

  getAddressTabs(addr: string, status: "open" | "all"): Promise<AddressTabs> {
    return this.call(addressTabsSchema, `/api/addresses/${encodeURIComponent(addr)}/tabs?status=${status}`);
  }

  getDealTerms(dealId: bigint): Promise<z.infer<typeof dealDetailSchema>> {
    return this.call(dealDetailSchema, `/api/escrow/deals/${dealId.toString()}`);
  }

  getBetTerms(betId: bigint): Promise<z.infer<typeof betDetailSchema>> {
    return this.call(betDetailSchema, `/api/escrow/bets/${betId.toString()}`);
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
