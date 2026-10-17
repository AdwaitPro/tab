import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  pad,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { createContext, type ToolContext } from "../src/lib/context.js";
import { TRANSFER_TOPIC, USDC } from "../src/lib/constants.js";
import { tabEscrowAbi } from "../src/lib/escrowAbi.js";
import type { FetchFn } from "../src/lib/net.js";

export const API = "https://tab.test";
export const RPC = "https://rpc.primary.test";
export const RPC2 = "https://rpc.fallback.test";
export const ESCROW: Address = getAddress("0x00000000000000000000000000000000000e5c70");
export const ME: Address = "0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E";
export const FRIEND: Address = getAddress("0xb7e0700000000000000000000000000000400a31");
export const OTHER: Address = "0x1111111111111111111111111111111111111111";
export const NOW = Date.parse("2026-10-18T12:00:00Z");
export const NOW_S = Math.floor(NOW / 1000);

const aggregatorAbi = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [
    { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "getRoundData", stateMutability: "view", inputs: [{ name: "roundId", type: "uint80" }], outputs: [
    { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }] },
] as const;

export interface FakeLog {
  from: Address;
  to: Address;
  value: bigint;
  block: bigint;
  logIndex?: number;
  tx: Hex;
}

export interface RouteResponse {
  status: number;
  body: unknown;
}

type ApiHandler = (method: string, path: string, body: unknown) => RouteResponse | undefined;

export interface DealState {
  buyer: Address; seller: Address; arbiter: Address; amount: bigint; deliverBy: bigint; reviewWindow: bigint;
  deliveredAt: bigint; state: number; termsHash: Hex; disputedAt: bigint;
}

export interface BetStateFake {
  creator: Address; opponent: Address; arbiter: Address; stake: bigint; joinBy: bigint; resolveAt: bigint; kind: number;
  state: number; feed: Address; threshold: bigint; creatorAbove: boolean; creatorReport: Address; opponentReport: Address; termsHash: Hex;
}

/** A scriptable Base node + Tab API behind a single fetch function. */
export class FakeWorld {
  block = 53_000_000n;
  usdc = new Map<string, bigint>();
  eth = new Map<string, bigint>();
  allowances = new Map<string, bigint>();
  logs: FakeLog[] = [];
  blockTimes = new Map<bigint, bigint>();
  feeds = new Map<string, { answer: bigint; updatedAt: bigint; roundId?: bigint }>();
  /** Historical rounds per feed (lowercase address → roundId → round). */
  rounds = new Map<string, Map<bigint, { answer: bigint; updatedAt: bigint }>>();
  sequencer = { answer: 0n, startedAt: BigInt(NOW_S - 100 * 86_400) };
  deals = new Map<bigint, DealState>();
  bets = new Map<bigint, BetStateFake>();
  owed = new Map<string, bigint>();
  nextDealId = 1n;
  nextBetId = 1n;
  /** Selector-level revert for write simulations, e.g. { createDeal: "InvalidDeadline" }. */
  reverts = new Map<string, string>();
  rpcDown = new Set<string>();
  rpcMethodErrors = new Map<string, { code: number; message: string }>();
  api: ApiHandler = () => undefined;
  apiDown: "none" | "timeout" | "5xx" | "network" | "html" = "none";
  calls: { url: string; method: string; body: unknown }[] = [];

  fetch: FetchFn = async (input, init) => {
    const url = input;
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
    const method = init?.method ?? "GET";
    this.calls.push({ url, method, body });
    if (init?.headers && Object.keys(init.headers as Record<string, string>).some((h) => h.toLowerCase() === "authorization")) {
      throw new Error("plugin must never send Authorization itself");
    }
    if (url.startsWith(RPC) || url.startsWith(RPC2)) {
      const host = url.startsWith(RPC2) ? RPC2 : RPC;
      if (this.rpcDown.has(host)) return hang(init?.signal);
      const rpc = body as { id: number; method: string; params: unknown[] };
      return json(200, this.rpc(rpc, host));
    }
    if (url.startsWith(API)) {
      if (this.apiDown === "timeout") return hang(init?.signal);
      if (this.apiDown === "network") throw new TypeError("fetch failed");
      if (this.apiDown === "5xx") return json(503, { error: { code: "internal", message: "down" } });
      if (this.apiDown === "html") return new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html" } });
      const path = url.slice(API.length);
      const handled = this.api(method, path, body);
      if (handled) return json(handled.status, handled.body);
      return json(404, { error: { code: "not_found", message: "Not found" } });
    }
    throw new TypeError(`unexpected host ${url}`);
  };

  private rpc(req: { id: number; method: string; params: unknown[] }, host: string): unknown {
    const methodError = this.rpcMethodErrors.get(`${host} ${req.method}`);
    if (methodError) return { jsonrpc: "2.0", id: req.id, error: methodError };
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    switch (req.method) {
      case "eth_blockNumber":
        return ok(toHex(this.block));
      case "eth_gasPrice":
        return ok(toHex(5_000_000n));
      case "eth_chainId":
        return ok("0x2105");
      case "eth_getBalance":
        return ok(toHex(this.eth.get(String(req.params[0]).toLowerCase()) ?? 0n));
      case "eth_getBlockByNumber": {
        const n = BigInt(String(req.params[0]));
        return ok({ number: toHex(n), timestamp: toHex(this.blockTimes.get(n) ?? BigInt(NOW_S - Number(this.block - n) * 2)) });
      }
      case "eth_getLogs": {
        const filter = req.params[0] as { fromBlock: Hex; toBlock: Hex; topics: (Hex | null)[] };
        const from = BigInt(filter.fromBlock);
        const to = BigInt(filter.toBlock);
        if (to - from + 1n > 2000n) return { jsonrpc: "2.0", id: req.id, error: { code: -32005, message: "range too large" } };
        const recipientTopic = filter.topics[2];
        return ok(this.logs.filter((l) => l.block >= from && l.block <= to && pad(l.to.toLowerCase() as Hex, { size: 32 }) === recipientTopic).map((l) => this.rawLog(l)));
      }
      case "eth_getTransactionReceipt": {
        const tx = String(req.params[0]);
        const logs = this.logs.filter((l) => l.tx === tx);
        if (logs.length === 0) return ok(null);
        return ok({ status: "0x1", transactionHash: tx, logs: logs.map((l) => this.rawLog(l)) });
      }
      case "eth_call": {
        const call = req.params[0] as { to: Address; data: Hex; from?: Address };
        return this.ethCall(req.id, call);
      }
      default:
        return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `method ${req.method} not mocked` } };
    }
  }

  private rawLog(l: FakeLog) {
    return {
      address: USDC.toLowerCase(),
      topics: [TRANSFER_TOPIC, pad(l.from.toLowerCase() as Hex, { size: 32 }), pad(l.to.toLowerCase() as Hex, { size: 32 })],
      data: pad(toHex(l.value), { size: 32 }),
      blockNumber: toHex(l.block),
      logIndex: toHex(l.logIndex ?? 0),
      transactionHash: l.tx,
      removed: false,
    };
  }

  private ethCall(id: number, call: { to: Address; data: Hex; from?: Address }): unknown {
    const ok = (result: Hex) => ({ jsonrpc: "2.0", id, result });
    const to = call.to.toLowerCase();
    if (to === USDC.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
      if (functionName === "balanceOf") {
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: this.usdc.get(String(args[0]).toLowerCase()) ?? 0n }));
      }
      if (functionName === "allowance") {
        return ok(encodeFunctionResult({ abi: erc20Abi, functionName, result: this.allowances.get(`${String(args[0]).toLowerCase()}:${String(args[1]).toLowerCase()}`) ?? 0n }));
      }
      return ok("0x");
    }
    const feed = this.feeds.get(to);
    if (feed || to === "0xbcf85224fc0756b9fa45aa7892530b47e10b6433") {
      const { functionName, args } = decodeFunctionData({ abi: aggregatorAbi, data: call.data });
      if (functionName === "decimals") return ok(encodeFunctionResult({ abi: aggregatorAbi, functionName, result: 8 }));
      if (functionName === "getRoundData") {
        const roundId = args[0];
        const r = this.rounds.get(to)?.get(roundId);
        if (!r) return { jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted: No data present", data: "0x" } };
        return ok(encodeFunctionResult({ abi: aggregatorAbi, functionName, result: [roundId, r.answer, r.updatedAt, r.updatedAt, roundId] }));
      }
      const round = feed
        ? [feed.roundId ?? 1n, feed.answer, feed.updatedAt, feed.updatedAt, feed.roundId ?? 1n] as const
        : [1n, this.sequencer.answer, this.sequencer.startedAt, this.sequencer.startedAt, 1n] as const;
      return ok(encodeFunctionResult({ abi: aggregatorAbi, functionName, result: round }));
    }
    if (to === ESCROW.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: tabEscrowAbi, data: call.data });
      if (functionName === "getDeal") {
        const deal = this.deals.get(args[0] as bigint) ?? emptyDeal();
        return ok(encodeFunctionResult({ abi: tabEscrowAbi, functionName, result: deal }));
      }
      if (functionName === "getBet") {
        const bet = this.bets.get(args[0] as bigint) ?? emptyBet();
        return ok(encodeFunctionResult({ abi: tabEscrowAbi, functionName, result: bet }));
      }
      if (functionName === "owed") return ok(encodeFunctionResult({ abi: tabEscrowAbi, functionName, result: this.owed.get(String(args[0]).toLowerCase()) ?? 0n }));
      if (functionName === "nextDealId") return ok(encodeFunctionResult({ abi: tabEscrowAbi, functionName, result: this.nextDealId }));
      if (functionName === "nextBetId") return ok(encodeFunctionResult({ abi: tabEscrowAbi, functionName, result: this.nextBetId }));
      const revert = this.reverts.get(functionName);
      if (revert) {
        const data = encodeErrorResult({ abi: tabEscrowAbi, errorName: revert as "TooEarly" });
        return { jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted", data } };
      }
      return ok("0x");
    }
    return { jsonrpc: "2.0", id, error: { code: -32000, message: `no code at ${to}` } };
  }
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

export function emptyDeal(): DealState {
  return { buyer: ZERO, seller: ZERO, arbiter: ZERO, amount: 0n, deliverBy: 0n, reviewWindow: 0n, deliveredAt: 0n, state: 0, termsHash: ZERO_HASH, disputedAt: 0n };
}

export function emptyBet(): BetStateFake {
  return { creator: ZERO, opponent: ZERO, arbiter: ZERO, stake: 0n, joinBy: 0n, resolveAt: 0n, kind: 0, state: 0, feed: ZERO, threshold: 0n,
    creatorAbove: true, creatorReport: ZERO, opponentReport: ZERO, termsHash: ZERO_HASH };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("timeout", "TimeoutError")));
  });
}

export function makeContext(world: FakeWorld, overrides: { env?: Record<string, string>; budgetMs?: number } = {}): ToolContext {
  let counter = 0;
  return createContext({
    env: { TAB_API_BASE: API, TAB_ESCROW: ESCROW, BASE_RPC_URL: RPC, BASE_RPC_FALLBACK: RPC2, ...overrides.env },
    fetchFn: world.fetch,
    now: () => NOW,
    randomHex: (bytes) => (counter++).toString(16).padStart(bytes * 2, "0"),
    ...(overrides.budgetMs ? { budgetMs: overrides.budgetMs } : {}),
  });
}

export function text(result: CallToolResult, index = 0): string {
  const block = result.content[index];
  return block && block.type === "text" ? block.text : "";
}

export function hints(result: CallToolResult): { summary: string; next_actions: string[]; links: Record<string, string> } {
  return JSON.parse(text(result, 1)) as { summary: string; next_actions: string[]; links: Record<string, string> };
}

export function proposalOf(result: CallToolResult): { to: Address; value: string; data: Hex } {
  const sc = result.structuredContent as Record<string, { transaction: { to: Address; value: string; data: Hex } }> | undefined;
  const proposal = sc?.["io.paybox/transactionProposal"];
  if (!proposal) throw new Error("no proposal");
  return proposal.transaction;
}

export function requestRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "4fGh8Kq2LmN0pQrS7tUvWx",
    split_id: null,
    recipient: ME,
    amount_atomic: "2000000",
    unique_atomic: "2000417",
    memo: "Dinner at Toit",
    payer_label: "Meera",
    requester_label: "Adwait",
    created_at: "2026-10-18T11:00:00Z",
    expires_at: "2026-10-25T11:00:00Z",
    start_block: "52999000",
    signature: null,
    status: "open",
    paid_tx: null,
    paid_at: null,
    payer_address: null,
    ...overrides,
  };
}
