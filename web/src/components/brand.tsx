import Link from "next/link";
import { cn } from "@/lib/cn";

/** Tab mark: a rounded tab/ticket with a notch, drawn in SVG. */
export function TabMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <defs>
        <linearGradient id="tab-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4DAFFF" />
          <stop offset="1" stopColor="#0E74E0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#tab-mark-g)" />
      <path d="M2 13.5a2.5 2.5 0 0 0 0 5" fill="var(--bg)" />
      <path d="M30 13.5a2.5 2.5 0 0 1 0 5" fill="var(--bg)" />
      <path d="M10.5 11h11M16 11v11" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <rect x="2" y="2" width="28" height="14" rx="9" fill="#fff" opacity="0.14" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2 rounded-full pr-2", className)} aria-label="Tab home">
      <TabMark className="transition-transform duration-300 group-hover:-rotate-6" />
      <span className="text-[22px] font-bold tracking-[-0.03em]">Tab</span>
    </Link>
  );
}
