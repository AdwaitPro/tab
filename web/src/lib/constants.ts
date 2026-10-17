import type { Address } from "viem";

export const BASE_CHAIN_ID = 8453;
export const USDC_ADDRESS: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

export const BASESCAN_URL = "https://basescan.org";
export const PUBLIC_RPC_URLS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"] as const;

/** Payment scans never start below TabEscrow's deploy block (shared/api-contract.md). */
export const MIN_SCAN_BLOCK = 52_737_895n;

export const PAYBOX_APP_URL = "https://app.paybox.sh";
export const PAYBOX_DEPOSIT_URL = "https://app.paybox.sh/deposit";

/** Unique-amount suffix range in atomic units: s ∈ [1, 9999] adds < 0.01 USDC. */
export const SUFFIX_MIN = 1;
export const SUFFIX_MAX = 9999;

export const MAX_SPLIT_MEMBERS = 20;
export const MEMO_MAX = 140;
export const LABEL_MAX = 40;
export const TERMS_MAX = 2000;

/** Hackathon safety cap mirrors the plugin's TAB_MAX_USDC default. */
export const MAX_AMOUNT_ATOMIC = 1_000n * 10n ** 6n;

export function txUrl(hash: string): string {
  return `${BASESCAN_URL}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${BASESCAN_URL}/address/${address}`;
}
