import { getDb } from "@/lib/db/client";
import { enforceRateLimit, json, parseParam, route } from "@/lib/server/http";
import { escrowObjectsFor, indexEscrow } from "@/lib/server/indexer";
import { READ_POLICY } from "@/lib/server/rate-limit";
import { listRequestsFor } from "@/lib/server/requests";
import { addressSchema, tabsQuery } from "@/lib/server/schemas";
import { TERMINAL_BET_STATES, TERMINAL_DEAL_STATES, type BetState, type DealState } from "@/lib/escrow-types";
import type { EscrowObjectRow } from "@/lib/db/schema";

function dealRole(row: EscrowObjectRow, address: string): "buyer" | "seller" | "arbiter" {
  if (row.data.buyer?.toLowerCase() === address) return "buyer";
  if (row.data.seller?.toLowerCase() === address) return "seller";
  return "arbiter";
}

function betRole(row: EscrowObjectRow, address: string): "creator" | "opponent" | "arbiter" {
  if (row.data.creator?.toLowerCase() === address) return "creator";
  if (row.data.opponent?.toLowerCase() === address) return "opponent";
  return "arbiter";
}

export const GET = route(
  "GET /api/addresses/:addr/tabs",
  async (request: Request, ctx: RouteContext<"/api/addresses/[addr]/tabs">) => {
    enforceRateLimit(request, READ_POLICY);
    const address = parseParam((await ctx.params).addr, addressSchema, "address");
    const scope = parseParam(new URL(request.url).searchParams.get("status") ?? undefined, tabsQuery, "status");
    const db = await getDb();
    // On-demand catch-up so freshly created deals/bets list without waiting for cron; failures are non-fatal.
    await indexEscrow(db, { budgetMs: 2500 }).catch(() => null);
    const [{ owedToYou, youOwe }, deals, bets] = await Promise.all([
      listRequestsFor(db, address, scope),
      escrowObjectsFor(db, address, "deal"),
      escrowObjectsFor(db, address, "bet"),
    ]);
    const lower = address.toLowerCase();
    return json({
      address,
      owed_to_you: owedToYou,
      you_owe: youOwe,
      deals: deals
        .filter((d) => scope === "all" || !TERMINAL_DEAL_STATES.includes(d.state as DealState))
        .map((d) => ({ id: d.id.toString(), role: dealRole(d, lower), state: d.state })),
      bets: bets
        .filter((b) => scope === "all" || !TERMINAL_BET_STATES.includes(b.state as BetState))
        .map((b) => ({ id: b.id.toString(), role: betRole(b, lower), state: b.state })),
    });
  },
);
