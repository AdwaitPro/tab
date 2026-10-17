import * as z from "zod/v4";

import { LIMITS } from "./constants.js";

// Shared zod/v4 input fragments. Bounds here are the first line of defence; handlers re-validate semantics
// (checksums, caps, time ordering) with specific error messages.
export const addressInput = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const usdcInput = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/);
export const memoInput = z.string().max(LIMITS.memo);
export const labelInput = z.string().max(LIMITS.label);
export const isoInput = z.string().min(16).max(40);
export const objectIdInput = z.union([
  z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[1-9][0-9]{0,30}$/),
]);
