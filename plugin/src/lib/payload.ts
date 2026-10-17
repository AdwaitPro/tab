import { encodePacked, getAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";
import * as z from "zod/v4";

import { LIMITS } from "./constants.js";
import { ToolError } from "./errors.js";

/**
 * Self-contained offline request links (`/r/p.<base64url>`), used when the Tab API is unreachable.
 * Format is specified in shared/api-contract.md. The checksum detects corruption, not forgery: anyone can mint a
 * valid payload, so payload-only requests are always presented as unverified.
 */
export interface RequestPayload {
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

export const PAYLOAD_PREFIX = "p.";

const atomic = z.string().regex(/^[1-9][0-9]{0,30}$/);
const payloadSchema = z.object({
  v: z.literal(1),
  r: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  a: atomic,
  u: atomic,
  c: z.number().int().positive(),
  e: z.number().int().positive(),
  b: z.string().regex(/^(0|[1-9][0-9]{0,19})$/),
  n: z.string().regex(/^[0-9a-f]{16}$/),
  m: z.string().max(LIMITS.memo * 4),
  pl: z.string().max(LIMITS.label * 4),
  rl: z.string().max(LIMITS.label * 4),
  h: z.string().regex(/^[0-9a-f]{12}$/),
}).strict();

export function uniqueSuffix(recipient: Address, amount: bigint, createdAt: number, nonce: string): bigint {
  const hash = keccak256(encodePacked(["address", "uint256", "uint64", "bytes8"], [recipient, amount, BigInt(createdAt), `0x${nonce}` as Hex]));
  return (BigInt(hash) % 9999n) + 1n;
}

function checksum(p: Omit<RequestPayload, "h">): string {
  const canonical = JSON.stringify([p.v, p.r, p.a, p.u, p.c, p.e, p.b, p.n, p.m, p.pl, p.rl]);
  return keccak256(stringToBytes(canonical)).slice(2, 14);
}

export interface PayloadInput {
  recipient: Address;
  amount: bigint;
  createdAt: number;
  expiresAt: number;
  startBlock: bigint;
  nonce: string;
  memo?: string | undefined;
  payerLabel?: string | undefined;
  requesterLabel?: string | undefined;
}

export function buildPayload(input: PayloadInput): RequestPayload {
  const r = getAddress(input.recipient);
  const unique = input.amount + uniqueSuffix(r, input.amount, input.createdAt, input.nonce);
  const body = {
    v: 1 as const,
    r,
    a: input.amount.toString(),
    u: unique.toString(),
    c: input.createdAt,
    e: input.expiresAt,
    b: input.startBlock.toString(),
    n: input.nonce,
    m: input.memo ?? "",
    pl: input.payerLabel ?? "",
    rl: input.requesterLabel ?? "",
  };
  return { ...body, h: checksum(body) };
}

export function encodePayload(payload: RequestPayload): string {
  const ordered = { v: payload.v, r: payload.r, a: payload.a, u: payload.u, c: payload.c, e: payload.e, b: payload.b, n: payload.n,
    m: payload.m, pl: payload.pl, rl: payload.rl, h: payload.h };
  return `${PAYLOAD_PREFIX}${Buffer.from(JSON.stringify(ordered), "utf8").toString("base64url")}`;
}

/** Decodes and verifies an offline payload id (`p.…`). Throws `ToolError` on any tampering or corruption. */
export function decodePayload(id: string): RequestPayload {
  if (!id.startsWith(PAYLOAD_PREFIX) || id.length > 2048) throw new ToolError("Not an offline Tab link.");
  const encoded = id.slice(PAYLOAD_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new ToolError("Offline Tab link is corrupted (bad encoding).");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ToolError("Offline Tab link is corrupted (bad JSON).");
  }
  const result = payloadSchema.safeParse(parsed);
  if (!result.success) throw new ToolError("Offline Tab link is corrupted (unexpected fields).");
  const p = result.data;
  if (getAddress(p.r.toLowerCase()) !== p.r) throw new ToolError("Offline Tab link is corrupted (recipient checksum).");
  const payload: RequestPayload = { ...p, r: p.r as Address };
  const { h, ...rest } = payload;
  if (checksum(rest) !== h) throw new ToolError("Offline Tab link was modified (checksum mismatch). Do not pay it.");
  const expected = BigInt(p.a) + uniqueSuffix(payload.r, BigInt(p.a), p.c, p.n);
  if (expected.toString() !== p.u) throw new ToolError("Offline Tab link was modified (amount mismatch). Do not pay it.");
  if (p.e <= p.c) throw new ToolError("Offline Tab link is corrupted (expiry before creation).");
  return payload;
}
