import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { checksum } from "../lib/address.js";
import { formatUsdc } from "../lib/amount.js";
import { requireApiBase } from "../lib/config.js";
import { LIMITS } from "../lib/constants.js";
import type { ToolContext } from "../lib/context.js";
import { betView, betViewSchema, dealView, dealViewSchema, loadBet, loadDeal, type BetView, type DealView } from "../lib/escrow.js";
import { addressInput } from "../lib/inputs.js";
import { fromRecord, requestView, requestViewSchema, verifyRequests, type RequestView } from "../lib/requests.js";
import { readResult } from "../lib/result.js";
import { quoteUntrusted } from "../lib/sanitize.js";
import { relative } from "../lib/time.js";
import { readOwed } from "../lib/withdraw.js";

export const listInput = z.object({
  address: addressInput.describe("The wallet to list for (usually the user's own PayBox EVM address)."),
  include: z.array(z.enum(["requests", "deals", "bets"])).min(1).max(3).optional().describe("Sections to include (default all)."),
  status: z.enum(["open", "all"]).default("open").describe("open (default): unsettled items plus their latest payments; all: history too."),
}).strict();

export const listOutput = z.object({
  address: z.string(),
  owed_to_you: z.array(requestViewSchema),
  you_owe: z.array(requestViewSchema),
  deals: z.array(dealViewSchema),
  bets: z.array(betViewSchema),
  owed_to_you_total: z.string(),
  owed_to_you_total_atomic: z.string(),
  you_owe_total: z.string(),
  locked_in_escrow_total: z.string(),
  locked_in_escrow_total_atomic: z.string(),
  escrow_owed: z.string().describe("USDC TabEscrow holds for this address after a failed payout; collect with deal_action withdraw."),
  escrow_owed_atomic: z.string(),
  truncated: z.boolean().describe("True when more than 10 deals/bets exist; only the newest 10 of each were verified."),
  summary: z.string(),
}).strict();
type ListOutput = z.infer<typeof listOutput>;

export const listTool = {
  name: "tab_list",
  title: "List my Tabs",
  description:
    "Everything open for an address: requests owed to it (with on-chain-verified paid/unpaid), requests it owes, " +
    "escrowed deals and bets it is part of, plus totals (owed to you, locked in escrow) and a one-paragraph summary. " +
    "Use for \"who still owes me?\", \"what do I owe?\", \"what's locked?\". Deals and bets are re-read from the " +
    "contract (newest 10 each). Amounts are decimal USDC strings with exact *_atomic twins. Read-only.",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
} as const;

const OPEN = new Set(["open", "checking"]);

function sum(views: readonly RequestView[]): bigint {
  return views.filter((v) => OPEN.has(v.status)).reduce((total, v) => total + BigInt(v.amount_atomic), 0n);
}

function locked(deals: readonly DealView[], bets: readonly BetView[]): bigint {
  const dealLocked = deals.filter((d) => d.state === "Funded" || d.state === "Delivered" || d.state === "Disputed")
    .reduce((t, d) => t + BigInt(d.amount_atomic), 0n);
  const betLocked = bets.reduce((t, b) => t + (b.state === "Open" ? BigInt(b.stake_atomic) : b.state === "Matched" ? 2n * BigInt(b.stake_atomic) : 0n), 0n);
  return dealLocked + betLocked;
}

function who(view: RequestView): string {
  return view.payer_label ? quoteUntrusted(view.payer_label) : `request ${view.id.slice(0, 8)}`;
}

export function summarize(out: Omit<ListOutput, "summary">, nowSeconds: number): string {
  const parts: string[] = out.deals.flatMap((d) => d.alerts.map((a) => `${a.replace(/\.$/, "")} (deal #${d.id}).`));
  const openOwed = out.owed_to_you.filter((v) => OPEN.has(v.status));
  if (openOwed.length > 0) parts.push(`You're owed ${out.owed_to_you_total} USDC (${openOwed.map(who).join(", ")}).`);
  else parts.push("Nobody owes you anything right now.");
  const checking = out.owed_to_you.filter((v) => v.status === "checking").length;
  if (checking > 0) parts.push(`${checking} payment(s) could not be verified on-chain yet; retry shortly.`);
  for (const v of out.owed_to_you.filter((r) => r.status === "paid" || r.status === "paid_late")) {
    parts.push(`${who(v)} paid ${v.amount}${v.paid_at ? ` at ${v.paid_at}` : ""}.`);
  }
  const openOwe = out.you_owe.filter((v) => OPEN.has(v.status));
  if (openOwe.length > 0) parts.push(`You owe ${out.you_owe_total} USDC across ${openOwe.length} request(s).`);
  const activeDeals = out.deals.filter((d) => ["Funded", "Delivered", "Disputed"].includes(d.state));
  const activeBets = out.bets.filter((b) => b.state === "Open" || b.state === "Matched");
  if (activeDeals.length + activeBets.length > 0) {
    parts.push(`${out.locked_in_escrow_total} USDC locked in ${activeDeals.length} deal(s) and ${activeBets.length} bet(s).`);
  }
  for (const b of activeBets.filter((x) => x.state === "Matched")) {
    parts.push(`Bet #${b.id} resolves ${relative(Math.floor(Date.parse(b.resolve_at) / 1000), nowSeconds)}.`);
  }
  if (out.escrow_owed_atomic !== "0") parts.push(`TabEscrow holds ${out.escrow_owed} USDC for you from a payout that could not be sent directly: collect it with deal_action withdraw.`);
  return parts.join(" ");
}

export async function list(input: z.infer<typeof listInput>, ctx: ToolContext): Promise<CallToolResult> {
  const address = checksum(input.address, "address");
  const include = new Set(input.include ?? ["requests", "deals", "bets"]);
  const base = requireApiBase(ctx.config);
  const nowSeconds = Math.floor(ctx.now() / 1000);
  const tabs = await ctx.api().getAddressTabs(address, input.status);

  const dealRefs = include.has("deals") ? tabs.deals.slice(0, LIMITS.listVerify) : [];
  const betRefs = include.has("bets") ? tabs.bets.slice(0, LIMITS.listVerify) : [];
  const owedRecords = include.has("requests") ? tabs.owed_to_you.map((r) => fromRecord(r, r.paid_tx ? { id: r.id, status: r.status, paid_tx: r.paid_tx, paid_at: r.paid_at, payer_address: r.payer_address, checked_at: r.created_at } : null)) : [];
  const oweRecords = include.has("requests") ? tabs.you_owe.map((r) => fromRecord(r, r.paid_tx ? { id: r.id, status: r.status, paid_tx: r.paid_tx, paid_at: r.paid_at, payer_address: r.payer_address, checked_at: r.created_at } : null)) : [];

  const [verified, deals, bets, escrowOwed] = await Promise.all([
    verifyRequests(ctx, [...owedRecords, ...oweRecords]),
    Promise.all(dealRefs.map(async (d) => dealView(base, BigInt(d.id), await loadDeal(ctx, BigInt(d.id)), nowSeconds, address))),
    Promise.all(betRefs.map(async (b) => betView(base, BigInt(b.id), await loadBet(ctx, BigInt(b.id)), nowSeconds))),
    include.has("deals") || include.has("bets") ? readOwed(ctx, address) : Promise.resolve(0n),
  ]);
  const view = (r: (typeof owedRecords)[number]) => requestView(base, r, verified.get(r.id) ?? { status: "checking", finding: { status: "checking", reason: "not scanned" } });
  const owed = owedRecords.map(view);
  const owe = oweRecords.map(view);
  const owedTotal = sum(owed);
  const lockedTotal = locked(deals, bets);
  const partial: Omit<ListOutput, "summary"> = {
    address,
    owed_to_you: owed,
    you_owe: owe,
    deals,
    bets,
    owed_to_you_total: formatUsdc(owedTotal),
    owed_to_you_total_atomic: owedTotal.toString(),
    you_owe_total: formatUsdc(sum(owe)),
    locked_in_escrow_total: formatUsdc(lockedTotal),
    locked_in_escrow_total_atomic: lockedTotal.toString(),
    escrow_owed: formatUsdc(escrowOwed),
    escrow_owed_atomic: escrowOwed.toString(),
    truncated: tabs.deals.length > LIMITS.listVerify || tabs.bets.length > LIMITS.listVerify,
  };
  const output: ListOutput = { ...partial, summary: summarize(partial, nowSeconds) };
  return readResult(output, output.summary);
}
