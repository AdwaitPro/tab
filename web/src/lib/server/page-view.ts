import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";

export const pageViewBody = z
  .object({
    path: z.string().min(1).max(300).startsWith("/"),
    referrer: z.string().max(500).optional(),
    utm_source: z.string().max(80).optional(),
  })
  .strict();

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|vercel-screenshot|headless|lighthouse/i;

export function isBot(ua: string): boolean {
  return ua === "" || BOT_UA.test(ua);
}

export function deviceOf(ua: string): "mobile" | "tablet" | "desktop" {
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

export function browserOf(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\//i.test(ua)) return "Opera";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "Other";
}

/** Host only, never the full URL: a referring page path can contain private tokens. */
export function referrerHost(referrer: string | undefined, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    return host === ownHost ? null : host.slice(0, 120);
  } catch {
    return null;
  }
}

/** Vercel URL-encodes geo headers (e.g. "S%C3%A3o%20Paulo"). */
export function geoHeader(headers: Headers, name: string): string | null {
  const raw = headers.get(name);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

export function dailyVisitorHash(ip: string, ua: string, salt: string, day: string): string {
  return createHash("sha256").update(`${salt}|${day}|${ip}|${ua}`).digest("hex").slice(0, 24);
}
