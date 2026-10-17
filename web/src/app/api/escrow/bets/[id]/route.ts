import { getAddress } from "viem";
import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/server/errors";
import { readBet, readPrice } from "@/lib/server/escrow";
import { enforceRateLimit, json, parseParam, route } from "@/lib/server/http";
import { READ_POLICY } from "@/lib/server/rate-limit";
import { escrowIdParam } from "@/lib/server/schemas";
import { settlementFor } from "@/lib/server/settlement";

export const GET = route("GET /api/escrow/bets/:id", async (request: Request, ctx: RouteContext<"/api/escrow/bets/[id]">) => {
  enforceRateLimit(request, READ_POLICY);
  const id = parseParam((await ctx.params).id, escrowIdParam, "bet id");
  const bet = await readBet(await getDb(), id);
  if (!bet) throw new ApiError("not_found", "Bet not found");
  // Live Chainlink quote for the page ticker; absent rather than failing the whole read.
  const [price, settlement] = await Promise.all([
    bet.feed ? readPrice(getAddress(bet.feed)).catch(() => null) : null,
    settlementFor(bet).catch(() => null),
  ]);
  return json({ ...bet, price, settlement });
});
