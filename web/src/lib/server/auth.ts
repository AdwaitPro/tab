import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time bearer check. Both sides are hashed first so the comparison
 * length never depends on the secret or on attacker input.
 */
export function isAuthorizedBearer(header: string | null, expectedKey: string | undefined): boolean {
  if (!expectedKey || expectedKey.length < 16) return false;
  if (!header) return false;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  const presented = match?.[1] ?? "";
  const ok = timingSafeEqual(digest(presented), digest(expectedKey));
  return ok && presented.length > 0;
}
