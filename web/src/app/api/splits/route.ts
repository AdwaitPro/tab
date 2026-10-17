import { getDb } from "@/lib/db/client";
import { enforceRateLimit, json, parseBody, requirePluginKey, route } from "@/lib/server/http";
import { CREATE_POLICY } from "@/lib/server/rate-limit";
import { createSplit } from "@/lib/server/requests";
import { createSplitBody } from "@/lib/server/schemas";

export const POST = route("POST /api/splits", async (request: Request) => {
  requirePluginKey(request);
  enforceRateLimit(request, CREATE_POLICY, "plugin");
  const body = await parseBody(request, createSplitBody);
  const result = await createSplit(await getDb(), {
    recipient: body.recipient,
    totalAtomic: body.total_atomic,
    memo: body.memo,
    requesterLabel: body.requester_label,
    expiresAt: body.expires_at,
    startBlock: body.start_block,
    members: body.requests.map((r) => ({ payerLabel: r.payer_label, amountAtomic: r.amount_atomic })),
  });
  return json(result, 201);
});
