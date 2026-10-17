import { cn } from "@/lib/cn";

/** Circle that fills, then a check draws itself. */
export function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-16", className)} aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="var(--success-bright)" className="animate-rise" />
      <path
        d="M19 33.5l8.5 8.5L45.5 23"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="44"
        strokeDashoffset="44"
        style={{ animation: "draw 420ms var(--ease-out) 220ms forwards" }}
      />
    </svg>
  );
}
