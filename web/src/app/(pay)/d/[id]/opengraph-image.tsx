import { formatUsdc } from "@/lib/amount";
import { lookupDeal } from "@/lib/server/escrow-pages";
import { clamp, ogCard, OG_SIZE, UsdcHeadline } from "@/lib/server/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Tab escrowed deal";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const result = await lookupDeal((await params).id);
  if (result.kind !== "ok") return ogCard({ eyebrow: "Tab", headline: "Escrowed deal", pill: { text: "Unavailable", tone: "muted" } });
  const d = result.value;
  const done = d.state === "Released" || d.state === "Resolved";
  return ogCard({
    eyebrow: `Escrowed deal #${d.id}`,
    headline: <UsdcHeadline amount={formatUsdc(BigInt(d.amount_atomic))} />,
    sub: clamp(d.terms, 60) || "Locked until delivery",
    pill: { text: done ? "Released ✓" : d.state, tone: done ? "paid" : d.state === "Funded" ? "accent" : "pending" },
    footer: "Funds locked in an ownerless contract on Base",
  });
}
