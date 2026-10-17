import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/server/errors";
import { readDeal } from "@/lib/server/escrow";
import { enforceRateLimit, json, parseParam, route } from "@/lib/server/http";
import { READ_POLICY } from "@/lib/server/rate-limit";
import { escrowIdParam } from "@/lib/server/schemas";

export const GET = route("GET /api/escrow/deals/:id", async (request: Request, ctx: RouteContext<"/api/escrow/deals/[id]">) => {
  enforceRateLimit(request, READ_POLICY);
  const id = parseParam((await ctx.params).id, escrowIdParam, "deal id");
  const deal = await readDeal(await getDb(), id);
  if (!deal) throw new ApiError("not_found", "Deal not found");
  return json(deal);
});
