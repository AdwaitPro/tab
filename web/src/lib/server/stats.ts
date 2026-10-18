import "server-only";
import { inArray, isNotNull, and, sql } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { publicClient } from "../chain/rpc";
import { tabEscrowAbi } from "../chain/tab-escrow-abi";
import { getDb } from "../db/client";
import { requests } from "../db/schema";
import { serverEnv } from "./env";

export interface LiveStats {
  settledAtomic: string;
  payments: string;
  deals: string;
  bets: string;
}

/** Real numbers only: chain-verified paid requests from the DB, escrow counters read from Base. Null on failure. */
export async function liveStats(): Promise<LiveStats | null> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 600 });
  try {
    const escrow = serverEnv().escrowAddress;
    const db = await getDb();
    const [[row], counters] = await Promise.all([
      db
        .select({
          total: sql<string>`coalesce(sum(${requests.uniqueAtomic}), 0)::text`,
          count: sql<string>`count(*)::text`,
        })
        .from(requests)
        .where(and(inArray(requests.status, ["paid", "paid_late"]), isNotNull(requests.paidTx))),
      escrow
        ? Promise.all([
            publicClient().readContract({ address: escrow, abi: tabEscrowAbi, functionName: "nextDealId" }),
            publicClient().readContract({ address: escrow, abi: tabEscrowAbi, functionName: "nextBetId" }),
          ])
        : Promise.resolve([1n, 1n] as const),
    ]);
    const minusOne = (n: bigint) => (n > 0n ? n - 1n : 0n).toString();
    return { settledAtomic: row?.total ?? "0", payments: row?.count ?? "0", deals: minusOne(counters[0]), bets: minusOne(counters[1]) };
  } catch {
    return null;
  }
}
