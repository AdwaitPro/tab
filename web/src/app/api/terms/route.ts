import { getDb } from "@/lib/db/client";
import { storeTerms } from "@/lib/server/escrow";
import { enforceRateLimit, json, parseBody, requirePluginKey, route } from "@/lib/server/http";
import { CREATE_POLICY } from "@/lib/server/rate-limit";
import { isoSeconds } from "@/lib/server/records";
import { createTermsBody } from "@/lib/server/schemas";

export const POST = route("POST /api/terms", async (request: Request) => {
  requirePluginKey(request);
  enforceRateLimit(request, CREATE_POLICY, "plugin");
  const { hash, body } = await parseBody(request, createTermsBody);
  const result = await storeTerms(await getDb(), hash, body);
  return json({ hash, created_at: isoSeconds(result.createdAt) }, result.created ? 201 : 200);
});
