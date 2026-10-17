import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { formatUsdc } from "../lib/amount.js";
import { isNotFound } from "../lib/api.js";
import { requireApiBase } from "../lib/config.js";
import type { ToolContext } from "../lib/context.js";
import { betView, betViewSchema, dealView, dealViewSchema, loadBet, loadDeal, type ActionAvailability } from "../lib/escrow.js";
import { parseRef } from "../lib/refs.js";
import { fromRecord, requestView, requestViewSchema, resolveRequest, verifyRequests, type RequestView } from "../lib/requests.js";
import { readResult } from "../lib/result.js";
import { quoteUntrusted, sanitizeText } from "../lib/sanitize.js";
import { LIMITS } from "../lib/constants.js";

export const statusInput = z.object({
  ref: z.string().min(1).max(2100).describe("A request link or id, split link or id (or split:<id>), deal:<n> or …/d/<n>, bet:<n> or …/b/<n>."),
}).strict();

const splitViewSchema = z.object({
  id: z.string(),
  url: z.string(),
  recipient: z.string(),
  memo: z.string().nullable(),
  total: z.string(),
  collected: z.string(),
  collected_atomic: z.string(),
  outstanding: z.string(),
  outstanding_atomic: z.string(),
  paid_count: z.number().int(),
  member_count: z.number().int(),
  fully_verified: z.boolean(),
  members: z.array(requestViewSchema),
}).strict();
type SplitView = z.infer<typeof splitViewSchema>;

export const statusOutput = z.object({
  type: z.enum(["request", "split", "deal", "bet"]),
  summary: z.string(),
  request: requestViewSchema.nullable(),
  split: splitViewSchema.nullable(),
  deal: dealViewSchema.nullable(),
  bet: betViewSchema.nullable(),
}).strict();
type StatusOutput = z.infer<typeof statusOutput>;

export const statusTool = {
  name: "tab_status",
  title: "Check a Tab",
  description:
    "Check the on-chain-verified status of anything Tab created: a payment request (open / paid / paid_late / " +
    "expired / checking), a split (who paid, collected vs outstanding), an escrowed deal, or a bet. Payment status " +
    "is proven from Base USDC transfer logs, not trusted from the server; \"checking\" means the scan could not " +
    "finish in time (never treat it as unpaid; retry). For deals and bets it returns state, parties, amounts, " +
    "deadlines and available_actions (who can act now, or from when). Use after tab_pay confirms, or when the user " +
    "asks \"did Meera pay?\". Read-only.",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
} as const;

function empty(type: StatusOutput["type"], summary: string): StatusOutput {
  return { type, summary, request: null, split: null, deal: null, bet: null };
}

export function describeRequest(view: RequestView): string {
  const who = view.payer_label ? `${quoteUntrusted(view.payer_label)} ` : "";
  switch (view.status) {
    case "paid":
    case "paid_late":
      return `${who}paid ${view.unique_amount} USDC${view.paid_at ? ` at ${view.paid_at}` : ""} (tx ${view.paid_tx ?? "?"})${view.status === "paid_late" ? ", after the link expired" : ""}.`;
    case "expired":
      return `${who}request for ${view.amount} USDC expired unpaid at ${view.expires_at}.`;
    case "checking":
      return `${who}request for ${view.amount} USDC: payment could not be verified on-chain yet (scan incomplete). Retry shortly.`;
    default:
      return `${who}request for ${view.amount} USDC is open (pay exactly ${view.unique_amount} USDC at ${view.url}).`;
  }
}

export function describeActions(actions: readonly ActionAvailability[]): string {
  if (actions.length === 0) return "No further actions (final state).";
  return actions.map((a) => `${a.action} (${a.by}): ${a.available_now ? "available now" : a.available_at ? `from ${a.available_at}` : "not available"}`).join("; ");
}

async function splitStatus(ctx: ToolContext, id: string): Promise<StatusOutput> {
  const base = requireApiBase(ctx.config);
  const detail = await ctx.api().getSplit(id);
  const members = detail.requests.map((r) => fromRecord(r, r.paid_tx ? { id: r.id, status: r.status, paid_tx: r.paid_tx, paid_at: r.paid_at, payer_address: r.payer_address, checked_at: r.created_at } : null));
  const verified = await verifyRequests(ctx, members);
  const views = members.map((m) => requestView(base, m, verified.get(m.id) ?? { status: "checking", finding: { status: "checking", reason: "not scanned" } }));
  const paid = views.filter((v) => v.status === "paid" || v.status === "paid_late");
  const collected = paid.reduce((sum, v) => sum + BigInt(v.unique_atomic), 0n);
  const outstanding = views.filter((v) => !paid.includes(v)).reduce((sum, v) => sum + BigInt(v.unique_atomic), 0n);
  const split: SplitView = {
    id: detail.split.id,
    url: `${base}/s/${detail.split.id}`,
    recipient: members[0]?.recipient ?? detail.split.recipient,
    memo: sanitizeText(detail.split.memo, LIMITS.memo) ?? null,
    total: formatUsdc(BigInt(detail.split.total_atomic)),
    collected: formatUsdc(collected),
    collected_atomic: collected.toString(),
    outstanding: formatUsdc(outstanding),
    outstanding_atomic: outstanding.toString(),
    paid_count: paid.length,
    member_count: views.length,
    fully_verified: views.every((v) => v.verified_on_chain),
    members: views,
  };
  const summary = `Split ${split.url}: ${split.paid_count}/${split.member_count} paid, collected ${split.collected} USDC, outstanding ${split.outstanding} USDC.\n` +
    views.map((v) => `• ${describeRequest(v)}`).join("\n");
  return { ...empty("split", summary), split };
}

export async function status(input: z.infer<typeof statusInput>, ctx: ToolContext): Promise<CallToolResult> {
  const ref = parseRef(input.ref);
  const nowSeconds = Math.floor(ctx.now() / 1000);
  let output: StatusOutput;
  if (ref.kind === "deal") {
    const deal = dealView(requireApiBase(ctx.config), ref.id, await loadDeal(ctx, ref.id), nowSeconds);
    output = { ...empty("deal", `${deal.alerts.map((a) => `${a}\n`).join("")}Deal #${deal.id}: ${deal.state}, ${deal.amount} USDC from ${deal.buyer} to ${deal.seller}, deliver by ${deal.deliver_by}. ${describeActions(deal.available_actions)}`), deal };
  } else if (ref.kind === "bet") {
    const bet = betView(requireApiBase(ctx.config), ref.id, await loadBet(ctx, ref.id), nowSeconds);
    const condition = bet.price_condition ? ` Creator wins if ${bet.price_condition.creator_wins_if}.` : "";
    output = { ...empty("bet", `Bet #${bet.id} (${bet.kind}): ${bet.state}, ${bet.stake} USDC each, resolves ${bet.resolve_at}.${condition} ${describeActions(bet.available_actions)}`), bet };
  } else if (ref.kind === "split") {
    output = await splitStatus(ctx, ref.id);
  } else {
    const base = requireApiBase(ctx.config);
    let req;
    try {
      req = await resolveRequest(ctx, { kind: ref.kind === "payload" ? "payload" : "request", id: ref.id });
    } catch (error) {
      if (ref.kind === "request_or_split" && isNotFound(error)) {
        output = await splitStatus(ctx, ref.id);
        return readResult(output, output.summary);
      }
      throw error;
    }
    const verified = await verifyRequests(ctx, [req]);
    const view = requestView(base, req, verified.get(req.id) ?? { status: "checking", finding: { status: "checking", reason: "not scanned" } });
    output = { ...empty("request", describeRequest(view)), request: view };
  }
  return readResult(output, output.summary);
}
