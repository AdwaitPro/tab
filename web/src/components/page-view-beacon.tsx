"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Sends one page view per route change. Fire-and-forget; never blocks or errors the page. */
export function PageViewBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const utm = new URLSearchParams(window.location.search).get("utm_source") ?? undefined;
      const body = JSON.stringify({ path: pathname, referrer: document.referrer || undefined, utm_source: utm });
      if (!navigator.sendBeacon?.("/api/v", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/v", { method: "POST", body, keepalive: true }).catch(() => undefined);
      }
    } catch {
      // Analytics is best-effort by design.
    }
  }, [pathname]);
  return null;
}
