import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative rounded-[var(--radius-card)] bg-surface shadow-card", className)}
      {...props}
    />
  );
}

export function Divider({ className, dashed = false }: { className?: string; dashed?: boolean }) {
  return (
    <hr
      className={cn("border-0 border-t border-line", dashed && "border-dashed border-line-strong", className)}
      aria-hidden="true"
    />
  );
}
