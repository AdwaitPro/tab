import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { LABEL_MAX, MAX_AMOUNT_ATOMIC, MAX_SPLIT_MEMBERS, MEMO_MAX } from "../constants";
import { ID_RE } from "../ids";
import { cleanText } from "../text";

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte hex address")
  .refine((v) => isAddress(v, { strict: false }), "invalid address")
  .transform((v) => getAddress(v));

const atomicString = z.string().regex(/^(0|[1-9][0-9]*)$/, "must be a decimal integer string").max(30);

export const positiveAtomic = atomicString
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, "must be > 0")
  .refine((v) => v <= MAX_AMOUNT_ATOMIC, `must be ≤ ${MAX_AMOUNT_ATOMIC.toString()} (1,000 USDC cap)`);

export const blockString = atomicString.transform((v) => BigInt(v));

const isoUtc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, "must be ISO-8601 UTC with Z")
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "invalid date");

const futureIso = isoUtc
  .refine((d) => d.getTime() > Date.now(), "must be in the future")
  .refine((d) => d.getTime() <= Date.now() + 366 * 24 * 3600 * 1000, "must be within a year");

/** Optional user text: trimmed, control chars stripped, empty → null. Length is checked after cleaning. */
function userText(max: number) {
  return z
    .string()
    .max(max * 4)
    .nullish()
    .transform((v) => (v == null ? null : cleanText(v) || null))
    .refine((v) => v == null || [...v].length <= max, `must be ≤ ${max} characters`);
}

function requiredLabel(max: number) {
  return z
    .string()
    .max(max * 4)
    .transform((v) => cleanText(v))
    .refine((v) => v.length > 0, "is required")
    .refine((v) => [...v].length <= max, `must be ≤ ${max} characters`);
}

export const createRequestBody = z
  .object({
    recipient: addressSchema,
    amount_atomic: positiveAtomic,
    memo: userText(MEMO_MAX),
    payer_label: userText(LABEL_MAX),
    requester_label: userText(LABEL_MAX),
    expires_at: futureIso,
    start_block: blockString,
  })
  .strict();

export const createSplitBody = z
  .object({
    recipient: addressSchema,
    total_atomic: positiveAtomic,
    memo: userText(MEMO_MAX),
    requester_label: userText(LABEL_MAX),
    expires_at: futureIso,
    start_block: blockString,
    requests: z
      .array(
        z
          .object({
            payer_label: requiredLabel(LABEL_MAX),
            amount_atomic: positiveAtomic,
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SPLIT_MEMBERS),
  })
  .strict()
  .refine((b) => b.requests.reduce((acc, r) => acc + r.amount_atomic, 0n) <= b.total_atomic, {
    message: "sum of request amounts exceeds total_atomic",
    path: ["requests"],
  });

export const createTermsBody = z
  .object({
    hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex hash").transform((v) => v.toLowerCase()),
    body: z.string().min(1).max(1000),
  })
  .strict();

export const signatureBody = z
  .object({
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/, "must be hex")
      .min(132)
      .max(20_000),
  })
  .strict();

export const requestIdParam = z.string().regex(ID_RE);
export const payloadOrIdParam = z.string().min(1).max(2100);
export const escrowIdParam = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .transform((v) => BigInt(v));
export const tabsQuery = z.enum(["open", "all"]).default("open");

export const payerBody = z.object({ payer_address: addressSchema }).strict();
