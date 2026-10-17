import type { Address, Hex } from "viem";
import { MIN_SCAN_BLOCK } from "../constants";

export interface UsdcTransfer {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  from: Address;
  to: Address;
  value: bigint;
}

/** Minimal chain view the matcher needs; the RPC implementation lives in rpc.ts. */
export interface TransferSource {
  headBlock(): Promise<bigint>;
  /** USDC transfers to `recipient` in the inclusive block range. Must throw rather than return partial data. */
  transfersTo(recipient: Address, fromBlock: bigint, toBlock: bigint): Promise<UsdcTransfer[]>;
}

export type ScanResult =
  | { kind: "found"; transfer: UsdcTransfer; scannedTo: bigint }
  | { kind: "not_found"; scannedTo: bigint }
  /** Budget or RPC failure stopped the scan; callers must report "checking", never "unpaid". */
  | { kind: "partial"; scannedTo: bigint };

export interface ScanParams {
  source: TransferSource;
  recipient: Address;
  uniqueAtomic: bigint;
  startBlock: bigint;
  /** Highest block already fully scanned by an earlier call, if any. */
  resumeAfter?: bigint | null;
  /** Transfers already assigned to a different request are skipped. */
  isExcluded?: (transfer: UsdcTransfer) => Promise<boolean>;
  budgetMs?: number;
  chunkSize?: bigint;
  concurrency?: number;
  now?: () => number;
  /** Scans never start below this block (TabEscrow deploy block in production). */
  floorBlock?: bigint;
}

export const MAX_CHUNK_BLOCKS = 2000n;

export function compareTransfers(a: UsdcTransfer, b: UsdcTransfer): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Candidates that satisfy the exact-amount rule, earliest first by (block, logIndex). */
export function matchingCandidates(
  transfers: readonly UsdcTransfer[],
  recipient: Address,
  uniqueAtomic: bigint,
  startBlock: bigint,
): UsdcTransfer[] {
  const to = recipient.toLowerCase();
  return transfers
    .filter((t) => t.value === uniqueAtomic && t.blockNumber >= startBlock && t.to.toLowerCase() === to)
    .sort(compareTransfers);
}

export function blockChunks(from: bigint, to: bigint, size: bigint = MAX_CHUNK_BLOCKS): Array<[bigint, bigint]> {
  if (size <= 0n || size > MAX_CHUNK_BLOCKS) throw new Error("chunk size must be in (0, 2000]");
  const chunks: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    chunks.push([start, end < to ? end : to]);
  }
  return chunks;
}

/**
 * PRD §11.3: paid iff a USDC Transfer(to = recipient, value = unique) exists at block ≥ start,
 * first match wins. Chunks are scanned in ascending order so the first match found is the earliest.
 */
export async function scanForPayment(params: ScanParams): Promise<ScanResult> {
  const {
    source,
    recipient,
    uniqueAtomic,
    resumeAfter,
    isExcluded = async () => false,
    budgetMs = 6000,
    chunkSize = MAX_CHUNK_BLOCKS,
    concurrency = 3,
    now = Date.now,
    floorBlock = MIN_SCAN_BLOCK,
  } = params;

  const deadline = now() + budgetMs;
  const startBlock = params.startBlock > floorBlock ? params.startBlock : floorBlock;
  const from = resumeAfter != null && resumeAfter + 1n > startBlock ? resumeAfter + 1n : startBlock;
  let scannedTo = from - 1n;

  let head: bigint;
  try {
    head = await source.headBlock();
  } catch {
    return { kind: "partial", scannedTo };
  }
  if (from > head) return { kind: "not_found", scannedTo: head };

  const chunks = blockChunks(from, head, chunkSize);
  for (let i = 0; i < chunks.length; i += concurrency) {
    if (now() >= deadline) return { kind: "partial", scannedTo };
    const batch = chunks.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(([a, b]) => source.transfersTo(recipient, a, b)));
    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "rejected") return { kind: "partial", scannedTo };
      for (const candidate of matchingCandidates(result.value, recipient, uniqueAtomic, startBlock)) {
        if (!(await isExcluded(candidate))) {
          return { kind: "found", transfer: candidate, scannedTo: batch[j][1] };
        }
      }
      scannedTo = batch[j][1];
    }
  }
  return { kind: "not_found", scannedTo };
}
