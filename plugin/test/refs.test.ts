import { describe, expect, it } from "vitest";

import { checksum } from "../src/lib/address.js";
import { parseRef } from "../src/lib/refs.js";
import { sanitizeText } from "../src/lib/sanitize.js";
import { parseIsoSeconds } from "../src/lib/time.js";

describe("parseRef", () => {
  it.each([
    ["https://tab-pay.vercel.app/r/4fGh8Kq2LmN0pQrS7tUvWx", { kind: "request", id: "4fGh8Kq2LmN0pQrS7tUvWx" }],
    ["tab.link/r/4fGh8Kq2LmN0pQrS7tUvWx?utm=x", { kind: "request", id: "4fGh8Kq2LmN0pQrS7tUvWx" }],
    ["https://x.app/s/9aBcDeFgHiJkLmNoPqRsTu", { kind: "split", id: "9aBcDeFgHiJkLmNoPqRsTu" }],
    ["split:9aBcDeFgHiJkLmNoPqRsTu", { kind: "split", id: "9aBcDeFgHiJkLmNoPqRsTu" }],
    ["4fGh8Kq2LmN0pQrS7tUvWx", { kind: "request_or_split", id: "4fGh8Kq2LmN0pQrS7tUvWx" }],
    ["deal:12", { kind: "deal", id: 12n }],
    ["https://x.app/d/12", { kind: "deal", id: 12n }],
    ["bet:3", { kind: "bet", id: 3n }],
    ["/b/3/", { kind: "bet", id: 3n }],
  ])("%s", (input, expected) => {
    expect(parseRef(input)).toEqual(expected);
  });

  it.each(["", "hello", "deal:0", "deal:-1", "bet:abc", "https://x.app/s/short", "/r/short"])("rejects %j", (input) => {
    expect(() => parseRef(input)).toThrow();
  });
});

describe("sanitizeText", () => {
  it("strips control, bidi and zero-width characters and collapses whitespace", () => {
    expect(sanitizeText("Din\u0000ner‮ at​  Toit\n\n", 140)).toBe("Din ner at Toit");
  });
  it("bounds length by code points and returns undefined for empty", () => {
    expect(sanitizeText("☕".repeat(200), 140)).toHaveLength(140);
    expect(sanitizeText("   \u0007  ", 140)).toBeUndefined();
    expect(sanitizeText(undefined, 10)).toBeUndefined();
  });
});

describe("checksum", () => {
  it("normalizes lowercase and validates mixed case", () => {
    expect(checksum("0xbeff1786a7ad59a8d62d46ee8d31dfb9a7a73d2e", "a")).toBe("0xbEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E");
    expect(() => checksum("0xBEfF1786A7aD59a8D62d46eE8d31dfb9A7a73d2E", "a")).toThrow(/checksum/);
    expect(() => checksum("0x123", "a")).toThrow(/40-hex/);
  });
});

describe("parseIsoSeconds", () => {
  it("requires an explicit zone", () => {
    expect(parseIsoSeconds("2026-10-18T21:00:00+05:30", "t")).toBe(Date.parse("2026-10-18T15:30:00Z") / 1000);
    expect(() => parseIsoSeconds("2026-10-18T21:00:00", "t")).toThrow(/timezone/);
    expect(() => parseIsoSeconds("tomorrow", "t")).toThrow();
  });
});
