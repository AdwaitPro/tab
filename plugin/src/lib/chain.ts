import {
  BaseError,
  createPublicClient,
  decodeErrorResult,
  custom,
  erc20Abi,
  pad,
  RpcRequestError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { tabEscrowAbi as escrowAbi } from "./escrowAbi.js";
import { NetError } from "./errors.js";
import { fetchJson, type Budget, type FetchFn } from "./net.js";
import { SEQUENCER_UPTIME_FEED, TRANSFER_TOPIC, USDC } from "./constants.js";

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "number" &&
    typeof (value as { message?: unknown }).message === "string";
}

/** Execution reverts are answers, not outages: retrying them on another host only wastes budget. */
function isExecutionError(error: JsonRpcError): boolean {
  return error.code === 3 || /revert/i.test(error.message);
}

/**
 * JSON-RPC over HTTPS with one fallback host. The switch is sticky for the rest of the call, so a dead primary
 * costs one timeout per tool call rather than one per request.
 */
export class Rpc {
  private preferred = 0;
  private nextId = 1;

  constructor(
    private readonly urls: readonly [string, string],
    private readonly fetchFn: FetchFn,
    private readonly budget: Budget,
  ) {}

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    const order = this.preferred === 0 ? [0, 1] : [1];
    let lastError: unknown;
    for (const index of order) {
      const url = this.urls[index] ?? this.urls[0];
      const body = { jsonrpc: "2.0", id: this.nextId++, method, params };
      try {
        const { json } = await fetchJson(this.fetchFn, this.budget, url, { method: "POST", body: JSON.stringify(body) });
        const message = json as { result?: unknown; error?: unknown };
        if (isJsonRpcError(message.error)) {
          if (isExecutionError(message.error)) throw new RpcRequestError({ body, error: message.error, url });
          lastError = new NetError("http", new URL(url).host, `RPC error ${message.error.code} from ${new URL(url).host}.`);
          this.preferred = 1;
          continue;
        }
        if (!("result" in message)) throw new NetError("parse", new URL(url).host, "RPC response has no result.");
        return message.result;
      } catch (error) {
        if (error instanceof NetError && error.retryable) {
          lastError = error;
          this.preferred = 1;
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new NetError("network", "rpc", "Base RPC is unreachable.");
  }
}

/** Walks an error's `cause` chain for a specific class (viem wraps transport errors several levels deep). */
export function findCause<T>(error: unknown, ctor: abstract new (...args: never[]) => T): T | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (current instanceof ctor) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export interface FeedRound {
  answer: bigint;
  updatedAt: bigint;
  decimals: number;
}

export interface TransferLog {
  from: Address;
  to: Address;
  value: bigint;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
}

export type SimulationResult = { ok: true } | { ok: false; errorName: string; message: string };

export class Chain {
  readonly client: PublicClient;
  readonly rpc: Rpc;

  constructor(rpc: Rpc) {
    this.rpc = rpc;
    this.client = createPublicClient({
      transport: custom({ request: ({ method, params }) => rpc.request(method, Array.isArray(params) ? params : []) }, { retryCount: 0 }),
      batch: { multicall: false },
      cacheTime: 0,
    });
  }

  async blockNumber(): Promise<bigint> {
    return BigInt(await this.rpc.request("eth_blockNumber", []) as string);
  }

  async ethBalance(address: Address): Promise<bigint> {
    return BigInt(await this.rpc.request("eth_getBalance", [address, "latest"]) as string);
  }

  async gasPrice(): Promise<bigint> {
    return BigInt(await this.rpc.request("eth_gasPrice", []) as string);
  }

  usdcBalance(owner: Address): Promise<bigint> {
    return this.client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  }

  usdcAllowance(owner: Address, spender: Address): Promise<bigint> {
    return this.client.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  }

  async feedRound(feed: Address): Promise<FeedRound> {
    const [round, decimals] = await Promise.all([
      this.client.readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" }),
      this.client.readContract({ address: feed, abi: aggregatorAbi, functionName: "decimals" }),
    ]);
    return { answer: round[1], updatedAt: round[3], decimals };
  }

  /** Chainlink L2 sequencer uptime: answer 0 = up; `startedAt` is when the current status began. */
  async sequencer(): Promise<{ up: boolean; since: bigint }> {
    const round = await this.client.readContract({ address: SEQUENCER_UPTIME_FEED, abi: aggregatorAbi, functionName: "latestRoundData" });
    return { up: round[1] === 0n && round[2] !== 0n, since: round[2] };
  }

  getDeal(escrow: Address, id: bigint) {
    return this.client.readContract({ address: escrow, abi: escrowAbi, functionName: "getDeal", args: [id] });
  }

  getBet(escrow: Address, id: bigint) {
    return this.client.readContract({ address: escrow, abi: escrowAbi, functionName: "getBet", args: [id] });
  }

  nextDealId(escrow: Address): Promise<bigint> {
    return this.client.readContract({ address: escrow, abi: escrowAbi, functionName: "nextDealId" });
  }

  /** USDC credited to `user` after a failed direct payout; claimable with `withdraw()`. */
  owed(escrow: Address, user: Address): Promise<bigint> {
    return this.client.readContract({ address: escrow, abi: escrowAbi, functionName: "owed", args: [user] });
  }

  nextBetId(escrow: Address): Promise<bigint> {
    return this.client.readContract({ address: escrow, abi: escrowAbi, functionName: "nextBetId" });
  }

  async blockTimestamp(blockNumber: bigint): Promise<bigint> {
    const block = await this.rpc.request("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false]) as { timestamp?: string } | null;
    if (!block?.timestamp) throw new NetError("parse", "rpc", "Block not found.");
    return BigInt(block.timestamp);
  }

  /** `eth_call` from `caller`. Reverts come back decoded (custom error name); transport failures throw. */
  async simulate(caller: Address, call: { to: Address; data: Hex }): Promise<SimulationResult> {
    try {
      await this.client.call({ account: caller, to: call.to, data: call.data });
      return { ok: true };
    } catch (error) {
      const net = findCause(error, NetError);
      if (net) throw net;
      return { ok: false, ...decodeRevert(error) };
    }
  }

  /** USDC Transfer logs to `recipient` in [from, to], one `eth_getLogs` call (caller bounds the range). */
  async transfersTo(recipient: Address, fromBlock: bigint, toBlock: bigint): Promise<TransferLog[]> {
    const logs = await this.rpc.request("eth_getLogs", [{
      address: USDC,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [TRANSFER_TOPIC, null, pad(recipient.toLowerCase() as Hex, { size: 32 })],
    }]);
    if (!Array.isArray(logs)) throw new NetError("parse", "rpc", "eth_getLogs returned a non-array.");
    return logs.flatMap((raw) => parseTransferLog(raw));
  }

  async transfersInTx(txHash: Hex): Promise<{ success: boolean; logs: TransferLog[] } | null> {
    const receipt = await this.rpc.request("eth_getTransactionReceipt", [txHash]) as { status?: string; logs?: unknown[] } | null;
    if (!receipt) return null;
    return { success: receipt.status === "0x1", logs: (receipt.logs ?? []).flatMap((raw) => parseTransferLog(raw)) };
  }
}

function topicAddress(topic: unknown): Address | undefined {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return undefined;
  return `0x${topic.slice(26)}` as Address;
}

export function parseTransferLog(raw: unknown): TransferLog[] {
  const log = raw as { address?: unknown; topics?: unknown; data?: unknown; blockNumber?: unknown; logIndex?: unknown; transactionHash?: unknown; removed?: unknown };
  if (typeof log.address !== "string" || log.address.toLowerCase() !== USDC.toLowerCase()) return [];
  if (!Array.isArray(log.topics) || log.topics[0] !== TRANSFER_TOPIC || log.removed === true) return [];
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  if (!from || !to || typeof log.data !== "string" || typeof log.blockNumber !== "string" || typeof log.logIndex !== "string" ||
    typeof log.transactionHash !== "string") return [];
  return [{
    from,
    to,
    value: BigInt(log.data === "0x" ? 0 : log.data),
    blockNumber: BigInt(log.blockNumber),
    logIndex: Number(BigInt(log.logIndex)),
    txHash: log.transactionHash as Hex,
  }];
}

function revertData(error: unknown): Hex | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    const data = (current as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]*$/.test(data)) return data as Hex;
    if (typeof data === "object" && data !== null && typeof (data as { data?: unknown }).data === "string") {
      return (data as { data: Hex }).data;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Decodes TabEscrow custom errors, Error(string) and Panic(uint256) from a failed eth_call. */
export function decodeRevert(error: unknown): { errorName: string; message: string } {
  const data = revertData(error);
  if (data && data.length >= 10) {
    try {
      const decoded = decodeErrorResult({ abi: escrowAbi, data });
      const detail = decoded.args && decoded.args.length > 0 ? `(${decoded.args.map(String).join(", ")})` : "";
      return { errorName: decoded.errorName, message: `${decoded.errorName}${detail}` };
    } catch {
      return { errorName: `Unknown(${data.slice(0, 10)})`, message: `Reverted with selector ${data.slice(0, 10)}` };
    }
  }
  const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  return { errorName: "Reverted", message };
}
