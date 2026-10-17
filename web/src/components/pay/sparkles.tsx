import { Sparkle } from "@/components/illustrations";

const BURST = [
  { dx: "-120px", dy: "-70px", c: "var(--sun)", s: 18, d: 0 },
  { dx: "110px", dy: "-80px", c: "var(--brand)", s: 14, d: 60 },
  { dx: "-90px", dy: "40px", c: "var(--success-bright)", s: 12, d: 120 },
  { dx: "130px", dy: "30px", c: "var(--sun)", s: 16, d: 90 },
  { dx: "-30px", dy: "-110px", c: "var(--brand-light)", s: 12, d: 150 },
  { dx: "40px", dy: "-120px", c: "var(--sun)", s: 10, d: 30 },
  { dx: "-150px", dy: "-10px", c: "var(--brand)", s: 10, d: 180 },
  { dx: "160px", dy: "-20px", c: "var(--success-bright)", s: 12, d: 210 },
];

/** One-shot sparkle burst for success moments; hidden under reduced motion. */
export function SparkleBurst() {
  return (
    <span className="pointer-events-none absolute top-1/2 left-1/2" aria-hidden="true">
      {BURST.map((b, i) => (
        <Sparkle
          key={i}
          color={b.c}
          className="sparkle absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            width: b.s,
            height: b.s,
            ["--dx" as string]: b.dx,
            ["--dy" as string]: b.dy,
            animationDelay: `${b.d + 250}ms`,
          }}
        />
      ))}
    </span>
  );
}
