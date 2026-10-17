import { getAddress, isAddress, type Address } from "viem";

import { DEFAULT_ESCROW, DEFAULTS, USDC_DECIMALS } from "./constants.js";
import { atomicFromDecimal } from "./amount.js";
import { ToolError } from "./errors.js";

export interface Config {
  /** Tab web/API origin, e.g. https://tab-pay.vercel.app. Undefined when not configured. */
  readonly apiBase: string | undefined;
  readonly escrow: Address | undefined;
  readonly maxAtomic: bigint;
  readonly rpcUrls: readonly [string, string];
}

type Env = Readonly<Record<string, string | undefined>>;

function httpsOrigin(value: string | undefined, name: string, fallback?: string): string | undefined {
  const raw = value?.trim() || fallback;
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError(`${name} is not a valid URL.`, `Set ${name} to an https:// URL in the PayBox portal.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ToolError(`${name} must be an https:// URL without credentials.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Reads configuration lazily (inside a tool call), never at import time. */
export function readConfig(env: Env = process.env): Config {
  const escrowRaw = env.TAB_ESCROW?.trim() || DEFAULT_ESCROW;
  if (escrowRaw && !isAddress(escrowRaw, { strict: false })) {
    throw new ToolError("TAB_ESCROW is not a valid address.", "Set TAB_ESCROW to the deployed TabEscrow address.");
  }
  const maxRaw = env.TAB_MAX_USDC?.trim() || DEFAULTS.maxUsdc;
  let maxAtomic: bigint;
  try {
    maxAtomic = atomicFromDecimal(maxRaw, USDC_DECIMALS);
  } catch {
    throw new ToolError("TAB_MAX_USDC must be a positive decimal USDC amount.");
  }
  if (maxAtomic <= 0n) throw new ToolError("TAB_MAX_USDC must be greater than zero.");
  const primary = httpsOrigin(env.BASE_RPC_URL, "BASE_RPC_URL", DEFAULTS.rpcUrl) ?? DEFAULTS.rpcUrl;
  const fallback = httpsOrigin(env.BASE_RPC_FALLBACK, "BASE_RPC_FALLBACK", DEFAULTS.rpcFallback) ?? DEFAULTS.rpcFallback;
  return {
    apiBase: httpsOrigin(env.TAB_API_BASE, "TAB_API_BASE"),
    escrow: getAddress(escrowRaw.toLowerCase()),
    maxAtomic,
    rpcUrls: [primary, fallback],
  };
}

export function requireApiBase(config: Config): string {
  if (!config.apiBase) {
    throw new ToolError("Tab API is not configured.", "Set the TAB_API_BASE environment variable in the PayBox portal.");
  }
  return config.apiBase;
}

export function requireEscrow(config: Config): Address {
  if (!config.escrow) {
    throw new ToolError("TabEscrow address is not configured.", "Set the TAB_ESCROW environment variable in the PayBox portal.");
  }
  return config.escrow;
}
