import { getAddress, isAddress, type Address } from "viem";

import { ToolError } from "./errors.js";

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/** Checksums an address. Mixed-case input must already be a valid EIP-55 checksum (catches typos). */
export function checksum(value: string, field: string): Address {
  if (!ADDRESS_PATTERN.test(value)) throw new ToolError(`${field} must be a 0x-prefixed 40-hex-character address.`);
  const body = value.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  // viem's getAddress silently re-checksums, so verify mixed-case input explicitly.
  if (mixed && !isAddress(value, { strict: true })) throw new ToolError(`${field} has an invalid EIP-55 checksum; re-copy the address.`);
  return getAddress(value.toLowerCase());
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function nullableAddress(address: Address): Address | null {
  return sameAddress(address, ZERO_ADDRESS) ? null : address;
}
