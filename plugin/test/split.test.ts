import { describe, expect, it } from "vitest";

import { ToolError } from "../src/lib/errors.js";
import { computeSplit, scaleWeight, tipToBps, type SplitParticipant } from "../src/lib/split.js";

// Deterministic PRNG so property failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const equal = (n: number): SplitParticipant[] => Array.from({ length: n }, () => ({}));

describe("computeSplit", () => {
  it("10 / 3 with include_self: 3.333333 each, requester absorbs the extra unit (PRD §16)", () => {
    const r = computeSplit({ total: 10_000_000n, participants: equal(2), includeSelf: true, tipBps: 0n });
    expect(r.shares).toEqual([3_333_333n, 3_333_333n]);
    expect(r.selfShare).toBe(3_333_334n);
  });

  it("10 / 3 without self: largest remainder, ties by position", () => {
    const r = computeSplit({ total: 10_000_000n, participants: equal(3), includeSelf: false, tipBps: 0n });
    expect(r.shares).toEqual([3_333_334n, 3_333_333n, 3_333_333n]);
    expect(r.selfShare).toBe(0n);
  });

  it("6 USDC among 3 (J1)", () => {
    const r = computeSplit({ total: 6_000_000n, participants: equal(2), includeSelf: true, tipBps: 0n });
    expect(r.shares).toEqual([2_000_000n, 2_000_000n]);
    expect(r.selfShare).toBe(2_000_000n);
  });

  it("custom amounts: remainder is the requester's share", () => {
    const r = computeSplit({ total: 10_000_000n, participants: [{ amount: 3_000_000n }, { amount: 2_500_000n }], includeSelf: false, tipBps: 0n });
    expect(r.mode).toBe("custom");
    expect(r.shares).toEqual([3_000_000n, 2_500_000n]);
    expect(r.selfShare).toBe(4_500_000n);
  });

  it("weighted with tip", () => {
    const r = computeSplit({ total: 100_000_000n, participants: [{ weight: scaleWeight(2) }, { weight: scaleWeight(1) }], includeSelf: true, tipBps: tipToBps(10) });
    expect(r.grandTotal).toBe(110_000_000n);
    expect(r.shares[0]).toBe(55_000_000n);
    expect(r.shares[1]).toBe(27_500_000n);
    expect(r.selfShare).toBe(27_500_000n);
  });

  it("rejects mixed and partial modes", () => {
    expect(() => computeSplit({ total: 1n, participants: [{ amount: 1n }, { weight: 1n }], includeSelf: true, tipBps: 0n })).toThrow(/not both/);
    expect(() => computeSplit({ total: 2n, participants: [{ amount: 1n }, {}], includeSelf: true, tipBps: 0n })).toThrow(/every participant/);
    expect(() => computeSplit({ total: 2n, participants: [{ weight: 1n }, {}], includeSelf: true, tipBps: 0n })).toThrow(/every participant/);
  });

  it("rejects custom amounts over the total, zero shares and zero weights", () => {
    expect(() => computeSplit({ total: 1_000_000n, participants: [{ amount: 600_000n }, { amount: 600_000n }], includeSelf: true, tipBps: 0n })).toThrow(/more than the total/);
    expect(() => computeSplit({ total: 1n, participants: equal(2), includeSelf: true, tipBps: 0n })).toThrow(/rounds to 0/);
    expect(() => computeSplit({ total: 1_000_000n, participants: [{ weight: 0n }], includeSelf: false, tipBps: 0n })).toThrow(/zero/);
  });

  it("property: shares + self == total + tip, every share > 0, deterministic", () => {
    const rand = rng(42);
    for (let i = 0; i < 3000; i += 1) {
      const n = 1 + Math.floor(rand() * 20);
      const total = BigInt(1 + Math.floor(rand() * 1e12));
      const includeSelf = rand() < 0.5;
      const tipBps = BigInt(Math.floor(rand() * 5001));
      const mode = rand();
      let participants: SplitParticipant[];
      if (mode < 0.33) participants = equal(n);
      else if (mode < 0.66) participants = Array.from({ length: n }, () => ({ weight: BigInt(1 + Math.floor(rand() * 1e9)) }));
      else {
        const per = total / BigInt(n + 1);
        if (per === 0n) continue;
        participants = Array.from({ length: n }, () => ({ amount: 1n + BigInt(Math.floor(rand() * Number(per))) }));
      }
      let r;
      try {
        r = computeSplit({ total, participants, includeSelf, tipBps });
      } catch (error) {
        expect(error).toBeInstanceOf(ToolError);
        continue;
      }
      expect(r.shares.reduce((a, b) => a + b, 0n) + r.selfShare).toBe(r.grandTotal);
      expect(r.grandTotal).toBe(total + (total * tipBps + 5000n) / 10000n);
      for (const s of r.shares) expect(s > 0n).toBe(true);
      expect(r.selfShare >= 0n).toBe(true);
      expect(computeSplit({ total, participants, includeSelf, tipBps })).toEqual(r);
    }
  });

  it("property: equal shares differ by at most 1 unit without self", () => {
    const rand = rng(7);
    for (let i = 0; i < 1000; i += 1) {
      const n = 1 + Math.floor(rand() * 20);
      const total = BigInt(n + Math.floor(rand() * 1e9));
      const r = computeSplit({ total, participants: equal(n), includeSelf: false, tipBps: 0n });
      const max = r.shares.reduce((a, b) => (a > b ? a : b));
      const min = r.shares.reduce((a, b) => (a < b ? a : b));
      expect(max - min <= 1n).toBe(true);
    }
  });
});

describe("input scaling", () => {
  it("scaleWeight / tipToBps", () => {
    expect(scaleWeight(1.5)).toBe(1_500_000n);
    expect(scaleWeight(0.000001)).toBe(1n);
    expect(() => scaleWeight(0.0000001)).toThrow(ToolError);
    expect(() => scaleWeight(1001)).toThrow(ToolError);
    expect(tipToBps(12.5)).toBe(1250n);
    expect(() => tipToBps(12.345)).toThrow(ToolError);
    expect(() => tipToBps(51)).toThrow(ToolError);
  });
});
