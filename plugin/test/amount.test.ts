import { describe, expect, it } from "vitest";

import { atomicFromDecimal, formatUnitsExact, formatUsdc, formatUsdcCents, parseUsdc } from "../src/lib/amount.js";
import { ToolError } from "../src/lib/errors.js";

const CAP = 1_000_000_000n;

describe("atomicFromDecimal", () => {
  it.each([
    ["0", 0n], ["1", 1_000_000n], ["1.5", 1_500_000n], ["0.000001", 1n], ["2.000417", 2_000_417n],
    ["01.50", 1_500_000n], ["999999999.999999", 999_999_999_999_999n], ["10", 10_000_000n],
  ])("%s → %s", (input, expected) => {
    expect(atomicFromDecimal(input, 6)).toBe(expected);
  });

  it.each(["", ".", "1.", ".5", "-1", "1e6", "1,5", " 1", "0x10", "1.0000001", "NaN", "Infinity"])("rejects %j", (input) => {
    expect(() => atomicFromDecimal(input, 6)).toThrow(ToolError);
  });

  it("matches the starter's atomicAmount for many values", async () => {
    const { atomicAmount } = await import("../src/paybox.js");
    for (let i = 0; i < 500; i += 1) {
      const whole = Math.floor(Math.random() * 1e9);
      const frac = Math.floor(Math.random() * 1e6).toString().padStart(6, "0").replace(/0+$/, "");
      const s = frac ? `${whole}.${frac}` : `${whole}`;
      expect(atomicFromDecimal(s, 6).toString()).toBe(atomicAmount(s, 6));
    }
  });
});

describe("parseUsdc", () => {
  it("enforces > 0", () => {
    expect(() => parseUsdc("0", CAP)).toThrow(/greater than 0/);
    expect(() => parseUsdc("0.000000", CAP)).toThrow(/greater than 0/);
  });
  it("enforces the cap and shows it", () => {
    expect(parseUsdc("1000", CAP)).toBe(CAP);
    expect(() => parseUsdc("1000.000001", CAP)).toThrow(/safety cap of 1000.00 USDC/);
  });
  it("enforces the PRD format (≤9 integer digits, ≤6 decimals)", () => {
    expect(() => parseUsdc("1234567890", 10n ** 30n)).toThrow(ToolError);
    expect(() => parseUsdc("1.1234567", CAP)).toThrow(ToolError);
  });
});

describe("formatting", () => {
  it.each([
    [0n, "0.00"], [1n, "0.000001"], [2_000_000n, "2.00"], [2_000_417n, "2.000417"], [2_500_000n, "2.50"], [1_000_000_000_000n, "1000000.00"],
  ])("formatUsdc(%s) = %s", (atomic, expected) => {
    expect(formatUsdc(atomic)).toBe(expected);
  });
  it("formatUsdcCents truncates to cents", () => {
    expect(formatUsdcCents(2_000_417n)).toBe("2.00");
    expect(formatUsdcCents(3_339_999n)).toBe("3.33");
  });
  it("formatUnitsExact handles negatives and 8-decimal prices", () => {
    expect(formatUnitsExact(241_448_000_000n, 8, 2)).toBe("2414.48");
    expect(formatUnitsExact(-150n, 2)).toBe("-1.5");
  });
  it("round-trips every atomic value through format → parse", () => {
    for (let i = 0; i < 1000; i += 1) {
      const atomic = BigInt(Math.floor(Math.random() * 1e15));
      expect(atomicFromDecimal(formatUsdc(atomic), 6)).toBe(atomic);
    }
  });
});
