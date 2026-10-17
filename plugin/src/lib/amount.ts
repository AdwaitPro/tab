import { USDC_DECIMALS } from "./constants.js";
import { ToolError } from "./errors.js";

/** Input format for user-facing USDC amounts (PRD §10.1). */
export const DECIMAL_PATTERN = /^\d{1,9}(\.\d{1,6})?$/;

/**
 * Exact decimal → atomic conversion with BigInt; no floating point. Leading zeros are tolerated ("01.5").
 * Throws on malformed input or more fractional digits than `decimals`.
 */
export function atomicFromDecimal(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) throw new ToolError(`"${amount.slice(0, 40)}" is not a decimal number.`);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new ToolError(`"${amount}" has more than ${decimals} decimal places.`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Parses a user USDC amount, enforcing > 0 and the configured cap. */
export function parseUsdc(amount: string, maxAtomic: bigint, field = "amount"): bigint {
  if (!DECIMAL_PATTERN.test(amount)) {
    throw new ToolError(`${field} must be a decimal string like "2.50" (max 6 decimals).`);
  }
  const atomic = atomicFromDecimal(amount, USDC_DECIMALS);
  if (atomic <= 0n) throw new ToolError(`${field} must be greater than 0.`);
  if (atomic > maxAtomic) {
    throw new ToolError(`${field} ${formatUsdc(atomic)} USDC exceeds the safety cap of ${formatUsdc(maxAtomic)} USDC.`, "Use a smaller amount.");
  }
  return atomic;
}

/** Exact atomic → decimal string, trimming trailing zeros but keeping at least `minDecimals`. */
export function formatUnitsExact(atomic: bigint, decimals: number, minDecimals = 0): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = decimals > 0 ? (abs % base).toString().padStart(decimals, "0") : "";
  fraction = fraction.replace(/0+$/, "");
  if (fraction.length < minDecimals) fraction = fraction.padEnd(minDecimals, "0");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

/** "2.000417", "2.00", "0.50": every USDC digit that matters, at least two decimals. */
export function formatUsdc(atomic: bigint): string {
  return formatUnitsExact(atomic, USDC_DECIMALS, 2);
}

/** Rounded-down cents display ("2.00" for 2.000417) for share text; never used where exactness matters. */
export function formatUsdcCents(atomic: bigint): string {
  const cents = atomic / 10_000n;
  return formatUnitsExact(cents, 2, 2);
}
