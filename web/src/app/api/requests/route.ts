import { getDb } from "@/lib/db/client";
import { enforceRateLimit, json, parseBody, requirePluginKey, route } from "@/lib/server/http";
import { CREATE_POLICY } from "@/lib/server/rate-limit";
import { createRequest } from "@/lib/server/requests";
import { createRequestBody } from "@/lib/server/schemas";

export const POST = route("POST /api/requests", async (request: Request) => {
  requirePluginKey(request);
  enforceRateLimit(request, CREATE_POLICY, "plugin");
  const body = await parseBody(request, createRequestBody);
  const record = await createRequest(await getDb(), {
    recipient: body.recipient,
    amountAtomic: body.amount_atomic,
    memo: body.memo,
    payerLabel: body.payer_label,
    requesterLabel: body.requester_label,
    expiresAt: body.expires_at,
    startBlock: body.start_block,
  });
  return json(record, 201);
});
