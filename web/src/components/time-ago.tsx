"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/time";

/** Relative time that re-renders each minute; server and client may disagree by a tick, so hydration is lenient. */
export function TimeAgo({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} title={new Date(iso).toUTCString()} suppressHydrationWarning>
      {relativeTime(iso, now)}
    </time>
  );
}
