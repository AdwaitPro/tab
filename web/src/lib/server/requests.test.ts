import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isUniqueViolation } from "./errors";
import { createPgliteDb, type Db } from "@/lib/db/client";
import { requests } from "@/lib/db/schema";
import { FakeSource, PAYER, RECIPIENT, transfer } from "@/test/fixtures";
import {
  clearStatusCache,
  createRequest,
  createSplit,
  getRequestRow,
  getSplit,
  insertWithUniqueAmount,
  refreshRequestStatus,
  type ChainDeps,
  type NewRequest,
} from "./requests";

let db: Db;
const future = () => new Date(Date.now() + 24 * 3600 * 1000);
const base = (over: Partial<NewRequest> = {}): NewRequest => ({
  recipient: RECIPIENT,
  amountAtomic: 2_000_000n,
  memo: "Dinner",
  payerLabel: "Meera",
  requesterLabel: "Adwait",
  expiresAt: future(),
  startBlock: 1_000n,
  ...over,
});

beforeEach(async () => {
  db = await createPgliteDb();
  clearStatusCache();
});

describe("unique amount allocation", () => {
  it("adds a suffix in [1, 9999] and never reuses one among open requests", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = await createRequest(db, base());
      const s = BigInt(r.unique_atomic) - BigInt(r.amount_atomic);
      expect(s >= 1n && s <= 9999n).toBe(true);
      expect(seen.has(r.unique_atomic)).toBe(false);
      seen.add(r.unique_atomic);
    }
  });

  it("steps past a taken suffix when the RNG collides", async () => {
    const always7 = () => 7;
    const a = await insertWithUniqueAmount(db, base(), always7);
    const b = await insertWithUniqueAmount(db, base(), always7);
    expect(a.uniqueAtomic).toBe("2000007");
    expect(b.uniqueAtomic).toBe("2000008");
  });

  it("avoids collisions across different base amounts", async () => {
    // 2.000400 + 17 would equal 2.000000 + 417, so the allocator must step past it.
    await insertWithUniqueAmount(db, base(), () => 417);
    const row = await insertWithUniqueAmount(db, base({ amountAtomic: 2_000_400n }), () => 17);
    expect(row.uniqueAtomic).toBe("2000418");
  });

  it("has a DB-level unique constraint on open (recipient, unique_atomic)", async () => {
    const a = await insertWithUniqueAmount(db, base(), () => 5);
    await expect(db.insert(requests).values({ ...a, id: "X".repeat(22) })).rejects.toSatisfy(isUniqueViolation);
  });

  it("stays unique under concurrent allocation with identical RNG", async () => {
    const rows = await Promise.all(Array.from({ length: 6 }, () => insertWithUniqueAmount(db, base(), () => 5)));
    expect(new Set(rows.map((r) => r.uniqueAtomic)).size).toBe(6);
  });

  it("frees the amount once a request is no longer open", async () => {
    const a = await insertWithUniqueAmount(db, base(), () => 5);
    await db.update(requests).set({ status: "paid" }).where(eq(requests.id, a.id));
    const b = await insertWithUniqueAmount(db, base(), () => 5);
    expect(b.uniqueAtomic).toBe(a.uniqueAtomic);
  });

  it("keeps different recipients independent", async () => {
    await insertWithUniqueAmount(db, base(), () => 9);
    const other = await insertWithUniqueAmount(db, base({ recipient: PAYER }), () => 9);
    expect(other.uniqueAtomic).toBe("2000009");
  });
});

describe("splits", () => {
  it("creates all members atomically, in body order, with distinct amounts", async () => {
    const result = await createSplit(db, {
      recipient: RECIPIENT,
      totalAtomic: 6_000_000n,
      memo: "Dinner",
      requesterLabel: "Adwait",
      expiresAt: future(),
      startBlock: 1_000n,
      members: [
        { payerLabel: "Meera", amountAtomic: 2_000_000n },
        { payerLabel: "Aarav", amountAtomic: 2_000_000n },
      ],
    });
    expect(result.requests.map((r) => r.payer_label)).toEqual(["Meera", "Aarav"]);
    expect(new Set(result.requests.map((r) => r.unique_atomic)).size).toBe(2);
    const fetched = await getSplit(db, result.split.id);
    expect(fetched?.requests.map((r) => r.payer_label)).toEqual(["Meera", "Aarav"]);
    expect(fetched?.collected_atomic).toBe("0");
  });

  it("rejects member sums above the total without writing anything", async () => {
    await expect(
      createSplit(db, {
        recipient: RECIPIENT,
        totalAtomic: 1_000_000n,
        memo: null,
        requesterLabel: null,
        expiresAt: future(),
        startBlock: 1n,
        members: [{ payerLabel: "A", amountAtomic: 2_000_000n }],
      }),
    ).rejects.toThrow();
    expect(await db.select().from(requests)).toHaveLength(0);
  });
});

describe("refreshRequestStatus", () => {
  const chain = (source: FakeSource, at = new Date()): ChainDeps => ({ source, blockTime: async () => at, floorBlock: 0n });

  it("marks paid from an exact transfer and assigns the tx to only one request", async () => {
    const r1 = await insertWithUniqueAmount(db, base(), () => 11);
    const pay = transfer({ value: 2_000_011n, blockNumber: 1_500n });
    const status = await refreshRequestStatus(db, r1, chain(new FakeSource(2_000n, [pay])));
    expect(status).toMatchObject({ status: "paid", paid_tx: pay.txHash, payer_address: PAYER });
    const stored = await getRequestRow(db, r1.id);
    expect(stored?.status).toBe("paid");

    // A second request reusing the freed amount must not match the same transfer.
    const r2 = await insertWithUniqueAmount(db, base(), () => 11);
    clearStatusCache();
    const s2 = await refreshRequestStatus(db, r2, chain(new FakeSource(2_000n, [pay])));
    expect(s2.status).toBe("open");
  });

  it("reports checking (never open) when the scan is incomplete", async () => {
    const r = await insertWithUniqueAmount(db, base(), () => 3);
    const source = new FakeSource(9_000n);
    source.failFrom = 0n;
    const status = await refreshRequestStatus(db, r, chain(source));
    expect(status.status).toBe("checking");
  });

  it("flags paid_late when the transfer lands after expiry", async () => {
    const r = await insertWithUniqueAmount(db, base({ expiresAt: new Date(Date.now() + 1000) }), () => 4);
    const status = await refreshRequestStatus(
      db,
      r,
      chain(new FakeSource(2_000n, [transfer({ value: 2_000_004n, blockNumber: 1_200n })]), new Date(Date.now() + 60_000)),
    );
    expect(status.status).toBe("paid_late");
  });

  it("persists scan progress so later checks resume", async () => {
    const r = await insertWithUniqueAmount(db, base(), () => 2);
    await refreshRequestStatus(db, r, chain(new FakeSource(4_000n)));
    expect((await getRequestRow(db, r.id))?.scannedBlock).toBe(4_000n);
  });
});
