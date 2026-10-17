import { cn } from "@/lib/cn";

const PALETTE = ["#1a88f8", "#febe44", "#2cc078", "#ff5a2c", "#8b6cff", "#14b8c4"];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

export function Avatar({ label, className }: { label: string; className?: string }) {
  const color = PALETTE[hash(label) % PALETTE.length];
  const initial = [...label.replace(/^0x/i, "")][0]?.toUpperCase() ?? "?";
  return (
    <span
      className={cn("relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[18px] font-bold text-white", className)}
      style={{ background: color, boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.12), inset 0 2px 0 rgba(255,255,255,0.25)" }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
