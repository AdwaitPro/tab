import { encodePacked, getAddress, keccak256, stringToBytes, type Address } from "viem";
import { z } from "zod";
import { SUFFIX_MAX } from "./constants";

/** Offline request link payload, per shared/api-contract.md "Offline links". */
export interface OfflinePayload {
  v: 1;
  r: Address;
  a: string;
  u: string;
  c: number;
  e: number;
  b: string;
  n: string;
  m: string;
  pl: string;
  rl: string;
  h: string;
}

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);

const payloadSchema = z
  .object({
    v: z.literal(1),
    r: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    a: atomic,
    u: atomic,
    c: z.number().int().nonnegative(),
    e: z.number().int().nonnegative(),
    b: atomic,
    n: z.string().regex(/^[0-9a-f]{16}$/),
    m: z.string().max(140),
    pl: z.string().max(40),
    rl: z.string().max(40),
    h: z.string().regex(/^[0-9a-f]{12}$/),
  })
  .strict();

export const PAYLOAD_PREFIX = "p.";
const MAX_PAYLOAD_CHARS = 2048;

export function payloadSuffix(r: Address, a: bigint, c: number, n: string): bigint {
  const digest = keccak256(
    encodePacked(["address", "uint256", "uint64", "bytes8"], [r, a, BigInt(c), `0x${n}`]),
  );
  return (BigInt(digest) % BigInt(SUFFIX_MAX)) + 1n;
}

export function payloadChecksum(p: Omit<OfflinePayload, "h">): string {
  const json = JSON.stringify([p.v, p.r, p.a, p.u, p.c, p.e, p.b, p.n, p.m, p.pl, p.rl]);
  return keccak256(stringToBytes(json)).slice(2, 14);
}

export type DecodeResult = { ok: true; payload: OfflinePayload } | { ok: false; reason: string };

/** Decode and integrity-check a `p.<base64url>` id. Integrity only: anyone can mint a valid payload. */
export function decodePayloadId(id: string): DecodeResult {
  if (!id.startsWith(PAYLOAD_PREFIX)) return { ok: false, reason: "not a payload id" };
  const encoded = id.slice(PAYLOAD_PREFIX.length);
  if (encoded.length === 0 || encoded.length > MAX_PAYLOAD_CHARS || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return { ok: false, reason: "malformed base64url" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid payload shape" };
  const p = parsed.data;

  let checksummed: Address;
  try {
    checksummed = getAddress(p.r);
  } catch {
    return { ok: false, reason: "invalid recipient" };
  }
  if (checksummed !== p.r) return { ok: false, reason: "recipient not checksummed" };

  const payload: OfflinePayload = { ...p, v: 1, r: checksummed };
  if (payloadChecksum(payload) !== p.h) return { ok: false, reason: "checksum mismatch" };

  const base = BigInt(p.a);
  if (base <= 0n) return { ok: false, reason: "amount must be positive" };
  if (BigInt(p.u) !== base + payloadSuffix(checksummed, base, p.c, p.n)) {
    return { ok: false, reason: "suffix mismatch" };
  }
  if (p.e <= p.c) return { ok: false, reason: "expiry before creation" };
  return { ok: true, payload };
}

/** Encoder mirrors the plugin's; used by tests and local tooling. */
export function encodePayloadId(input: Omit<OfflinePayload, "h" | "u" | "v">): string {
  const base = BigInt(input.a);
  const u = (base + payloadSuffix(input.r, base, input.c, input.n)).toString();
  const body = { v: 1 as const, ...input, u };
  const ordered: OfflinePayload = {
    v: 1,
    r: body.r,
    a: body.a,
    u: body.u,
    c: body.c,
    e: body.e,
    b: body.b,
    n: body.n,
    m: body.m,
    pl: body.pl,
    rl: body.rl,
    h: payloadChecksum(body),
  };
  return PAYLOAD_PREFIX + Buffer.from(JSON.stringify(ordered), "utf8").toString("base64url");
}
