import { getDb } from "@/lib/db/client";
import { pageViews } from "@/lib/db/schema";
import {
  browserOf,
  dailyVisitorHash,
  deviceOf,
  geoHeader,
  isBot,
  pageViewBody,
  referrerHost,
} from "@/lib/server/page-view";
import { clientIp, limiter, READ_POLICY } from "@/lib/server/rate-limit";

// Analytics must never break a page, so every failure is a silent 204 to the beacon.
export async function POST(request: Request): Promise<Response> {
  const done = new Response(null, { status: 204 });
  const ua = request.headers.get("user-agent") ?? "";
  if (isBot(ua)) return done;
  const ip = clientIp(request.headers);
  if (!limiter.take(READ_POLICY, ip).allowed) return done;

  let parsed;
  try {
    parsed = pageViewBody.safeParse(JSON.parse(await request.text()));
  } catch {
    return done;
  }
  if (!parsed.success) return done;

  const ownHost = new URL(request.url).hostname;
  const salt = process.env.CRON_SECRET ?? "tab";
  const day = new Date().toISOString().slice(0, 10);
  try {
    const db = await getDb();
    await db.insert(pageViews).values({
      path: parsed.data.path.split("?")[0] ?? "/",
      country: geoHeader(request.headers, "x-vercel-ip-country"),
      region: geoHeader(request.headers, "x-vercel-ip-country-region"),
      city: geoHeader(request.headers, "x-vercel-ip-city"),
      referrerHost: referrerHost(parsed.data.referrer, ownHost),
      utmSource: parsed.data.utm_source ?? null,
      device: deviceOf(ua),
      browser: browserOf(ua),
      visitor: dailyVisitorHash(ip, ua, salt, day),
    });
  } catch (error) {
    console.error("page view insert failed", error instanceof Error ? error.name : "unknown");
  }
  return done;
}
