import { describe, expect, it } from "vitest";

import { buildPayload, decodePayload, encodePayload, uniqueSuffix } from "../src/lib/payload.js";
import { ME } from "./helpers.js";

const base = { recipient: ME, amount: 2_000_000n, createdAt: 1_792_260_000, expiresAt: 1_792_864_800, startBlock: 52_737_334n, nonce: "9f3a0c1d2b4e5f60", memo: "Dinner at Toit", payerLabel: "Meera", requesterLabel: "Adwait" };

function tamper(id: string, edit: (p: Record<string, unknown>) => void): string {
  const obj = JSON.parse(Buffer.from(id.slice(2), "base64url").toString("utf8")) as Record<string, unknown>;
  edit(obj);
  return `p.${Buffer.from(JSON.stringify(obj)).toString("base64url")}`;
}

describe("offline payload", () => {
  it("round-trips", () => {
    const payload = buildPayload(base);
    const id = encodePayload(payload);
    expect(id.startsWith("p.")).toBe(true);
    expect(id).not.toMatch(/[+/=]/);
    expect(decodePayload(id)).toEqual(payload);
  });

  it("suffix is in [1, 9999] and u = a + suffix", () => {
    for (let i = 0; i < 300; i += 1) {
      const nonce = i.toString(16).padStart(16, "0");
      const s = uniqueSuffix(ME, 2_000_000n, 1_792_260_000 + i, nonce);
      expect(s >= 1n && s <= 9999n).toBe(true);
      const p = buildPayload({ ...base, nonce, createdAt: 1_792_260_000 + i });
      expect(BigInt(p.u) - BigInt(p.a)).toBe(s);
    }
  });

  it("handles unicode memos", () => {
    const id = encodePayload(buildPayload({ ...base, memo: "Chai ☕ & समोसा" }));
    expect(decodePayload(id).m).toBe("Chai ☕ & समोसा");
  });

  it.each([
    ["recipient swapped", (p: Record<string, unknown>) => { p.r = "0x1111111111111111111111111111111111111111"; }],
    ["amount changed", (p: Record<string, unknown>) => { p.a = "3000000"; }],
    ["unique changed", (p: Record<string, unknown>) => { p.u = "2000001"; }],
    ["memo changed", (p: Record<string, unknown>) => { p.m = "Pay me instead"; }],
    ["expiry extended", (p: Record<string, unknown>) => { p.e = 1_999_999_999; }],
    ["extra field", (p: Record<string, unknown>) => { p.x = 1; }],
    ["missing field", (p: Record<string, unknown>) => { delete p.n; }],
  ])("detects tampering: %s", (_name, edit) => {
    expect(() => decodePayload(tamper(encodePayload(buildPayload(base)), edit))).toThrow(/modified|corrupted/);
  });

  it("detects a recomputed checksum with an inconsistent suffix", () => {
    // Attacker changes amount and recomputes h but cannot keep u = a + suffix without changing u too.
    const p = buildPayload(base);
    const forged = buildPayload({ ...base, amount: 5_000_000n });
    const mixed = { ...forged, u: p.u };
    expect(() => decodePayload(encodePayload(mixed))).toThrow(/modified/);
  });

  it("rejects garbage", () => {
    expect(() => decodePayload("p.!!!")).toThrow();
    expect(() => decodePayload("p.bm90IGpzb24")).toThrow(/bad JSON/);
    expect(() => decodePayload("x.abc")).toThrow();
  });
});
