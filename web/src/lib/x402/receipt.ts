import "server-only";
import { parseAbiItem, parseEventLogs, type Hex, type PublicClient } from "viem";
import { publicClient } from "../chain/rpc";
import type { TransferSource, UsdcTransfer } from "../chain/matching";
import { USDC_ADDRESS } from "../constants";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const RECEIPT_TIMEOUT_MS = 30_000;

/** USDC transfers emitted by one mined transaction; throws if it doesn't land in time or reverted. */
export async function receiptTransfers(hash: Hex, client: PublicClient = publicClient()): Promise<UsdcTransfer[]> {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  if (receipt.status !== "success") throw new Error(`settlement tx ${hash} reverted`);
  const usdcLogs = receipt.logs.filter((log) => log.address.toLowerCase() === USDC_ADDRESS.toLowerCase());
  return parseEventLogs({ abi: [transferEvent], logs: usdcLogs, strict: true }).map((log) => ({
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    from: log.args.from,
    to: log.args.to,
    value: log.args.value,
  }));
}

/**
 * A chain view containing only the settlement tx, so the existing matcher (exact recipient +
 * unique amount, transfer not already assigned) decides paid-ness from on-chain truth instead of
 * trusting the facilitator's word, without a slow historical log scan.
 */
export function singleTxSource(transfers: readonly UsdcTransfer[]): TransferSource {
  const head = transfers.reduce((max, t) => (t.blockNumber > max ? t.blockNumber : max), 0n);
  return {
    headBlock: async () => head,
    transfersTo: async (recipient, fromBlock, toBlock) =>
      transfers.filter(
        (t) => t.to.toLowerCase() === recipient.toLowerCase() && t.blockNumber >= fromBlock && t.blockNumber <= toBlock,
      ),
  };
}
