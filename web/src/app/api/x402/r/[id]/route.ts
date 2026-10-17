import { blockTime } from "@/lib/chain/rpc";
import { getDb } from "@/lib/db/client";
import { liveChain } from "@/lib/server/chain-deps";
import { publicBaseUrl } from "@/lib/server/env";
import { ApiError } from "@/lib/server/errors";
import { enforceRateLimit, json, parseParam, route } from "@/lib/server/http";
import { READ_POLICY } from "@/lib/server/rate-limit";
import { getRequestRow } from "@/lib/server/requests";
import { requestIdParam } from "@/lib/server/schemas";
import { httpFacilitator, type SettleResponse } from "@/lib/x402/facilitator";
import { payableFrom, payWithX402, settlementFromRecord } from "@/lib/x402/pay";
import {
  encodeHeaderJson,
  HEADER_REQUIRED_V2,
  HEADER_RESPONSE_V1,
  HEADER_RESPONSE_V2,
  parsePaymentHeader,
  paymentRequiredV1,
  paymentRequiredV2,
  resourceUrl,
  type PayableRequest,
} from "@/lib/x402/protocol";
import { receiptTransfers } from "@/lib/x402/receipt";
import { txUrl } from "@/lib/constants";
import { toRequestRecord, type RequestRecord } from "@/lib/server/records";

/** verify + settle + receipt wait; PayAI's settle budget alone can approach 100 s under congestion. */
export const maxDuration = 120;

const EXPOSE = { "access-control-expose-headers": `${HEADER_REQUIRED_V2}, ${HEADER_RESPONSE_V1}, ${HEADER_RESPONSE_V2}` };

function paymentRequired(req: PayableRequest, resource: string, error: string): Response {
  return json(paymentRequiredV1(req, resource, error), 402, {
    ...EXPOSE,
    [HEADER_REQUIRED_V2]: encodeHeaderJson(paymentRequiredV2(req, resource, error)),
  });
}

function receipt(record: RequestRecord, settlement: SettleResponse | null, version: 1 | 2): Response {
  const response = settlement ?? settlementFromRecord(record, version);
  const headers: Record<string, string> = { ...EXPOSE };
  if (response) headers[version === 2 ? HEADER_RESPONSE_V2 : HEADER_RESPONSE_V1] = encodeHeaderJson(response);
  return json(
    {
      request: record,
      payment: {
        rail: "x402",
        status: record.status,
        tx: record.paid_tx,
        tx_url: record.paid_tx ? txUrl(record.paid_tx) : null,
        payer: record.payer_address,
        amount_atomic: record.unique_atomic,
        paid_at: record.paid_at,
      },
    },
    200,
    headers,
  );
}

export const GET = route("GET /api/x402/r/:id", async (request: Request, ctx: RouteContext<"/api/x402/r/[id]">) => {
  enforceRateLimit(request, READ_POLICY);
  const id = parseParam(decodeURIComponent((await ctx.params).id), requestIdParam, "request id");
  const db = await getDb();
  const row = await getRequestRow(db, id);
  if (!row) throw new ApiError("not_found", "Request not found");

  const resource = resourceUrl(publicBaseUrl(), id);
  const req = payableFrom(row);
  const header = parsePaymentHeader(request.headers);
  if (header.kind === "invalid") return paymentRequired(req, resource, header.error);
  const version = header.kind === "ok" ? header.payment.version : 1;

  if (header.kind === "none") {
    const record = toRequestRecord(row);
    if (record.status === "paid" || record.status === "paid_late") return receipt(record, null, version);
    if (record.status === "expired") throw new ApiError("not_found", "Request expired", 410);
    return paymentRequired(req, resource, "Payment required: send X-PAYMENT (x402 v1) or PAYMENT-SIGNATURE (v2)");
  }

  const outcome = await payWithX402(db, row, header.payment, resource, {
    facilitator: httpFacilitator(),
    receiptTransfers: (hash) => receiptTransfers(hash),
    blockTime: (block) => blockTime(block),
    liveChain: liveChain(4000),
  });
  switch (outcome.kind) {
    case "paid":
      return receipt(outcome.record, outcome.settlement, version);
    case "expired":
      throw new ApiError("not_found", "Request expired", 410);
    case "payment_required":
      return paymentRequired(req, resource, outcome.error);
    case "pending":
      return json(
        {
          error: {
            code: "internal",
            message: "Settlement is in flight; retry the same request with the same payment header",
          },
          transaction: outcome.settlement.transaction ?? null,
        },
        503,
        { ...EXPOSE, "retry-after": "5" },
      );
    case "failed":
      throw new ApiError("internal", outcome.error, 502);
  }
});
