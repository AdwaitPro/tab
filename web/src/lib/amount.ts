import { USDC_DECIMALS } from "./constants";

const DECIMAL_RE = /^\d{1,9}(\.\d{1,6})?$/;
const ATOMIC_RE = /^\d{1,30}$/;
const SCALE = 10n ** BigInt(USDC_DECIMALS);

/** Parse a human decimal ("2.5") into USDC atomic units. Throws on anything but an exact decimal. */
export function parseUsdc(value: string): bigint {
  if (!DECIMAL_RE.test(value)) throw new Error(`Invalid USDC amount: ${value}`);
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

export function isAtomicString(value: string): boolean {
  return ATOMIC_RE.test(value);
}

/** Exact decimal string with all six decimals, e.g. 2000417n → "2.000417". */
export function formatUsdcExact(atomic: bigint): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/**
 * Display string with at least two decimals and no trailing zeros beyond that,
 * e.g. 2000000n → "2.00", 2000417n → "2.000417", 2500000n → "2.50".
 */
export function formatUsdc(atomic: bigint): string {
  const exact = formatUsdcExact(atomic);
  const [whole, frac] = exact.split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${groupThousands(whole)}.${trimmed}`;
}

/** Two-decimal display rounded down, for headline numbers where the matching code is shown separately. */
export function formatUsdcShort(atomic: bigint): string {
  const exact = formatUsdcExact(atomic);
  const [whole, frac] = exact.split(".");
  return `${groupThousands(whole)}.${frac.slice(0, 2)}`;
}

function groupThousands(whole: string): string {
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}
