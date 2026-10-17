import type { Address } from "viem";

// Verified on-chain 2026-10-18 (contracts/CONSTANTS.md). Hardcoded on purpose: the plugin is Base-only and
// USDC-only, so neither chain nor token can be redirected by configuration.
export const CHAIN_ID = 8453;
export const CHAIN = "eip155:8453";
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;
export const SEQUENCER_UPTIME_FEED: Address = "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433";

export const ASSETS = ["ETH", "BTC"] as const;
export type Asset = (typeof ASSETS)[number];

export interface FeedInfo {
  readonly address: Address;
  readonly pair: string;
  readonly decimals: number;
  readonly heartbeatSeconds: number;
  readonly maxStalenessSeconds: number;
}

export const FEEDS: Readonly<Record<Asset, FeedInfo>> = {
  ETH: {
    address: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    pair: "ETH/USD",
    decimals: 8,
    heartbeatSeconds: 1200,
    maxStalenessSeconds: 3600,
  },
  BTC: {
    address: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
    pair: "BTC/USD",
    decimals: 8,
    heartbeatSeconds: 1200,
    maxStalenessSeconds: 3600,
  },
};

// Mirrors TabEscrow constants; used only to explain timing to the agent. The contract enforces them.
export const ESCROW_TIMING = {
  minReviewWindow: 60,
  maxReviewWindow: 30 * 86_400,
  disputeTimeout: 30 * 86_400,
  minJoinGap: 600,
  sequencerGrace: 3_600,
  priceRefundDelay: 3 * 86_400,
  mutualRefundDelay: 7 * 86_400,
  arbitrationGrace: 2 * 86_400,
} as const;

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** TabEscrow on Base (Sourcify exact match). Overridable via TAB_ESCROW. */
export const DEFAULT_ESCROW: Address = "0xCe8dE8f1647ED91Db4Ba9B71B9AF94e2405cbCe9";
/** TabEscrow v2 deploy block (escrow events start here). */
export const ESCROW_DEPLOY_BLOCK = 52_738_530n;
/** First Tab deployment (v1, block 52737895): no request can predate it, so it floors every USDC log scan. */
export const REQUEST_SCAN_FLOOR = 52_737_895n;

export const DEFAULTS = {
  rpcUrl: "https://mainnet.base.org",
  rpcFallback: "https://base-rpc.publicnode.com",
  maxUsdc: "1000",
} as const;

export const DEPOSIT_URL = "https://app.paybox.sh/deposit";
export const EXPLORER_TX = "https://basescan.org/tx/";
export const EXPLORER_ADDRESS = "https://basescan.org/address/";

export const LIMITS = {
  memo: 140,
  label: 40,
  dealTerms: 500,
  eventDescription: 280,
  participants: 20,
  listVerify: 10,
  logChunkBlocks: 2_000n,
} as const;

export const TIMEOUTS = {
  perRequestMs: 4_000,
  toolBudgetMs: 7_500,
  minAttemptMs: 250,
} as const;
