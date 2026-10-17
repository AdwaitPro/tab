import type { Address, Hex } from "viem";

import type { Chain, TransferLog } from "./chain.js";
import { REQUEST_SCAN_FLOOR, LIMITS } from "./constants.js";
import { NetError } from "./errors.js";
import type { Budget } from "./net.js";

export interface PaymentTarget {
  key: string;
  unique: bigint;
  startBlock: bigint;
  /** Unix seconds. */
  expiresAt: number;
  /** Tx the API claims paid this request; verified on-chain, never trusted. */
  hintTx?: Hex | null | undefined;
}

export type PaymentFinding =
  | { status: "paid" | "paid_late"; tx: Hex; payer: Address; paidAt: number; block: bigint }
  | { status: "unpaid" }
  | { status: "checking"; reason: string };

const CONCURRENCY = 3;
// Leave time to format the answer (and for a second phase like balance checks in tab_pay).
const RESERVE_MS = 1_200;

function matches(log: TransferLog, recipient: Address, target: PaymentTarget): boolean {
  return log.to.toLowerCase() === recipient.toLowerCase() && log.value === target.unique && log.blockNumber >= target.startBlock;
}

function earlier(a: TransferLog, b: TransferLog | undefined): boolean {
  return !b || a.blockNumber < b.blockNumber || (a.blockNumber === b.blockNumber && a.logIndex < b.logIndex);
}

/**
 * PRD §11.3: paid iff a USDC Transfer(to = recipient, value = unique) exists at block ≥ start_block. Scans
 * eth_getLogs in ≤2,000-block chunks, newest first (a recent payment is found fast); a match found on a partial
 * scan is still proof of payment, but "unpaid" is only reported after full coverage; otherwise "checking".
 */
export async function findPayments(chain: Chain, budget: Budget, recipient: Address, targets: readonly PaymentTarget[],
  reserveMs = RESERVE_MS): Promise<Map<string, PaymentFinding>> {
  const found = new Map<string, TransferLog>();
  const results = new Map<string, PaymentFinding>();
  if (targets.length === 0) return results;

  await Promise.all(targets.filter((t) => t.hintTx).map(async (target) => {
    try {
      const receipt = await chain.transfersInTx(target.hintTx as Hex);
      const log = receipt?.success ? receipt.logs.find((l) => matches(l, recipient, target)) : undefined;
      if (log) found.set(target.key, log);
    } catch (error) {
      if (!(error instanceof NetError)) throw error;
    }
  }));

  let pending = targets.filter((t) => !found.has(t.key));
  let complete = true;
  let reason = "";
  if (pending.length > 0) {
    try {
      const latest = await chain.blockNumber();
      const lowest = pending.reduce((min, t) => (t.startBlock < min ? t.startBlock : min), pending[0]?.startBlock ?? latest);
      const floor = lowest < REQUEST_SCAN_FLOOR ? REQUEST_SCAN_FLOOR : lowest;
      const chunks: { from: bigint; to: bigint }[] = [];
      for (let to = latest; to >= floor; to -= LIMITS.logChunkBlocks) {
        const from = to - LIMITS.logChunkBlocks + 1n > floor ? to - LIMITS.logChunkBlocks + 1n : floor;
        chunks.push({ from, to });
        if (from === floor) break;
      }
      let next = 0;
      while (next < chunks.length && pending.length > 0) {
        if (budget.remaining() < reserveMs + 500) {
          complete = false;
          reason = `scanned ${next} of ${chunks.length} block ranges before the time budget ran out`;
          break;
        }
        const batch = chunks.slice(next, next + CONCURRENCY);
        const logs = (await Promise.all(batch.map((c) => chain.transfersTo(recipient, c.from, c.to)))).flat();
        next += batch.length;
        for (const target of pending) {
          for (const log of logs) {
            if (matches(log, recipient, target) && earlier(log, found.get(target.key))) found.set(target.key, log);
          }
        }
        pending = pending.filter((t) => !found.has(t.key));
      }
    } catch (error) {
      if (!(error instanceof NetError)) throw error;
      complete = false;
      reason = `Base RPC unavailable (${error.message})`;
    }
  }

  await Promise.all(targets.map(async (target) => {
    const log = found.get(target.key);
    if (!log) {
      results.set(target.key, complete ? { status: "unpaid" } : { status: "checking", reason });
      return;
    }
    let paidAt = 0;
    try {
      paidAt = Number(await chain.blockTimestamp(log.blockNumber));
    } catch (error) {
      if (!(error instanceof NetError)) throw error;
    }
    results.set(target.key, {
      status: paidAt > target.expiresAt ? "paid_late" : "paid",
      tx: log.txHash,
      payer: log.from,
      paidAt,
      block: log.blockNumber,
    });
  }));
  return results;
}
