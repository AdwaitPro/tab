import { decodeFunctionData, erc20Abi, type Hex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";

import { FEEDS, USDC } from "../src/lib/constants.js";
import { tabEscrowAbi } from "../src/lib/escrowAbi.js";
import { decodePayload } from "../src/lib/payload.js";
import { runTool } from "../src/lib/result.js";
import { betAction, betCreate } from "../src/tools/bet.js";
import { dealAction, dealCreate } from "../src/tools/deal.js";
import { list } from "../src/tools/list.js";
import { pay } from "../src/tools/pay.js";
import { quote } from "../src/tools/quote.js";
import { request } from "../src/tools/request.js";
import { split } from "../src/tools/split.js";
import { status } from "../src/tools/status.js";
import {
  API, ESCROW, FakeWorld, FRIEND, hints, makeContext, ME, NOW_S, OTHER, proposalOf, requestRecord, RPC, RPC2, text,
} from "./helpers.js";

const REQ_ID = "4fGh8Kq2LmN0pQrS7tUvWx";
const TX: Hex = `0x${"ab".repeat(32)}`;
const ETH_FEED = FEEDS.ETH.address.toLowerCase();
const key = (owner: string, spender: string) => `${owner.toLowerCase()}:${spender.toLowerCase()}`;

let world: FakeWorld;
beforeEach(() => {
  world = new FakeWorld();
  world.usdc.set(FRIEND.toLowerCase(), 10_000_000n);
  world.eth.set(FRIEND.toLowerCase(), 10n ** 15n);
  world.usdc.set(ME.toLowerCase(), 10_000_000n);
  world.eth.set(ME.toLowerCase(), 10n ** 15n);
  world.feeds.set(ETH_FEED, { answer: 381_244_000_000n, updatedAt: BigInt(NOW_S - 60) });
});

function serveRequest(record = requestRecord(), statusBody?: Record<string, unknown>) {
  world.api = (method, path) => {
    if (method === "GET" && path === `/api/requests/${REQ_ID}`) return { status: 200, body: record };
    if (method === "GET" && path === `/api/requests/${REQ_ID}/status`) {
      return { status: 200, body: statusBody ?? { id: REQ_ID, status: record.status, paid_tx: record.paid_tx, paid_at: record.paid_at, payer_address: record.payer_address, checked_at: "2026-10-18T11:59:00Z" } };
    }
    return undefined;
  };
}

describe("tab_request", () => {
  it("happy path: creates via API, sends start_block, never sends Authorization", async () => {
    world.api = (method, path, body) => {
      if (method === "POST" && path === "/api/requests") {
        const b = body as Record<string, string>;
        expect(b).toMatchObject({ recipient: ME, amount_atomic: "2000000", memo: "Dinner at Toit", payer_label: "Meera", start_block: "53000000", expires_at: "2026-10-25T12:00:00Z" });
        return { status: 201, body: requestRecord({ start_block: b.start_block }) };
      }
      return undefined;
    };
    const result = await request({ recipient: ME.toLowerCase(), amount: "2", memo: "Dinner\u0000 at Toit", payer_label: "Meera", expires_in_hours: 168 }, makeContext(world));
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toMatchObject({ id: REQ_ID, url: `${API}/r/${REQ_ID}`, amount_display: "2.00", unique_amount_display: "2.000417", unique_atomic: "2000417", mode: "api", recipient: ME });
    expect(sc.share_text).toBe(`Hey Meera, please pay 2.00 USDC for Dinner at Toit → ${API}/r/${REQ_ID}`);
    expect(sc.pay_prompt).toBe(`Pay this Tab: ${API}/r/${REQ_ID}`);
  });

  it.each(["5xx", "timeout", "network", "html"] as const)("API %s → self-contained offline link", async (mode) => {
    world.apiDown = mode;
    const result = await request({ recipient: ME, amount: "2", expires_in_hours: 24 }, makeContext(world, { budgetMs: 2_500 }));
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { id: string; mode: string; unique_atomic: string; url: string };
    expect(sc.mode).toBe("offline");
    const payload = decodePayload(sc.id);
    expect(payload.r).toBe(ME);
    expect(payload.u).toBe(sc.unique_atomic);
    expect(payload.b).toBe("53000000");
    expect(sc.url).toBe(`${API}/r/${sc.id}`);
  });

  it("API 401 → isError naming the portal secret (no silent offline fallback)", async () => {
    world.api = () => ({ status: 401, body: { error: { code: "unauthorized", message: "bad key" } } });
    const result = await runTool("tab_request", () => request({ recipient: ME, amount: "2", expires_in_hours: 24 }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Authorization secret/);
  });

  it("rejects an API record that does not match the input", async () => {
    world.api = () => ({ status: 201, body: requestRecord({ recipient: OTHER }) });
    const result = await runTool("tab_request", () => request({ recipient: ME, amount: "2", expires_in_hours: 24 }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/does not match/);
  });

  it("amount above cap → isError with cap", async () => {
    const result = await runTool("tab_request", () => request({ recipient: ME, amount: "5", expires_in_hours: 24 }, makeContext(world, { env: { TAB_MAX_USDC: "3" } })));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/safety cap of 3.00 USDC/);
  });

  it("RPC primary down → uses fallback host", async () => {
    world.rpcDown.add(RPC);
    world.apiDown = "5xx";
    const result = await request({ recipient: ME, amount: "1", expires_in_hours: 1 }, makeContext(world, { budgetMs: 6_000 }));
    expect(result.isError).toBeUndefined();
    expect(world.calls.some((c) => c.url === RPC2)).toBe(true);
  }, 10_000);
});

describe("tab_split", () => {
  it("creates one split + N requests with exact shares", async () => {
    world.api = (method, path, body) => {
      if (method !== "POST" || path !== "/api/splits") return undefined;
      const b = body as { total_atomic: string; requests: { payer_label: string; amount_atomic: string }[] };
      expect(b.total_atomic).toBe("10000000");
      expect(b.requests).toEqual([{ payer_label: "Meera", amount_atomic: "3333333" }, { payer_label: "Aarav", amount_atomic: "3333333" }]);
      return {
        status: 201,
        body: {
          split: { id: "9aBcDeFgHiJkLmNoPqRsTu", recipient: ME, total_atomic: b.total_atomic, memo: null, requester_label: null, created_at: "2026-10-18T12:00:00Z" },
          requests: b.requests.map((r, i) => requestRecord({ id: `${"x".repeat(21)}${i}`, payer_label: r.payer_label, amount_atomic: r.amount_atomic, unique_atomic: (BigInt(r.amount_atomic) + BigInt(100 + i)).toString() })),
        },
      };
    };
    const result = await split({ recipient: ME, total: "10", participants: [{ label: "Meera" }, { label: "Aarav" }], include_self: true }, makeContext(world));
    const sc = result.structuredContent as { per_person: { amount: string; unique_amount: string; url: string }[]; your_share: string; split_url: string };
    expect(sc.per_person.map((p) => p.amount)).toEqual(["3.333333", "3.333333"]);
    expect(sc.per_person[1]?.unique_amount).toBe("3.333434");
    expect(sc.your_share).toBe("3.333334");
    expect(sc.split_url).toBe(`${API}/s/9aBcDeFgHiJkLmNoPqRsTu`);
  });

  it("offline fallback produces one payload link per person", async () => {
    world.apiDown = "5xx";
    const result = await split({ recipient: ME, total: "6", participants: [{ label: "Meera" }, { label: "Aarav" }], include_self: true }, makeContext(world));
    const sc = result.structuredContent as { offline: boolean; split_id: null; per_person: { request_id: string; amount_atomic: string }[] };
    expect(sc.offline).toBe(true);
    expect(sc.split_id).toBeNull();
    for (const p of sc.per_person) expect(decodePayload(p.request_id).a).toBe(p.amount_atomic);
  });

  it("mixed modes → isError", async () => {
    const result = await runTool("tab_split", () => split({ recipient: ME, total: "6", participants: [{ label: "A", amount: "1" }, { label: "B", weight: 1 }], include_self: true }, makeContext(world)));
    expect(result.isError).toBe(true);
  });
});

describe("tab_pay", () => {
  it("happy path: exact USDC transfer proposal, no allowance", async () => {
    serveRequest();
    const result = await pay({ link_or_id: `${API}/r/${REQ_ID}`, sender: FRIEND }, makeContext(world));
    expect(result.isError).toBeUndefined();
    const tx = proposalOf(result);
    expect(tx.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(tx.value).toBe("0");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual([ME, 2_000_417n]);
    expect(text(result)).toMatch(/transfer exactly 2\.000417 USDC/);
    expect(text(result)).toMatch(/no allowance is granted/);
    expect(hints(result).links.request).toBe(`${API}/r/${REQ_ID}`);
    const sc = result.structuredContent as Record<string, { kind: string; chain: string; expiresAt: string }>;
    expect(sc["io.paybox/transactionProposal"]?.chain).toBe("eip155:8453");
  });

  it("already paid on-chain → isError with tx, no proposal", async () => {
    serveRequest();
    world.logs.push({ from: FRIEND, to: ME, value: 2_000_417n, block: 52_999_500n, tx: TX });
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text(result)).toMatch(new RegExp(`already paid in tx ${TX}`));
  });

  it("a transfer of a different amount does not count as payment", async () => {
    serveRequest();
    world.logs.push({ from: FRIEND, to: ME, value: 2_000_000n, block: 52_999_500n, tx: TX });
    const result = await pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world));
    expect(result.isError).toBeUndefined();
  });

  it("expired → isError", async () => {
    serveRequest(requestRecord({ expires_at: "2026-10-18T11:30:00Z" }));
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/expired/);
  });

  it("insufficient USDC → isError with deposit remedy", async () => {
    serveRequest();
    world.usdc.set(FRIEND.toLowerCase(), 1_000_000n);
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Insufficient USDC.*1\.00 USDC/);
    expect(text(result)).toMatch(/app\.paybox\.sh\/deposit/);
  });

  it("no ETH for gas → isError", async () => {
    serveRequest();
    world.eth.set(FRIEND.toLowerCase(), 0n);
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Not enough ETH/);
  });

  it("sender == recipient → isError", async () => {
    serveRequest();
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/own address/);
  });

  it("API down → network isError (nothing proposed)", async () => {
    world.apiDown = "timeout";
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world, { budgetMs: 1_000 })));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Network problem/);
  });

  it("malformed API JSON → isError", async () => {
    world.api = () => ({ status: 200, body: { nope: true } });
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
  });

  it("invalid creator signature → refuses (spoof protection)", async () => {
    serveRequest(requestRecord({ signature: `0x${"11".repeat(65)}` }));
    const result = await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/spoofed/);
  });
});

describe("tab_status", () => {
  it("open request", async () => {
    serveRequest();
    const result = await status({ ref: `${API}/r/${REQ_ID}` }, makeContext(world));
    const sc = result.structuredContent as { type: string; request: { status: string; verified_on_chain: boolean } };
    expect(sc.type).toBe("request");
    expect(sc.request).toMatchObject({ status: "open", verified_on_chain: true });
  });

  it("paid via API-reported tx verified on-chain", async () => {
    serveRequest(requestRecord({ status: "paid", paid_tx: TX, paid_at: "2026-10-18T11:59:00Z", payer_address: FRIEND }));
    world.logs.push({ from: FRIEND, to: ME, value: 2_000_417n, block: 52_999_990n, tx: TX });
    const result = await status({ ref: REQ_ID }, makeContext(world));
    const sc = result.structuredContent as { request: { status: string; paid_tx: string; payer: string } };
    expect(sc.request).toMatchObject({ status: "paid", paid_tx: TX, payer: FRIEND });
  });

  it("API claims paid but chain disagrees → not paid", async () => {
    serveRequest(requestRecord({ status: "paid", paid_tx: TX }));
    const result = await status({ ref: REQ_ID }, makeContext(world));
    expect((result.structuredContent as { request: { status: string } }).request.status).toBe("open");
  });

  it("RPC fully down → checking, never unpaid", async () => {
    serveRequest();
    world.rpcDown.add(RPC);
    world.rpcDown.add(RPC2);
    const result = await status({ ref: REQ_ID }, makeContext(world, { budgetMs: 2_000 }));
    expect((result.structuredContent as { request: { status: string } }).request.status).toBe("checking");
  });

  it("long range with tight budget → checking", async () => {
    serveRequest(requestRecord({ start_block: "52737895" }));
    const result = await status({ ref: REQ_ID }, makeContext(world, { budgetMs: 1_800 }));
    const s = (result.structuredContent as { request: { status: string } }).request.status;
    expect(["checking", "open"]).toContain(s);
  });

  it("paid after expiry → paid_late", async () => {
    serveRequest(requestRecord({ expires_at: "2026-10-18T11:30:00Z" }));
    world.logs.push({ from: FRIEND, to: ME, value: 2_000_417n, block: 52_999_990n, tx: TX });
    world.blockTimes.set(52_999_990n, BigInt(NOW_S - 60));
    const result = await status({ ref: REQ_ID }, makeContext(world));
    expect((result.structuredContent as { request: { status: string } }).request.status).toBe("paid_late");
  });

  it("offline payload link is verified from chain only", async () => {
    world.apiDown = "5xx";
    const made = await request({ recipient: ME, amount: "2", expires_in_hours: 24 }, makeContext(world));
    const url = (made.structuredContent as { url: string }).url;
    const result = await status({ ref: url }, makeContext(world));
    expect((result.structuredContent as { request: { status: string; source: string } }).request).toMatchObject({ status: "open", source: "payload" });
  });

  it("deal with available actions", async () => {
    world.deals.set(1n, { buyer: ME, seller: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", amount: 3_000_000n,
      deliverBy: BigInt(NOW_S + 3600), reviewWindow: 172_800n, deliveredAt: 0n, state: 1, termsHash: `0x${"00".repeat(32)}`, disputedAt: 0n });
    const result = await status({ ref: "deal:1" }, makeContext(world));
    const deal = (result.structuredContent as { deal: { state: string; available_actions: { action: string; available_now: boolean; available_at: string | null }[] } }).deal;
    expect(deal.state).toBe("Funded");
    expect(deal.available_actions.find((a) => a.action === "deliver")?.available_now).toBe(true);
    expect(deal.available_actions.find((a) => a.action === "refund")).toMatchObject({ available_now: false, available_at: "2026-10-18T13:00:00Z" });
  });

  it("unknown deal → isError", async () => {
    const result = await runTool("tab_status", () => status({ ref: "deal:99" }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/does not exist/);
  });
});

describe("tab_list", () => {
  it("verifies owed requests on-chain and totals them", async () => {
    world.api = (method, path) => {
      if (!path.startsWith(`/api/addresses/${ME}/tabs`)) return undefined;
      return { status: 200, body: {
        address: ME,
        owed_to_you: [requestRecord({ id: "a".repeat(22), payer_label: "Meera" }), requestRecord({ id: "b".repeat(22), payer_label: "Aarav", unique_atomic: "2001288" })],
        you_owe: [],
        deals: [{ id: "1", role: "buyer", state: "Funded" }],
        bets: [],
      } };
    };
    world.logs.push({ from: FRIEND, to: ME, value: 2_000_417n, block: 52_999_990n, tx: TX });
    world.deals.set(1n, { buyer: ME, seller: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", amount: 3_000_000n,
      deliverBy: BigInt(NOW_S + 3600), reviewWindow: 3600n, deliveredAt: 0n, state: 1, termsHash: `0x${"00".repeat(32)}`, disputedAt: 0n });
    const result = await list({ address: ME, status: "open" }, makeContext(world));
    const sc = result.structuredContent as { owed_to_you: { status: string }[]; owed_to_you_total: string; locked_in_escrow_total: string; summary: string };
    expect(sc.owed_to_you.map((r) => r.status)).toEqual(["paid", "open"]);
    expect(sc.owed_to_you_total).toBe("2.00");
    expect(sc.locked_in_escrow_total).toBe("3.00");
    expect(sc.summary).toMatch(/You're owed 2\.00 USDC \("Aarav"\)/);
    expect(sc.summary).toMatch(/"Meera" paid 2\.00/);
  });
});

describe("deal_create (approve → create)", () => {
  const args = { buyer: ME, seller: FRIEND, amount: "3", deliver_by: "2026-10-20T18:00:00Z", review_hours: 48, terms: "Logo, 3 concepts" };

  it("step 1: approve exactly amount when allowance is short", async () => {
    const result = await dealCreate(args, makeContext(world));
    const tx = proposalOf(result);
    expect(tx.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data }).args).toEqual([ESCROW, 3_000_000n]);
    expect(text(result)).toMatch(/Step 1 of 2: allow TabEscrow .* exactly 3\.00 USDC/);
    expect(hints(result).next_actions.join(" ")).toMatch(/identical arguments/);
  });

  it("step 2: createDeal once allowance is in place; stores terms", async () => {
    world.allowances.set(key(ME, ESCROW), 3_000_000n);
    world.nextDealId = 7n;
    let stored = false;
    world.api = (method, path) => (method === "POST" && path === "/api/terms" ? ((stored = true), { status: 201, body: { hash: "0x", created_at: "2026-10-18T12:00:00Z" } }) : undefined);
    const result = await dealCreate(args, makeContext(world));
    const tx = proposalOf(result);
    expect(tx.to).toBe(ESCROW);
    const decoded = decodeFunctionData({ abi: tabEscrowAbi, data: tx.data });
    expect(decoded.functionName).toBe("createDeal");
    expect(decoded.args?.[1]).toBe(3_000_000n);
    expect(decoded.args?.[3]).toBe(172_800n);
    expect(stored).toBe(true);
    expect(hints(result).links.deal).toBe(`${API}/d/7`);
  });

  it("simulation revert → isError with decoded custom error, no proposal", async () => {
    world.allowances.set(key(ME, ESCROW), 3_000_000n);
    world.reverts.set("createDeal", "InvalidDeadline");
    const result = await runTool("deal_create", () => dealCreate(args, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text(result)).toMatch(/InvalidDeadline/);
  });

  it("insufficient USDC → isError before any approve", async () => {
    world.usdc.set(ME.toLowerCase(), 1n);
    const result = await runTool("deal_create", () => dealCreate(args, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Insufficient USDC/);
  });

  it("buyer == seller → isError", async () => {
    const result = await runTool("deal_create", () => dealCreate({ ...args, seller: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
  });
});

describe("deal_action", () => {
  beforeEach(() => {
    world.deals.set(1n, { buyer: ME, seller: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", amount: 3_000_000n,
      deliverBy: BigInt(NOW_S + 3600), reviewWindow: 3600n, deliveredAt: 0n, state: 1, termsHash: `0x${"00".repeat(32)}`, disputedAt: 0n });
  });

  it("release by buyer → proposal", async () => {
    const result = await dealAction({ deal_id: 1, action: "release", caller: ME }, makeContext(world));
    expect(decodeFunctionData({ abi: tabEscrowAbi, data: proposalOf(result).data }).functionName).toBe("release");
  });

  it("refund too early → isError with when", async () => {
    const result = await runTool("deal_action", () => dealAction({ deal_id: 1, action: "refund", caller: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Available after 2026-10-18 13:00:00 UTC/);
  });

  it("wrong role → isError", async () => {
    const result = await runTool("deal_action", () => dealAction({ deal_id: 1, action: "deliver", caller: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/only the seller/);
  });

  it("dispute without arbiter → isError", async () => {
    const result = await runTool("deal_action", () => dealAction({ deal_id: 1, action: "dispute", caller: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
  });
});

describe("bets", () => {
  const create = { creator: ME, stake: "2", kind: "price" as const, join_within_hours: 1, resolve_at: "2026-10-18T15:30:00Z", price: { asset: "ETH" as const, side: "above" as const, threshold: "4000" } };

  it("bet_create step 1 approve includes the preview", async () => {
    const result = await betCreate(create, makeContext(world));
    expect(text(result)).toMatch(/Step 1 of 2/);
    expect(text(result)).toMatch(/ETH\/USD now 3812\.44/);
    expect(text(result)).toMatch(/≥ 4000\.00/);
    expect(text(result)).toMatch(/IST/);
  });

  it("bet_create step 2 createPriceBet with 8-decimal threshold", async () => {
    world.allowances.set(key(ME, ESCROW), 2_000_000n);
    const result = await betCreate(create, makeContext(world));
    const decoded = decodeFunctionData({ abi: tabEscrowAbi, data: proposalOf(result).data });
    expect(decoded.functionName).toBe("createPriceBet");
    expect(decoded.args?.[5]).toBe(400_000_000_000n);
    expect(decoded.args?.[6]).toBe(true);
  });

  it("rejects resolve_at too soon and join window past resolve", async () => {
    let result = await runTool("bet_create", () => betCreate({ ...create, resolve_at: "2026-10-18T12:02:00Z" }, makeContext(world)));
    expect(result.isError).toBe(true);
    result = await runTool("bet_create", () => betCreate({ ...create, join_within_hours: 5 }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/join window/);
  });

  it("join → approve first, then joinBet", async () => {
    world.bets.set(3n, { creator: ME, opponent: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", stake: 2_000_000n,
      joinBy: BigInt(NOW_S + 3600), resolveAt: BigInt(NOW_S + 7200), kind: 0, state: 1, feed: FEEDS.ETH.address, threshold: 400_000_000_000n,
      creatorAbove: true, creatorReport: "0x0000000000000000000000000000000000000000", opponentReport: "0x0000000000000000000000000000000000000000", termsHash: `0x${"00".repeat(32)}` });
    let result = await betAction({ bet_id: 3, action: "join", caller: FRIEND }, makeContext(world));
    expect(decodeFunctionData({ abi: erc20Abi, data: proposalOf(result).data }).functionName).toBe("approve");
    world.allowances.set(key(FRIEND, ESCROW), 2_000_000n);
    result = await betAction({ bet_id: 3, action: "join", caller: FRIEND }, makeContext(world));
    expect(decodeFunctionData({ abi: tabEscrowAbi, data: proposalOf(result).data }).functionName).toBe("joinBet");
    result = await runTool("bet_action", () => betAction({ bet_id: 3, action: "join", caller: OTHER }, makeContext(world)));
    expect(result.isError).toBe(true);
  });

  it("settle before oracle update → not final, retry hint", async () => {
    world.bets.set(4n, { creator: ME, opponent: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", stake: 2_000_000n,
      joinBy: BigInt(NOW_S - 7200), resolveAt: BigInt(NOW_S - 30), kind: 0, state: 2, feed: FEEDS.ETH.address, threshold: 400_000_000_000n,
      creatorAbove: true, creatorReport: "0x0000000000000000000000000000000000000000", opponentReport: "0x0000000000000000000000000000000000000000", termsHash: `0x${"00".repeat(32)}` });
    const result = await runTool("bet_action", () => betAction({ bet_id: 4, action: "settle", caller: OTHER }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Not final yet/);
    expect(text(result)).toMatch(/Retry in/);
  });

  it("settle finds the first round at/after resolve time and encodes settlePrice(id, roundId)", async () => {
    const phase = 2n << 64n;
    const resolveAt = BigInt(NOW_S - 3000);
    world.feeds.set(ETH_FEED, { answer: 410_000_000_000n, updatedAt: BigInt(NOW_S - 60), roundId: phase + 103n });
    world.rounds.set(ETH_FEED, new Map([
      [phase + 102n, { answer: 405_000_000_000n, updatedAt: BigInt(NOW_S - 1200) }],
      [phase + 101n, { answer: 401_000_000_000n, updatedAt: BigInt(NOW_S - 2400) }],
      [phase + 100n, { answer: 399_000_000_000n, updatedAt: BigInt(NOW_S - 3600) }],
    ]));
    world.bets.set(6n, { creator: ME, opponent: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", stake: 2_000_000n,
      joinBy: BigInt(NOW_S - 7200), resolveAt, kind: 0, state: 2, feed: FEEDS.ETH.address, threshold: 400_000_000_000n,
      creatorAbove: true, creatorReport: "0x0000000000000000000000000000000000000000", opponentReport: "0x0000000000000000000000000000000000000000", termsHash: `0x${"00".repeat(32)}` });
    const result = await betAction({ bet_id: 6, action: "settle", caller: OTHER }, makeContext(world));
    const decoded = decodeFunctionData({ abi: tabEscrowAbi, data: proposalOf(result).data });
    expect(decoded.functionName).toBe("settlePrice");
    expect(decoded.args).toEqual([6n, phase + 101n]);
  });

  it("settle when the first round is unprovable (phase boundary) → refund guidance", async () => {
    const phase = 3n << 64n;
    world.feeds.set(ETH_FEED, { answer: 410_000_000_000n, updatedAt: BigInt(NOW_S - 60), roundId: phase + 1n });
    world.bets.set(7n, { creator: ME, opponent: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", stake: 2_000_000n,
      joinBy: BigInt(NOW_S - 7200), resolveAt: BigInt(NOW_S - 600), kind: 0, state: 2, feed: FEEDS.ETH.address, threshold: 1n,
      creatorAbove: true, creatorReport: "0x0000000000000000000000000000000000000000", opponentReport: "0x0000000000000000000000000000000000000000", termsHash: `0x${"00".repeat(32)}` });
    const result = await runTool("bet_action", () => betAction({ bet_id: 7, action: "settle", caller: OTHER }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/bet_action refund/);
  });

  it("settle before resolve time → too early", async () => {
    world.bets.set(5n, { creator: ME, opponent: FRIEND, arbiter: "0x0000000000000000000000000000000000000000", stake: 2_000_000n,
      joinBy: BigInt(NOW_S - 7200), resolveAt: BigInt(NOW_S + 600), kind: 0, state: 2, feed: FEEDS.ETH.address, threshold: 1n,
      creatorAbove: true, creatorReport: "0x0000000000000000000000000000000000000000", opponentReport: "0x0000000000000000000000000000000000000000", termsHash: `0x${"00".repeat(32)}` });
    const result = await runTool("bet_action", () => betAction({ bet_id: 5, action: "settle", caller: OTHER }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Available after/);
  });
});

describe("tab_quote", () => {
  it("returns the exact decimal price", async () => {
    const result = await quote({ asset: "ETH" }, makeContext(world));
    expect(result.structuredContent).toMatchObject({ asset: "ETH", price: "3812.44", price_raw: "381244000000", decimals: 8, age_seconds: 60 });
  });
  it("RPC down → network isError", async () => {
    world.rpcDown.add(RPC);
    world.rpcDown.add(RPC2);
    const result = await runTool("tab_quote", () => quote({ asset: "ETH" }, makeContext(world, { budgetMs: 1_200 })));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Network problem/);
  });
});

const Z = "0x0000000000000000000000000000000000000000" as const;
const H = `0x${"00".repeat(32)}` as const;

describe("security audit fixes", () => {
  it("join briefing: opponent role, winning condition, stake, deadlines (price, no arbiter)", async () => {
    world.bets.set(10n, { creator: ME, opponent: Z, arbiter: Z, stake: 2_000_000n, joinBy: BigInt(NOW_S + 3600), resolveAt: BigInt(NOW_S + 7200),
      kind: 0, state: 1, feed: FEEDS.ETH.address, threshold: 400_000_000_000n, creatorAbove: true, creatorReport: Z, opponentReport: Z, termsHash: H });
    const result = await betAction({ bet_id: 10, action: "join", caller: FRIEND }, makeContext(world));
    const t = text(result);
    expect(t).toMatch(/You are the OPPONENT: you win if ETH\/USD < 4000\.00 at 2026-10-18 14:00:00 UTC \(.*IST\)/);
    expect(t).toMatch(/You lock 2\.00 USDC; the winner receives 4\.00 USDC/);
    expect(t).not.toMatch(/WARNING: arbiter/);
    expect(t).not.toMatch(/CAUTION/);
  });

  it("join briefing: event bet with arbiter warns and never claims 'worst case is a refund'", async () => {
    world.bets.set(11n, { creator: ME, opponent: FRIEND, arbiter: OTHER, stake: 1_000_000n, joinBy: BigInt(NOW_S + 600), resolveAt: BigInt(NOW_S + 1800),
      kind: 1, state: 1, feed: Z, threshold: 0n, creatorAbove: false, creatorReport: Z, opponentReport: Z, termsHash: H });
    world.api = (method, path) => (path === "/api/escrow/bets/11" ? { status: 200, body: { id: "11", terms: "India wins" } } : undefined);
    world.allowances.set(key(FRIEND, ESCROW), 1_000_000n);
    const result = await betAction({ bet_id: 11, action: "join", caller: FRIEND }, makeContext(world));
    const t = text(result);
    expect(t).toMatch(new RegExp(`WARNING: arbiter ${OTHER} was chosen by the creator and can award the whole 2\\.00 USDC to either side`));
    expect(t).toMatch(/"India wins"/);
    expect(t).toMatch(/CAUTION: the bet resolves in under 1 hour/);
    expect(t).not.toMatch(/worst case is a refund/);
  });

  it("join briefing also appears on the step-1 approve", async () => {
    world.bets.set(12n, { creator: ME, opponent: FRIEND, arbiter: OTHER, stake: 1_000_000n, joinBy: BigInt(NOW_S + 3600), resolveAt: BigInt(NOW_S + 86_400),
      kind: 1, state: 1, feed: Z, threshold: 0n, creatorAbove: false, creatorReport: Z, opponentReport: Z, termsHash: H });
    const result = await betAction({ bet_id: 12, action: "join", caller: FRIEND }, makeContext(world));
    expect(text(result)).toMatch(/Step 1 of 2/);
    expect(text(result)).toMatch(/WARNING: arbiter/);
  });

  it("bet_create event with arbiter drops the refund claim and warns", async () => {
    const result = await betCreate({ creator: ME, stake: "1", kind: "event", join_within_hours: 1, resolve_at: "2026-10-19T12:00:00Z",
      event: { description: "India wins", arbiter: OTHER } }, makeContext(world));
    expect(text(result)).toMatch(/WARNING: the arbiter can award the whole 2\.00 USDC pot/);
    expect(text(result)).not.toMatch(/worst case is a refund/);
    const noArb = await betCreate({ creator: ME, stake: "1", kind: "event", join_within_hours: 1, resolve_at: "2026-10-19T12:00:00Z",
      event: { description: "India wins" } }, makeContext(world));
    expect(text(noArb)).toMatch(/worst case is a refund/);
  });

  it("bet_create enforces the free-option join gap", async () => {
    const base = { creator: ME, stake: "1", kind: "price" as const, price: { asset: "ETH" as const, side: "above" as const, threshold: "4000" } };
    // resolve in 4 h → gap must be ≥ 1 h; joining for 3.5 h leaves 30 min.
    let result = await runTool("bet_create", () => betCreate({ ...base, join_within_hours: 3.5, resolve_at: "2026-10-18T16:00:00Z" }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/at least 60 min before resolve_at/);
    expect(text(result)).toMatch(/join_within_hours ≤ 3/);
    // resolve in 20 min → gap must be ≥ 10 min.
    result = await runTool("bet_create", () => betCreate({ ...base, join_within_hours: 0.2, resolve_at: "2026-10-18T12:20:00Z" }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/at least 10 min/);
    result = await betCreate({ ...base, join_within_hours: 3, resolve_at: "2026-10-18T16:00:00Z" }, makeContext(world));
    expect(result.isError).toBeUndefined();
  });

  it("deal_action deliver states the seller role, review window and arbiter power", async () => {
    world.deals.set(2n, { buyer: ME, seller: FRIEND, arbiter: OTHER, amount: 3_000_000n, deliverBy: BigInt(NOW_S + 3600), reviewWindow: 172_800n,
      deliveredAt: 0n, state: 1, termsHash: H, disputedAt: 0n });
    const result = await dealAction({ deal_id: 2, action: "deliver", caller: FRIEND }, makeContext(world));
    const t = text(result);
    expect(t).toMatch(/You are the SELLER of 3\.00 USDC locked by buyer/);
    expect(t).toMatch(/48 h review window/);
    expect(t).toMatch(new RegExp(`WARNING: arbiter ${OTHER} was chosen by the buyer and can award the whole 3\\.00 USDC to either side`));
  });

  it("offline payload: API record mismatch → refuses; matching or unknown → proceeds", async () => {
    world.apiDown = "5xx";
    const made = await request({ recipient: ME, amount: "2", expires_in_hours: 24 }, makeContext(world));
    const id = (made.structuredContent as { id: string }).id;
    world.apiDown = "none";
    world.api = (method, path) => (path === `/api/requests/${id}` ? { status: 200, body: requestRecord({ id, recipient: OTHER }) } : undefined);
    let result = await runTool("tab_pay", () => pay({ link_or_id: id, sender: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/does not match the Tab server's record/);
    world.api = () => undefined;
    result = await pay({ link_or_id: id, sender: FRIEND }, makeContext(world));
    expect(result.isError).toBeUndefined();
    expect(text(result)).toMatch(/Unverified offline link/);
  });

  it("signed request text names the signer and flags labels as unverified", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(`0x${"42".repeat(32)}`);
    const { signatureMessage, fromRecord } = await import("../src/lib/requests.js");
    const record = requestRecord({ recipient: account.address });
    const signature = await account.signMessage({ message: signatureMessage(fromRecord(record as never, null)) });
    serveRequest(requestRecord({ recipient: account.address, signature }));
    const result = await pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world));
    expect(text(result)).toMatch(new RegExp(`Signed by ${account.address} \\(the recipient\\)\\. Names/labels are unverified\\.`));
  });

  it("seller claim alert in tab_status and tab_list", async () => {
    world.deals.set(3n, { buyer: ME, seller: FRIEND, arbiter: OTHER, amount: 3_000_000n, deliverBy: BigInt(NOW_S + 3600), reviewWindow: 3600n,
      deliveredAt: BigInt(NOW_S - 7200), state: 2, termsHash: H, disputedAt: 0n });
    const st = await status({ ref: "deal:3" }, makeContext(world));
    expect(text(st)).toMatch(/^CLAIM NOW: Seller .* can claim 3\.00 USDC/);
    expect(text(st)).toMatch(/the buyer can no longer dispute/);
    world.api = (method, path) => (path.startsWith(`/api/addresses/${FRIEND}/tabs`)
      ? { status: 200, body: { address: FRIEND, owed_to_you: [], you_owe: [], deals: [{ id: "3", role: "seller", state: "Delivered" }], bets: [] } } : undefined);
    const ls = await list({ address: FRIEND, status: "open" }, makeContext(world));
    const sc = ls.structuredContent as { summary: string; deals: { alerts: string[] }[] };
    expect(sc.summary.startsWith("CLAIM NOW: You (seller) can claim 3.00 USDC")).toBe(true);
    expect(sc.deals[0]?.alerts).toHaveLength(1);
  });
});

describe("TabEscrow v2", () => {
  it("withdraw: proposes withdraw() when owed > 0, refuses when nothing is owed", async () => {
    let result = await runTool("deal_action", () => dealAction({ action: "withdraw", caller: FRIEND }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/nothing to withdraw/);
    world.owed.set(FRIEND.toLowerCase(), 4_000_000n);
    result = await betAction({ action: "withdraw", caller: FRIEND }, makeContext(world));
    expect(decodeFunctionData({ abi: tabEscrowAbi, data: proposalOf(result).data }).functionName).toBe("withdraw");
    expect(text(result)).toMatch(/4\.00 USDC/);
  });

  it("non-withdraw actions still need an id", async () => {
    const result = await runTool("deal_action", () => dealAction({ action: "release", caller: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/needs deal_id/);
  });

  it("dispute closes after the review window; simulated TooLate explains the closed window", async () => {
    world.deals.set(20n, { buyer: ME, seller: FRIEND, arbiter: OTHER, amount: 1_000_000n, deliverBy: BigInt(NOW_S + 3600), reviewWindow: 3600n,
      deliveredAt: BigInt(NOW_S - 7200), state: 2, termsHash: H, disputedAt: 0n });
    let result = await runTool("deal_action", () => dealAction({ deal_id: 20, action: "dispute", caller: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
    world.deals.set(21n, { buyer: ME, seller: FRIEND, arbiter: OTHER, amount: 1_000_000n, deliverBy: BigInt(NOW_S + 3600), reviewWindow: 3600n,
      deliveredAt: BigInt(NOW_S - 600), state: 2, termsHash: H, disputedAt: 0n });
    world.reverts.set("dispute", "TooLate");
    result = await runTool("deal_action", () => dealAction({ deal_id: 21, action: "dispute", caller: ME }, makeContext(world)));
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/dispute window has closed/);
  });

  it("disputed refund opens 30 days after disputedAt", async () => {
    world.deals.set(22n, { buyer: ME, seller: FRIEND, arbiter: OTHER, amount: 1_000_000n, deliverBy: BigInt(NOW_S - 3600), reviewWindow: 3600n,
      deliveredAt: 0n, state: 5, termsHash: H, disputedAt: BigInt(NOW_S - 86_400) });
    const st = await status({ ref: "deal:22" }, makeContext(world));
    const refund = (st.structuredContent as { deal: { available_actions: { action: string; available_at: string | null }[] } }).deal.available_actions.find((a) => a.action === "refund");
    expect(refund?.available_at).toBe(new Date((NOW_S - 86_400 + 30 * 86_400) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"));
  });

  it("tab_list surfaces escrow-owed funds", async () => {
    world.owed.set(ME.toLowerCase(), 2_500_000n);
    world.api = (method, path) => (path.startsWith(`/api/addresses/${ME}/tabs`)
      ? { status: 200, body: { address: ME, owed_to_you: [], you_owe: [], deals: [], bets: [] } } : undefined);
    const ls = await list({ address: ME, status: "open" }, makeContext(world));
    const sc = ls.structuredContent as { escrow_owed: string; summary: string };
    expect(sc.escrow_owed).toBe("2.50");
    expect(sc.summary).toMatch(/TabEscrow holds 2\.50 USDC for you.*withdraw/);
  });
});

describe("payer addresses and plain-transfer interop", () => {
  it("tab_request records payer_address and returns pay_any_agent", async () => {
    let payerBody: unknown;
    world.api = (method, path, body) => {
      if (method === "POST" && path === "/api/requests") return { status: 201, body: requestRecord() };
      if (method === "POST" && path === `/api/requests/${REQ_ID}/payer`) { payerBody = body; return { status: 200, body: requestRecord({ payer_address: FRIEND }) }; }
      return undefined;
    };
    const result = await request({ recipient: ME, amount: "2", payer_address: FRIEND.toLowerCase(), expires_in_hours: 24 }, makeContext(world));
    expect(payerBody).toEqual({ payer_address: FRIEND });
    const line = `Any agent can pay this without Tab: send exactly 2.000417 USDC on Base to ${ME}. In PayBox that's request_transfer.`;
    expect((result.structuredContent as { pay_any_agent: string }).pay_any_agent).toBe(line);
    expect(text(result)).toContain(line);
  });

  it("payer endpoint failure does not fail tab_request", async () => {
    world.api = (method, path) => (method === "POST" && path === "/api/requests" ? { status: 201, body: requestRecord() } : { status: 503, body: { error: { code: "internal", message: "x" } } });
    const result = await request({ recipient: ME, amount: "2", payer_address: FRIEND, expires_in_hours: 24 }, makeContext(world));
    expect(result.isError).toBeUndefined();
  });

  it("payer_address equal to recipient is rejected", async () => {
    const result = await runTool("tab_request", () => request({ recipient: ME, amount: "2", payer_address: ME, expires_in_hours: 24 }, makeContext(world)));
    expect(result.isError).toBe(true);
  });

  it("tab_split records each participant's payer_address and adds pay_any_agent per person", async () => {
    const recorded: string[] = [];
    world.api = (method, path, body) => {
      if (method === "POST" && path === "/api/splits") {
        const b = body as { requests: { payer_label: string; amount_atomic: string }[] };
        return { status: 201, body: {
          split: { id: "9aBcDeFgHiJkLmNoPqRsTu", recipient: ME, total_atomic: "6000000", memo: null, requester_label: null, created_at: "2026-10-18T12:00:00Z" },
          requests: b.requests.map((r, i) => requestRecord({ id: `${"y".repeat(21)}${i}`, payer_label: r.payer_label, amount_atomic: r.amount_atomic, unique_atomic: (BigInt(r.amount_atomic) + 7n).toString() })),
        } };
      }
      const m = /^\/api\/requests\/(\w+)\/payer$/.exec(path);
      if (method === "POST" && m) { recorded.push(`${m[1]}=${(body as { payer_address: string }).payer_address}`); return { status: 200, body: requestRecord() }; }
      return undefined;
    };
    const result = await split({ recipient: ME, total: "6", participants: [{ label: "Meera", payer_address: FRIEND }, { label: "Aarav" }], include_self: true }, makeContext(world));
    expect(recorded).toEqual([`${"y".repeat(21)}0=${FRIEND}`]);
    const pp = (result.structuredContent as { per_person: { pay_any_agent: string }[] }).per_person;
    expect(pp[0]?.pay_any_agent).toBe(`Any agent can pay this without Tab: send exactly 2.000007 USDC on Base to ${ME}. In PayBox that's request_transfer.`);
    expect(text(result)).toMatch(/request_transfer/);
  });

  it("tab_pay records the sender as payer only after checks pass", async () => {
    const payers: unknown[] = [];
    const record = requestRecord();
    world.api = (method, path, body) => {
      if (method === "GET" && path === `/api/requests/${REQ_ID}`) return { status: 200, body: record };
      if (method === "POST" && path === `/api/requests/${REQ_ID}/payer`) { payers.push(body); return { status: 200, body: record }; }
      return undefined;
    };
    world.usdc.set(FRIEND.toLowerCase(), 1n);
    await runTool("tab_pay", () => pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world)));
    expect(payers).toEqual([]);
    world.usdc.set(FRIEND.toLowerCase(), 10_000_000n);
    await pay({ link_or_id: REQ_ID, sender: FRIEND }, makeContext(world));
    expect(payers).toEqual([{ payer_address: FRIEND }]);
  });

  it("tab_status recognises a plain transfer of the exact amount (no Tab involved)", async () => {
    serveRequest();
    world.logs.push({ from: OTHER, to: ME, value: 2_000_417n, block: 52_999_999n, tx: TX });
    const result = await status({ ref: REQ_ID }, makeContext(world));
    expect((result.structuredContent as { request: { status: string; payer: string } }).request).toMatchObject({ status: "paid", payer: OTHER });
  });

  it("tool descriptions point agents at resolve_username", async () => {
    const { requestTool } = await import("../src/tools/request.js");
    const { splitTool } = await import("../src/tools/split.js");
    const { dealCreateTool } = await import("../src/tools/deal.js");
    const { betCreateTool } = await import("../src/tools/bet.js");
    const { payTool } = await import("../src/tools/pay.js");
    for (const t of [requestTool, splitTool, dealCreateTool, betCreateTool, payTool]) {
      expect(t.description).toMatch(/resolve_username/);
      expect(t.description).not.toMatch(/—/);
    }
  });
});
