import { TabApi } from "./api.js";
import { Chain, Rpc } from "./chain.js";
import { readConfig, requireApiBase, type Config } from "./config.js";
import { Budget, type FetchFn } from "./net.js";

/** Everything a tool handler touches outside pure logic. Built per call so nothing runs at import/discovery. */
export interface ToolContext {
  readonly config: Config;
  readonly budget: Budget;
  readonly chain: Chain;
  readonly fetchFn: FetchFn;
  /** Unix milliseconds. */
  now(): number;
  api(): TabApi;
  /** Random bytes as lowercase hex (nonces). */
  randomHex(bytes: number): string;
}

export interface ContextOptions {
  env?: Readonly<Record<string, string | undefined>>;
  fetchFn?: FetchFn;
  now?: () => number;
  randomHex?: (bytes: number) => string;
  budgetMs?: number;
}

export function createContext(options: ContextOptions = {}): ToolContext {
  const now = options.now ?? Date.now;
  const config = readConfig(options.env ?? process.env);
  const fetchFn: FetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  // The budget always runs on the real clock; `now` only drives business time (expiry, deadlines).
  const budget = new Budget(options.budgetMs);
  const chain = new Chain(new Rpc(config.rpcUrls, fetchFn, budget));
  let api: TabApi | undefined;
  return {
    config,
    budget,
    chain,
    fetchFn,
    now,
    api: () => (api ??= new TabApi(requireApiBase(config), fetchFn, budget)),
    randomHex: options.randomHex ?? ((bytes) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex")),
  };
}
