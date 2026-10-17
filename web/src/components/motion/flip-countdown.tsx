import { countdown } from "@/lib/time";

/** Countdown whose changed characters flip in, like a split-flap board. */
export function FlipCountdown({ ms }: { ms: number }) {
  const text = countdown(ms);
  return (
    <span className="tabular inline-flex font-mono font-semibold" aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={`${i}-${ch}`} className="flip-digit" aria-hidden="true">
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
