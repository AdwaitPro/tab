import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/server/errors";
import { enforceRateLimit, json, parseBody, parseParam, route } from "@/lib/server/http";
import { CREATE_POLICY } from "@/lib/server/rate-limit";
import { setPayerIfUnknown } from "@/lib/server/requests";
import { payerBody, requestIdParam } from "@/lib/server/schemas";

/** Records who intends to pay (page connect or tab_pay) so "you owe" lists work. Only fills a null payer. */
export const POST = route("POST /api/requests/:id/payer", async (request: Request, ctx: RouteContext<"/api/requests/[id]/payer">) => {
  enforceRateLimit(request, CREATE_POLICY);
  const id = parseParam((await ctx.params).id, requestIdParam, "request id");
  const { payer_address } = await parseBody(request, payerBody);
  const record = await setPayerIfUnknown(await getDb(), id, payer_address);
  if (!record) throw new ApiError("not_found", "Request not found");
  return json(record);
});
