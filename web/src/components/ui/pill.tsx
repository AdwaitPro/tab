import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "success" | "pending" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted ring-line",
  accent: "bg-accent-soft text-accent-ink ring-transparent",
  success: "bg-success-soft text-success ring-transparent",
  pending: "bg-pending-soft text-pending ring-transparent",
  danger: "bg-danger-soft text-danger ring-transparent",
  info: "bg-info-soft text-info ring-transparent",
};

export function Pill({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
