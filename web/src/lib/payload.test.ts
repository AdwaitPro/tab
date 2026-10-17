import { describe, expect, it } from "vitest";
import { RECIPIENT } from "@/test/fixtures";
import { decodePayloadId, encodePayloadId, payloadSuffix } from "./payload";

const input = {
  r: RECIPIENT,
  a: "2000000",
  c: 1792260000,
  e: 1792864800,
  b: "52737334",
  n: "9f3a0c1d2b4e5f60",
  m: "Dinner at Toit",
  pl: "Meera",
  rl: "Adwait",
};

function reencode(mutate: (o: Record<string, unknown>) => void): string {
  const id = encodePayloadId(input);
  const obj = JSON.parse(Buffer.from(id.slice(2), "base64url").toString("utf8")) as Record<string, unknown>;
  mutate(obj);
  return "p." + Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("offline payload", () => {
  it("round-trips and derives the suffix in [1, 9999]", () => {
    const decoded = decodePayloadId(encodePayloadId(input));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const s = BigInt(decoded.payload.u) - BigInt(decoded.payload.a);
    expect(s).toBe(payloadSuffix(RECIPIENT, 2_000_000n, input.c, input.n));
    expect(s >= 1n && s <= 9999n).toBe(true);
    expect(decoded.payload.m).toBe("Dinner at Toit");
  });

  it("rejects tampering", () => {
    expect(decodePayloadId(reencode((o) => (o.u = "2000001"))).ok).toBe(false);
    expect(decodePayloadId(reencode((o) => (o.m = "Rent"))).ok).toBe(false);
    expect(decodePayloadId(reencode((o) => (o.r = RECIPIENT.toLowerCase()))).ok).toBe(false);
    expect(decodePayloadId(reencode((o) => (o.extra = 1))).ok).toBe(false);
    expect(decodePayloadId(reencode((o) => delete o.n)).ok).toBe(false);
  });

  it("rejects garbage", () => {
    for (const bad of ["p.", "p.!!!", "p." + Buffer.from("not json").toString("base64url"), "abc"]) {
      expect(decodePayloadId(bad).ok).toBe(false);
    }
  });
});
