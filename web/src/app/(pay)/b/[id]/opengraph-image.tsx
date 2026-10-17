import { formatUsdc } from "@/lib/amount";
import { lookupBet } from "@/lib/server/escrow-pages";
import { clamp, ogCard, OG_SIZE } from "@/lib/server/og";
import { shortAddress } from "@/lib/text";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Tab bet";

function price(raw: string, decimals: number): string {
  const v = BigInt(raw);
  const whole = v / 10n ** BigInt(decimals);
  return `$${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const result = await lookupBet((await params).id);
  if (result.kind !== "ok") return ogCard({ eyebrow: "Tab", headline: "Bet", pill: { text: "Unavailable", tone: "muted" } });
  const b = result.value;
  const asset = b.price?.description.split("/")[0]?.trim() ?? "Price";
  const resolve = new Date(b.resolve_at).toUTCString().slice(17, 22);
  const sub =
    b.kind === "Price" && b.threshold && b.feed_decimals !== null
      ? `${asset} ${b.creator_above ? "≥" : "<"} ${price(b.threshold, b.feed_decimals)} at ${resolve} UTC`
      : clamp(b.terms, 60) || "Event bet";
  return ogCard({
    eyebrow: `${shortAddress(b.creator)} vs ${b.opponent ? shortAddress(b.opponent) : "you?"}`,
    headline: (
      <>
        <span>{formatUsdc(BigInt(b.stake_atomic))}</span>
        <span style={{ fontSize: 56, marginLeft: 20, marginBottom: 14, color: "#64625F" }}>USDC each</span>
      </>
    ),
    sub,
    pill: { text: b.state === "Open" ? "Join the bet" : b.state, tone: b.state === "Settled" ? "paid" : b.state === "Open" ? "accent" : "pending" },
    footer: "Settled by Chainlink on Base, nobody holds the pot",
  });
}
