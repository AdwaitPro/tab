import { ToolError } from "./errors.js";

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Parses an ISO-8601 timestamp that must carry an explicit zone (no ambiguous local times). Returns unix seconds. */
export function parseIsoSeconds(value: string, field: string): number {
  if (!ISO_WITH_ZONE.test(value)) {
    throw new ToolError(`${field} must be ISO-8601 with a timezone, e.g. "2026-10-20T18:00:00Z" or "2026-10-20T23:30:00+05:30".`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new ToolError(`${field} is not a valid date.`);
  return Math.floor(ms / 1000);
}

export function isoSeconds(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "Sun 18 Oct 2026, 21:00 IST": the demo audience is in India; UTC is always shown alongside. */
export function formatIst(unixSeconds: number | bigint): string {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(Number(unixSeconds) * 1000));
  return `${text} IST`;
}

export function formatUtc(unixSeconds: number | bigint): string {
  return `${isoSeconds(unixSeconds).replace("T", " ").replace("Z", "")} UTC`;
}

export function formatWhen(unixSeconds: number | bigint): string {
  return `${formatUtc(unixSeconds)} (${formatIst(unixSeconds)})`;
}

/** "in 42 min", "in 3 h 5 min", "2 d ago". */
export function relative(unixSeconds: number, nowSeconds: number): string {
  const diff = unixSeconds - nowSeconds;
  const abs = Math.abs(diff);
  const parts = abs >= 86_400 ? `${Math.floor(abs / 86_400)} d ${Math.floor((abs % 86_400) / 3600)} h`
    : abs >= 3600 ? `${Math.floor(abs / 3600)} h ${Math.floor((abs % 3600) / 60)} min`
      : `${Math.max(1, Math.ceil(abs / 60))} min`;
  return diff >= 0 ? `in ${parts}` : `${parts} ago`;
}
