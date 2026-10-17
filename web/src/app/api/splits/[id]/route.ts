import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/server/errors";
import { enforceRateLimit, json, parseParam, route } from "@/lib/server/http";
import { READ_POLICY } from "@/lib/server/rate-limit";
import { getSplit } from "@/lib/server/requests";
import { requestIdParam } from "@/lib/server/schemas";

export const GET = route("GET /api/splits/:id", async (request: Request, ctx: RouteContext<"/api/splits/[id]">) => {
  enforceRateLimit(request, READ_POLICY);
  const id = parseParam((await ctx.params).id, requestIdParam, "split id");
  const split = await getSplit(await getDb(), id);
  if (!split) throw new ApiError("not_found", "Split not found");
  return json(split);
});
