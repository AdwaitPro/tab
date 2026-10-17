"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

const DIGITS = "0123456789";

/**
 * Odometer. Server render and first paint show the plain final value (no layout dependency on CSS),
 * then after mount each digit becomes a clipped 0 to 9 strip that rolls up to its value.
 * Geometry is inline so a missing or stale stylesheet can never spill the strips.
 */
export function Odometer({ value, className, delayMs = 120 }: { value: string; className?: string; delayMs?: number }) {
  const [phase, setPhase] = useState<"static" | "armed" | "rolled">("static");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Mount-time switch to the animated rendering; SSR keeps the static value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("armed");
    // A timer (not rAF) so the roll still completes in background tabs, where rAF is paused.
    const t = setTimeout(() => setPhase("rolled"), 34);
    return () => clearTimeout(t);
  }, [value]);

  if (phase === "static") {
    return <span className={cn("tabular inline-block whitespace-nowrap", className)}>{value}</span>;
  }

  let order = 0;
  return (
    <span className={cn("tabular inline-flex whitespace-nowrap", className)}>
      <span className="sr-only">{value}</span>
      {[...value].map((ch, i) => {
        if (!DIGITS.includes(ch)) {
          return (
            <span key={i} aria-hidden="true">
              {ch}
            </span>
          );
        }
        const n = Number(ch);
        const delay = delayMs + order++ * 70;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{ display: "inline-block", height: "1em", lineHeight: 1, overflow: "hidden", verticalAlign: "top" }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                transform: `translate3d(0, ${phase === "rolled" ? -n : 0}em, 0)`,
                transition: `transform 1100ms cubic-bezier(0.19, 1, 0.22, 1) ${delay}ms`,
              }}
            >
              {DIGITS.split("").map((d) => (
                <span key={d} style={{ height: "1em", lineHeight: 1 }}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
