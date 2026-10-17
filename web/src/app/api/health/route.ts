import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { publicClient } from "@/lib/chain/rpc";
import { getDb } from "@/lib/db/client";
import { serverEnv } from "@/lib/server/env";
import { json } from "@/lib/server/http";

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - started, value };
  } catch {
    return { ok: false, ms: Date.now() - started };
  }
}

export async function GET(): Promise<Response> {
  await connection();
  const [rpc, db] = await Promise.all([
    timed(() => publicClient().getBlockNumber()),
    timed(async () => (await getDb()).execute(sql`select 1`)),
  ]);
  const ok = rpc.ok && db.ok;
  return json(
    {
      ok,
      rpc: { ok: rpc.ok, ms: rpc.ms, block: rpc.value?.toString() ?? null },
      db: { ok: db.ok, ms: db.ms },
      escrow_configured: serverEnv().escrowAddress !== null,
      time: new Date().toISOString(),
    },
    ok ? 200 : 503,
  );
}
