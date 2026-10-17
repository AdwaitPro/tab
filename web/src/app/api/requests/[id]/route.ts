import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/server/errors";
import { enforceRateLimit, json, parseParam, route } from "@/lib/server/http";
import { READ_POLICY } from "@/lib/server/rate-limit";
import { resolveRequest } from "@/lib/server/resolve";
import { payloadOrIdParam } from "@/lib/server/schemas";

export const GET = route("GET /api/requests/:id", async (request: Request, ctx: RouteContext<"/api/requests/[id]">) => {
  enforceRateLimit(request, READ_POLICY);
  const id = parseParam(decodeURIComponent((await ctx.params).id), payloadOrIdParam, "request id");
  const resolved = await resolveRequest(await getDb(), id);
  if (!resolved) throw new ApiError("not_found", "Request not found");
  return json(resolved.record);
});
