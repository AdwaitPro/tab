import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/*
 * Tab's own illustration set: flat, chunky objects with a single soft highlight and a darker
 * side face for a toy-like 3D read. Gradient ids are fixed per object; repeated instances
 * share identical defs, which browsers resolve to the same paint.
 */

interface ArtProps {
  className?: string;
  style?: CSSProperties;
  float?: boolean;
  delay?: number;
  rotate?: number;
}

function floatStyle({ float, delay = 0, rotate = 0, style }: ArtProps): CSSProperties {
  return {
    ...style,
    ...(float ? { ["--float-delay" as string]: `${delay}s`, ["--float-rotate" as string]: `${rotate}deg` } : {}),
    ...(rotate && !float ? { transform: `rotate(${rotate}deg)` } : {}),
  };
}

export function Coin(props: ArtProps) {
  return (
    <svg viewBox="0 0 120 120" className={cn(props.float && "float", props.className)} style={floatStyle(props)} aria-hidden="true">
      <defs>
        <linearGradient id="art-coin-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7cc3ff" />
          <stop offset="1" stopColor="#1a88f8" />
        </linearGradient>
      </defs>
      <ellipse cx="62" cy="64" rx="50" ry="50" fill="#0b5fba" />
      <circle cx="58" cy="58" r="50" fill="url(#art-coin-face)" />
      <circle cx="58" cy="58" r="37" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="5" />
      <path
        d="M58 33v50M69 44c-2-5-6.5-7-11-7-6.5 0-11 3.5-11 8.5 0 12 23 6.5 23 19 0 5-5 9-12 9-5.5 0-10-2.5-12-7.5"
        fill="none"
        stroke="#fff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M22 40a40 40 0 0 1 24-26" stroke="#fff" strokeOpacity="0.55" strokeWidth="6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Ticket(props: ArtProps) {
  return (
    <svg viewBox="0 0 140 110" className={cn(props.float && "float", props.className)} style={floatStyle(props)} aria-hidden="true">
      <path d="M14 18h112a8 8 0 0 1 8 8v16a12 12 0 0 0 0 24v16a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V66a12 12 0 0 0 0-24V26a8 8 0 0 1 8-8z" fill="#e2a52c" transform="translate(4 6)" />
      <path d="M14 18h112a8 8 0 0 1 8 8v16a12 12 0 0 0 0 24v16a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V66a12 12 0 0 0 0-24V26a8 8 0 0 1 8-8z" fill="#febe44" />
      <path d="M96 22v68" stroke="#fff" strokeOpacity="0.7" strokeWidth="4" strokeDasharray="2 8" strokeLinecap="round" />
      <rect x="22" y="38" width="56" height="9" rx="4.5" fill="#fff" fillOpacity="0.85" />
      <rect x="22" y="56" width="36" height="9" rx="4.5" fill="#fff" fillOpacity="0.6" />
      <path d="M106 50l6 6 10-12" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 24h50" stroke="#fff" strokeOpacity="0.45" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Lock(props: ArtProps) {
  return (
    <svg viewBox="0 0 120 130" className={cn(props.float && "float", props.className)} style={floatStyle(props)} aria-hidden="true">
      <path d="M34 56V40a26 26 0 0 1 52 0v16" fill="none" stroke="#c9ced6" strokeWidth="13" strokeLinecap="round" />
      <path d="M34 56V40a26 26 0 0 1 52 0v16" fill="none" stroke="#e8ebef" strokeWidth="7" strokeLinecap="round" />
      <rect x="18" y="56" width="90" height="66" rx="20" fill="#2cc078" transform="translate(4 4)" opacity="0.9" />
      <rect x="18" y="56" width="90" height="66" rx="20" fill="#4ad08f" />
      <path d="M28 66h52" stroke="#fff" strokeOpacity="0.5" strokeWidth="6" strokeLinecap="round" />
      <circle cx="63" cy="88" r="9" fill="#14663e" />
      <rect x="59.5" y="90" width="7" height="16" rx="3.5" fill="#14663e" />
    </svg>
  );
}

export function Dice(props: ArtProps) {
  return (
    <svg viewBox="0 0 120 120" className={cn(props.float && "float", props.className)} style={floatStyle(props)} aria-hidden="true">
      <rect x="18" y="18" width="86" height="86" rx="24" fill="#d8431f" transform="translate(5 6)" />
      <rect x="18" y="18" width="86" height="86" rx="24" fill="#ff5a2c" />
      <path d="M30 32c6-8 16-10 30-10" stroke="#fff" strokeOpacity="0.5" strokeWidth="6" strokeLinecap="round" fill="none" />
      {[
        [42, 42],
        [80, 42],
        [61, 61],
        [42, 80],
        [80, 80],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="7.5" fill="#fff" />
      ))}
    </svg>
  );
}

export function Sparkle({ className, style, color = "var(--sun)" }: { className?: string; style?: CSSProperties; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <path d="M12 1c1 5.5 3.5 8.5 11 11-7.5 2.5-10 5.5-11 11-1-5.5-3.5-8.5-11-11 7.5-2.5 10-5.5 11-11z" fill={color} />
    </svg>
  );
}

export function Handshake(props: ArtProps) {
  return (
    <svg viewBox="0 0 140 100" className={cn(props.float && "float", props.className)} style={floatStyle(props)} aria-hidden="true">
      <path d="M8 40l28-18 26 12-20 34z" fill="#1a88f8" />
      <path d="M132 40l-28-18-26 12 20 34z" fill="#febe44" />
      <path
        d="M44 44c10-10 20-14 30-10l22 14c5 3 3 10-3 9l-16-6 18 14c4 3 1 9-4 7L74 62l12 12c3 4-2 8-6 5L66 68l6 10c2 4-3 7-6 4L46 60z"
        fill="#ffd9a8"
        stroke="#e7a65c"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
