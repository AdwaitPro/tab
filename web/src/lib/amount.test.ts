import { describe, expect, it } from "vitest";
import { formatUsdc, formatUsdcExact, formatUsdcShort, parseUsdc } from "./amount";
import { isId, newId } from "./ids";
import { cleanText } from "./text";

describe("amounts", () => {
  it("parses decimals exactly", () => {
    expect(parseUsdc("2")).toBe(2_000_000n);
    expect(parseUsdc("2.000417")).toBe(2_000_417n);
    expect(parseUsdc("0.1")).toBe(100_000n);
    for (const bad of ["", "1.", ".5", "1.1234567", "-1", "1e3", "1,000"]) expect(() => parseUsdc(bad)).toThrow();
  });

  it("formats for display", () => {
    expect(formatUsdc(2_000_000n)).toBe("2.00");
    expect(formatUsdc(2_000_417n)).toBe("2.000417");
    expect(formatUsdc(2_500_000n)).toBe("2.50");
    expect(formatUsdc(1_234_567_000_000n)).toBe("1,234,567.00");
    expect(formatUsdcExact(417n)).toBe("0.000417");
    expect(formatUsdcShort(2_009_999n)).toBe("2.00");
  });
});

describe("ids", () => {
  it("are 22-char base62 and distinct", () => {
    const ids = new Set(Array.from({ length: 2000 }, newId));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(isId(id)).toBe(true);
  });
});

describe("cleanText", () => {
  it("strips control and bidi characters", () => {
    expect(cleanText(" Din\u0000ner‮ at\nToit ")).toBe("Din ner at Toit");
  });
});
