"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

const DIGITS = "0123456789";

/**
 * Odometer: each digit is a 0 to 9 strip that rolls to its value on mount, staggered left to right.
 * Separators render static. Screen readers get the plain value.
 */
export function Odometer({ value, className, delayMs = 120 }: { value: string; className?: string; delayMs?: number }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(t);
  }, []);
  let digitIndex = 0;
  return (
    <span className={cn("odometer tabular inline-flex", className)}>
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
        const order = digitIndex++;
        return (
          <span key={i} className="odometer-cell" aria-hidden="true">
            <span
              className="odometer-strip"
              style={{
                transform: `translate3d(0, ${armed ? -n * 10 : 0}%, 0)`,
                transitionDelay: `${delayMs + order * 70}ms`,
              }}
            >
              {DIGITS.split("").map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
