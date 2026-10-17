import "server-only";
import { createPublicClient, fallback, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";
import { PUBLIC_RPC_URLS, USDC_ADDRESS } from "../constants";
import type { TransferSource, UsdcTransfer } from "./matching";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const globalForRpc = globalThis as unknown as { __tabRpc?: PublicClient; __tabLogsRpc?: PublicClient };

function makeClient(urls: readonly string[]): PublicClient {
  return createPublicClient({
    chain: base,
    transport: fallback(
      urls.map((url) => http(url, { timeout: 4000, retryCount: 1, retryDelay: 150 })),
      { rank: false, retryCount: 1 },
    ),
    batch: { multicall: true },
  }) as PublicClient;
}

/** mainnet.base.org rejects eth_getLogs (-32011), so log scans prefer publicnode. */
export function logsClient(): PublicClient {
  const override = process.env.BASE_RPC_URL?.trim();
  globalForRpc.__tabLogsRpc ??= makeClient([
    ...(override ? [override] : []),
    ...[...PUBLIC_RPC_URLS].reverse(),
  ]);
  return globalForRpc.__tabLogsRpc;
}

/** BASE_RPC_URL (if set) first, then the public hosts. viem's fallback rotates on errors and non-JSON responses. */
export function publicClient(): PublicClient {
  if (globalForRpc.__tabRpc) return globalForRpc.__tabRpc;
  const override = process.env.BASE_RPC_URL?.trim();
  const urls = [...(override ? [override] : []), ...PUBLIC_RPC_URLS];
  const client = makeClient(urls);
  globalForRpc.__tabRpc = client;
  return client;
}

export function rpcTransferSource(client: PublicClient = logsClient()): TransferSource {
  return {
    headBlock: () => client.getBlockNumber({ cacheTime: 1000 }),
    async transfersTo(recipient: Address, fromBlock: bigint, toBlock: bigint): Promise<UsdcTransfer[]> {
      const logs = await client.getLogs({
        address: USDC_ADDRESS,
        event: transferEvent,
        args: { to: recipient },
        fromBlock,
        toBlock,
        strict: true,
      });
      return logs.map((log) => ({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        from: log.args.from,
        to: log.args.to,
        value: log.args.value,
      }));
    },
  };
}

export async function blockTime(block: bigint, client: PublicClient = publicClient()): Promise<Date> {
  const b = await client.getBlock({ blockNumber: block });
  return new Date(Number(b.timestamp) * 1000);
}
