import "server-only";
import { blockTime, rpcTransferSource } from "../chain/rpc";
import type { ChainDeps } from "./requests";

export function liveChain(budgetMs = 6000): ChainDeps {
  return { source: rpcTransferSource(), blockTime: (block) => blockTime(block), budgetMs };
}
