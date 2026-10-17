import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/server/errors";
import { enforceRateLimit, json, parseParam, route } from "@/lib/server/http";
import { READ_POLICY } from "@/lib/server/rate-limit";
import { resolveStatus } from "@/lib/server/resolve";
import { payloadOrIdParam } from "@/lib/server/schemas";

export const GET = route(
  "GET /api/requests/:id/status",
  async (request: Request, ctx: RouteContext<"/api/requests/[id]/status">) => {
    enforceRateLimit(request, READ_POLICY);
    const id = parseParam(decodeURIComponent((await ctx.params).id), payloadOrIdParam, "request id");
    const status = await resolveStatus(await getDb(), id);
    if (!status) throw new ApiError("not_found", "Request not found");
    return json(status);
  },
);
