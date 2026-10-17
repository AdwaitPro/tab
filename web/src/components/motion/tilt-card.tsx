"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useFinePointer } from "./use-fine-pointer";

/**
 * Wallet-pass physics: the card tilts toward the pointer (≤ maxDeg), a specular sheen tracks the
 * cursor, and a brand-tinted glow sits behind. Writes CSS variables only, so React never re-renders
 * on pointer move and the browser composites on the GPU.
 */
export function TiltCard({
  children,
  className,
  maxDeg = 5,
  glow = true,
}: {
  children: ReactNode;
  className?: string;
  maxDeg?: number;
  glow?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const enabled = useFinePointer();

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (!enabled || !ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--rx", `${((0.5 - y) * maxDeg * 2).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${((x - 0.5) * maxDeg * 2).toFixed(2)}deg`);
      el.style.setProperty("--sx", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--sy", `${(y * 100).toFixed(1)}%`);
      el.style.setProperty("--sheen", "1");
    });
  }
  function onLeave() {
    const el = ref.current;
    if (!el) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--sheen", "0");
  }

  return (
    <div className={cn("tilt-scene relative", className)}>
      {glow && <div className="tilt-glow" aria-hidden="true" />}
      <div ref={ref} className="tilt-card" onPointerMove={onMove} onPointerLeave={onLeave}>
        {children}
        <div className="tilt-sheen" aria-hidden="true" />
      </div>
    </div>
  );
}
