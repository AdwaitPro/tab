import { describe, expect, it } from "vitest";
import type * as z from "zod/v4";

import { betActionInput, betCreateInput } from "../src/tools/bet.js";
import { dealActionInput, dealCreateInput } from "../src/tools/deal.js";
import { listInput } from "../src/tools/list.js";
import { payInput } from "../src/tools/pay.js";
import { quoteInput } from "../src/tools/quote.js";
import { requestInput } from "../src/tools/request.js";
import { splitInput } from "../src/tools/split.js";
import { statusInput } from "../src/tools/status.js";
import { ME } from "./helpers.js";

function rejects(schema: z.ZodType, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}
function accepts(schema: z.ZodType, value: unknown) {
  const r = schema.safeParse(value);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
}

const req = { recipient: ME, amount: "2" };
const deal = { buyer: ME, seller: "0x1111111111111111111111111111111111111111", amount: "3", deliver_by: "2026-10-20T18:00:00Z", terms: "Logo" };
const bet = { creator: ME, stake: "2", kind: "price", join_within_hours: 1, resolve_at: "2026-10-18T21:00:00Z", price: { asset: "ETH", side: "above", threshold: "4000" } };

describe("input schemas", () => {
  it("tab_request", () => {
    accepts(requestInput, req);
    accepts(requestInput, { ...req, memo: "x".repeat(140), payer_label: "x".repeat(40), expires_in_hours: 720 });
    rejects(requestInput, { ...req, extra: 1 });
    rejects(requestInput, { ...req, recipient: "0x123" });
    rejects(requestInput, { ...req, recipient: `${ME}00` });
    rejects(requestInput, { ...req, amount: 2 });
    rejects(requestInput, { ...req, amount: "2.1234567" });
    rejects(requestInput, { ...req, amount: "-1" });
    rejects(requestInput, { ...req, amount: "1e3" });
    rejects(requestInput, { ...req, amount: "1234567890" });
    rejects(requestInput, { ...req, memo: "x".repeat(141) });
    rejects(requestInput, { ...req, payer_label: "x".repeat(41) });
    rejects(requestInput, { ...req, expires_in_hours: 0 });
    rejects(requestInput, { ...req, expires_in_hours: 721 });
    rejects(requestInput, { ...req, expires_in_hours: 1.5 });
    rejects(requestInput, { amount: "2" });
  });

  it("tab_split", () => {
    const base = { recipient: ME, total: "6", participants: [{ label: "Meera" }] };
    accepts(splitInput, base);
    accepts(splitInput, { ...base, participants: Array.from({ length: 20 }, (_, i) => ({ label: `p${i}`, weight: 1 })), tip_percent: 50 });
    rejects(splitInput, { ...base, participants: [] });
    rejects(splitInput, { ...base, participants: Array.from({ length: 21 }, (_, i) => ({ label: `p${i}` })) });
    rejects(splitInput, { ...base, participants: [{ label: "" }] });
    rejects(splitInput, { ...base, participants: [{ label: "A", extra: true }] });
    rejects(splitInput, { ...base, participants: [{ label: "A", weight: 1001 }] });
    rejects(splitInput, { ...base, participants: [{ label: "A", weight: -1 }] });
    rejects(splitInput, { ...base, tip_percent: 51 });
    rejects(splitInput, { ...base, include_self: "yes" });
  });

  it("tab_pay / tab_status / tab_list / tab_quote", () => {
    accepts(payInput, { link_or_id: "x", sender: ME });
    rejects(payInput, { link_or_id: "", sender: ME });
    rejects(payInput, { link_or_id: "x" });
    rejects(payInput, { link_or_id: "x", sender: ME, rail: "x402" });
    accepts(statusInput, { ref: "deal:1" });
    rejects(statusInput, { ref: "" });
    rejects(statusInput, {});
    accepts(listInput, { address: ME, include: ["requests"], status: "all" });
    rejects(listInput, { address: ME, include: [] });
    rejects(listInput, { address: ME, include: ["tabs"] });
    rejects(listInput, { address: ME, status: "closed" });
    accepts(quoteInput, { asset: "BTC" });
    rejects(quoteInput, { asset: "SOL" });
    rejects(quoteInput, {});
  });

  it("deal_create / deal_action", () => {
    accepts(dealCreateInput, deal);
    accepts(dealCreateInput, { ...deal, review_hours: 0.0167, arbiter: ME });
    rejects(dealCreateInput, { ...deal, review_hours: 0.01 });
    rejects(dealCreateInput, { ...deal, review_hours: 721 });
    rejects(dealCreateInput, { ...deal, terms: "" });
    rejects(dealCreateInput, { ...deal, terms: "x".repeat(501) });
    rejects(dealCreateInput, { ...deal, deliver_by: "soon" });
    accepts(dealActionInput, { deal_id: 1, action: "release", caller: ME });
    accepts(dealActionInput, { action: "withdraw", caller: ME });
    accepts(dealActionInput, { deal_id: "12", action: "resolve", caller: ME, seller_bps: 10000 });
    rejects(dealActionInput, { deal_id: 0, action: "release", caller: ME });
    rejects(dealActionInput, { deal_id: 1, action: "steal", caller: ME });
    rejects(dealActionInput, { deal_id: 1, action: "resolve", caller: ME, seller_bps: 10001 });
    rejects(dealActionInput, { deal_id: 1.5, action: "release", caller: ME });
  });

  it("bet_create / bet_action", () => {
    accepts(betCreateInput, bet);
    accepts(betCreateInput, { creator: ME, stake: "1", kind: "event", join_within_hours: 168, resolve_at: "2026-10-25T00:00:00Z", event: { description: "India wins" } });
    rejects(betCreateInput, { ...bet, kind: "sports" });
    rejects(betCreateInput, { ...bet, join_within_hours: 169 });
    rejects(betCreateInput, { ...bet, join_within_hours: 0.01 });
    rejects(betCreateInput, { ...bet, price: { asset: "DOGE", side: "above", threshold: "1" } });
    rejects(betCreateInput, { ...bet, price: { asset: "ETH", side: "sideways", threshold: "1" } });
    rejects(betCreateInput, { ...bet, price: { asset: "ETH", side: "above", threshold: "-5" } });
    rejects(betCreateInput, { ...bet, event: { description: "x".repeat(281) } });
    accepts(betActionInput, { bet_id: 3, action: "report", caller: ME, winner: ME });
    rejects(betActionInput, { bet_id: 3, action: "win", caller: ME });
    rejects(betActionInput, { bet_id: 3, action: "join" });
  });
});
