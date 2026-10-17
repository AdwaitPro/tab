"use client";

import { cn } from "@/lib/cn";

/**
 * Live price line vs. the bet threshold. The path morphs between polls via CSS `d` transitions
 * where supported; the latest point pulses on the side that's currently winning.
 */
export function PriceChart({
  points,
  threshold,
  above,
}: {
  points: bigint[];
  threshold: bigint;
  above: boolean;
}) {
  const W = 320;
  const H = 120;
  const pad = 10;
  const values = [...points, threshold];
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min === 0n ? 1n : max - min;
  // 6% headroom so the line never kisses the edges.
  const y = (v: bigint) => pad + (H - pad * 2) * (1 - (Number(((v - min) * 10_000n) / span) / 10_000) * 0.88 - 0.06);
  const x = (i: number) => (points.length <= 1 ? W : (W * i) / (points.length - 1));
  const coords = points.map((p, i) => [x(i), y(p)] as const);
  const d = coords.map(([cx, cy], i) => `${i === 0 ? "M" : "L"}${cx.toFixed(1)} ${cy.toFixed(1)}`).join(" ");
  const area = `${d} L${W} ${H} L0 ${H} Z`;
  const ty = y(threshold);
  const last = coords[coords.length - 1] ?? [W, ty];
  const color = above ? "var(--success-bright)" : "var(--danger)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[120px] w-full overflow-visible" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={ty} y2={ty} stroke="var(--fg)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
      {points.length > 1 && (
        <>
          <path d={area} fill="url(#chart-fill)" className="chart-morph" style={{ d: `path("${area}")` }} />
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            className="chart-line chart-morph"
            style={{ d: `path("${d}")` }}
          />
        </>
      )}
      <circle cx={last[0]} cy={last[1]} r="10" fill={color} className={cn("pulse-dot")} opacity="0.25" />
      <circle cx={last[0]} cy={last[1]} r="4.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
