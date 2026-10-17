"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useFinePointer } from "./use-fine-pointer";

/** Pulls its child up to `strength` px toward the pointer, springing back on leave. */
export function Magnetic({ children, strength = 6, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = useFinePointer();
  function onMove(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!enabled || !el) return;
    const r = el.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const dy = ((e.clientY - r.top) / r.height - 0.5) * 2;
    el.style.transform = `translate3d(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px, 0)`;
  }
  function onLeave() {
    if (ref.current) ref.current.style.transform = "translate3d(0,0,0)";
  }
  return (
    <div ref={ref} className={cn("magnetic", className)} onPointerMove={onMove} onPointerLeave={onLeave}>
      {children}
    </div>
  );
}
