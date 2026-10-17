import { create } from "qrcode";

/**
 * Custom-rendered QR: dotted data modules, rounded finder eyes, Tab mark in a quiet zone at
 * the center. Error correction H tolerates the center knockout.
 */
export function TabQr({ value, size = 240, label }: { value: string; size?: number; label: string }) {
  const qr = create(value, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const cell = 10;
  const dim = n * cell;
  const finder = 7;
  const logo = Math.ceil(n * 0.22) | 1;
  const logoStart = Math.floor((n - logo) / 2);

  const inFinder = (x: number, y: number) =>
    (x < finder && y < finder) || (x >= n - finder && y < finder) || (x < finder && y >= n - finder);
  const inLogo = (x: number, y: number) =>
    x >= logoStart - 1 && x <= logoStart + logo && y >= logoStart - 1 && y <= logoStart + logo;

  const dots: Array<[number, number]> = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(x, y) && !inFinder(x, y) && !inLogo(x, y)) dots.push([x, y]);
    }
  }
  const eyes: Array<[number, number]> = [
    [0, 0],
    [n - finder, 0],
    [0, n - finder],
  ];
  const lc = (logoStart + logo / 2) * cell;
  const ls = logo * cell * 0.86;

  return (
    <svg
      viewBox={`-20 -20 ${dim + 40} ${dim + 40}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className="rounded-[22px] bg-white"
    >
      <rect x="-20" y="-20" width={dim + 40} height={dim + 40} rx="36" fill="#fff" />
      <g fill="#222">
        {dots.map(([x, y]) => (
          <circle key={`${x}.${y}`} cx={x * cell + cell / 2} cy={y * cell + cell / 2} r={cell * 0.42} />
        ))}
      </g>
      {eyes.map(([x, y]) => (
        <g key={`${x}.${y}`} transform={`translate(${x * cell} ${y * cell})`}>
          <rect x={cell * 0.5} y={cell * 0.5} width={cell * 6} height={cell * 6} rx={cell * 2} fill="none" stroke="#222" strokeWidth={cell} />
          <rect x={cell * 2} y={cell * 2} width={cell * 3} height={cell * 3} rx={cell} fill="#0e74e0" />
        </g>
      ))}
      <g transform={`translate(${lc - ls / 2} ${lc - ls / 2})`}>
        <rect width={ls} height={ls} rx={ls * 0.3} fill="#0e74e0" />
        <rect width={ls} height={ls / 2} rx={ls * 0.3} fill="#fff" opacity="0.14" />
        <path
          d={`M${ls * 0.3} ${ls * 0.34}h${ls * 0.4}M${ls * 0.5} ${ls * 0.34}v${ls * 0.4}`}
          stroke="#fff"
          strokeWidth={ls * 0.11}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
