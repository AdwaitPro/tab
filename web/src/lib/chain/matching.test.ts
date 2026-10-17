import { describe, expect, it } from "vitest";
import { FakeSource, RECIPIENT, transfer } from "@/test/fixtures";
import { blockChunks, matchingCandidates, scanForPayment } from "./matching";

const UNIQUE = 2_000_417n;

describe("blockChunks", () => {
  it("never exceeds 2000 blocks and covers the range exactly", () => {
    const chunks = blockChunks(100n, 4_500n);
    expect(chunks).toEqual([
      [100n, 2_099n],
      [2_100n, 4_099n],
      [4_100n, 4_500n],
    ]);
    for (const [a, b] of chunks) expect(b - a + 1n).toBeLessThanOrEqual(2000n);
  });

  it("rejects oversize chunks", () => {
    expect(() => blockChunks(0n, 10n, 2001n)).toThrow();
  });
});

describe("matchingCandidates", () => {
  it("requires exact value, block ≥ start, and orders by (block, logIndex)", () => {
    const late = transfer({ value: UNIQUE, blockNumber: 20n, logIndex: 1 });
    const early = transfer({ value: UNIQUE, blockNumber: 20n, logIndex: 0 });
    const before = transfer({ value: UNIQUE, blockNumber: 5n });
    const wrong = transfer({ value: UNIQUE + 1n, blockNumber: 15n });
    expect(matchingCandidates([late, wrong, before, early], RECIPIENT, UNIQUE, 10n)).toEqual([early, late]);
  });
});

describe("scanForPayment", () => {
  it("finds the earliest exact transfer at or after start_block", async () => {
    const first = transfer({ value: UNIQUE, blockNumber: 3_500n });
    const second = transfer({ value: UNIQUE, blockNumber: 3_600n });
    const source = new FakeSource(10_000n, [second, first, transfer({ value: UNIQUE, blockNumber: 50n })]);
    const result = await scanForPayment({ source, recipient: RECIPIENT, uniqueAtomic: UNIQUE, floorBlock: 0n, startBlock: 1_000n });
    expect(result).toMatchObject({ kind: "found", transfer: first });
    for (const [a, b] of source.queried) expect(b - a + 1n).toBeLessThanOrEqual(2000n);
  });

  it("reports not_found only after scanning through head", async () => {
    const source = new FakeSource(5_000n, [transfer({ value: UNIQUE - 1n, blockNumber: 4_000n })]);
    const result = await scanForPayment({ source, recipient: RECIPIENT, uniqueAtomic: UNIQUE, floorBlock: 0n, startBlock: 1_000n });
    expect(result).toEqual({ kind: "not_found", scannedTo: 5_000n });
  });

  it("never reports not_found when a chunk fails: partial with contiguous progress", async () => {
    const source = new FakeSource(9_000n);
    source.failFrom = 5_000n;
    const result = await scanForPayment({
      source,
      recipient: RECIPIENT,
      uniqueAtomic: UNIQUE,
      floorBlock: 0n,
      startBlock: 1_000n,
      concurrency: 1,
    });
    expect(result).toEqual({ kind: "partial", scannedTo: 4_999n });
  });

  it("is partial when the head lookup fails", async () => {
    const source = new FakeSource(9_000n);
    source.headFails = true;
    const result = await scanForPayment({ source, recipient: RECIPIENT, uniqueAtomic: UNIQUE, floorBlock: 0n, startBlock: 1_000n });
    expect(result.kind).toBe("partial");
  });

  it("stops at the time budget and reports partial", async () => {
    let t = 0;
    const source = new FakeSource(100_000n);
    const result = await scanForPayment({
      source,
      recipient: RECIPIENT,
      uniqueAtomic: UNIQUE,
      floorBlock: 0n,
      startBlock: 0n,
      budgetMs: 10,
      concurrency: 1,
      now: () => (t += 4),
    });
    expect(result.kind).toBe("partial");
    expect(source.queried.length).toBeLessThan(50);
  });

  it("resumes after a persisted cursor", async () => {
    const source = new FakeSource(6_000n);
    await scanForPayment({ source, recipient: RECIPIENT, uniqueAtomic: UNIQUE, floorBlock: 0n, startBlock: 1_000n, resumeAfter: 4_999n });
    expect(source.queried[0]?.[0]).toBe(5_000n);
  });

  it("skips transfers already assigned to another request", async () => {
    const taken = transfer({ value: UNIQUE, blockNumber: 1_100n });
    const free = transfer({ value: UNIQUE, blockNumber: 1_200n });
    const source = new FakeSource(2_000n, [taken, free]);
    const result = await scanForPayment({
      source,
      recipient: RECIPIENT,
      uniqueAtomic: UNIQUE,
      floorBlock: 0n,
      startBlock: 1_000n,
      isExcluded: async (t) => t.txHash === taken.txHash,
    });
    expect(result).toMatchObject({ kind: "found", transfer: free });
  });
});

describe("scan floor", () => {
  it("never scans below the escrow deploy block", async () => {
    const source = new FakeSource(52_740_000n);
    await scanForPayment({ source, recipient: RECIPIENT, uniqueAtomic: UNIQUE, startBlock: 1n });
    expect(source.queried[0]?.[0]).toBe(52_737_895n);
  });
});
