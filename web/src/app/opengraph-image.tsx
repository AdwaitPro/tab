import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Tab: settle up in one sentence";

export default async function Image() {
  const [black, medium] = await Promise.all([
    readFile(path.join(process.cwd(), "assets/fonts/Satoshi-900.ttf")),
    readFile(path.join(process.cwd(), "assets/fonts/Satoshi-500.ttf")),
  ]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", background: "#fbfaf9", color: "#222222", fontFamily: "Satoshi" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: "linear-gradient(135deg, #4DAFFF, #0E74E0)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 40, fontWeight: 900 }}>T</div>
          <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.03em" }}>Tab</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 108, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 0.95 }}>Settle up in</div>
          <div style={{ fontSize: 108, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 1.05, color: "#0E74E0" }}>one sentence</div>
          <div style={{ marginTop: 28, fontSize: 34, fontWeight: 500, color: "#64625F" }}>Split bills, escrow deals and bet friends in USDC on Base</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, fontWeight: 500, color: "#757371" }}>A PayBox plugin · tab-pay.vercel.app</div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Satoshi", data: black, weight: 900, style: "normal" },
        { name: "Satoshi", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
