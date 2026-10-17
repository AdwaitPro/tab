import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 };

let fontsPromise: Promise<Array<{ name: string; data: Buffer; weight: 500 | 600; style: "normal" }>> | null = null;

function fonts() {
  fontsPromise ??= Promise.all([
    readFile(path.join(process.cwd(), "assets/fonts/Geist-Medium.ttf")),
    readFile(path.join(process.cwd(), "assets/fonts/Geist-SemiBold.ttf")),
    readFile(path.join(process.cwd(), "assets/fonts/GeistMono-Medium.ttf")),
  ]).then(([medium, semibold, mono]) => [
    { name: "Geist", data: medium, weight: 500 as const, style: "normal" as const },
    { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
    { name: "GeistMono", data: mono, weight: 500 as const, style: "normal" as const },
  ]);
  return fontsPromise;
}

export type OgTone = "pending" | "paid" | "muted" | "accent";
const TONES: Record<OgTone, { bg: string; fg: string }> = {
  pending: { bg: "#FFF3D6", fg: "#8A5A00" },
  paid: { bg: "#E3F6EA", fg: "#138A4B" },
  muted: { bg: "#EFEDEA", fg: "#64625F" },
  accent: { bg: "#E6F2FE", fg: "#0A5FBA" },
};

/** Clamp untrusted text for the card; satori renders it as text, never markup. */
export function clamp(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

export async function ogCard(props: {
  eyebrow: string;
  headline: ReactNode;
  sub?: string;
  pill: { text: string; tone: OgTone };
  footer?: string;
}): Promise<ImageResponse> {
  const pill = TONES[props.pill.tone];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #FBFAF9 0%, #F3F1EE 55%, #E6F2FE 100%)",
          fontFamily: "Geist",
          color: "#222222",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                background: "linear-gradient(135deg, #4DAFFF, #0E74E0)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 36,
                fontWeight: 600,
              }}
            >
              T
            </div>
            <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em" }}>Tab</div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "10px 24px",
              borderRadius: 999,
              background: pill.bg,
              color: pill.fg,
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            {props.pill.text}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 34, color: "#64625F", fontWeight: 500 }}>{props.eyebrow}</div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 8, fontSize: 132, fontWeight: 600, letterSpacing: "-0.045em", lineHeight: 1 }}>
            {props.headline}
          </div>
          {props.sub ? <div style={{ marginTop: 20, fontSize: 38, fontWeight: 500, color: "#313131" }}>{props.sub}</div> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#757371" }}>
          <div>{props.footer ?? "Pay from any wallet on Base, or let your agent do it"}</div>
          <div style={{ fontFamily: "GeistMono" }}>USDC · Base</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await fonts(), headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
  );
}

export function UsdcHeadline({ amount }: { amount: string }) {
  return (
    <>
      <span>{amount}</span>
      <span style={{ fontSize: 56, marginLeft: 20, marginBottom: 14, color: "#64625F" }}>USDC</span>
    </>
  );
}
