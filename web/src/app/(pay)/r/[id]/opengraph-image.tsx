import { connection } from "next/server";
import { formatUsdc } from "@/lib/amount";
import { getDb } from "@/lib/db/client";
import { clamp, ogCard, OG_SIZE, UsdcHeadline } from "@/lib/server/og";
import { resolveRequest } from "@/lib/server/resolve";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Tab payment request";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = decodeURIComponent((await params).id);
  const resolved = await resolveRequest(id.startsWith("p.") ? null : await getDb().catch(() => null), id).catch(() => null);
  if (!resolved) {
    return ogCard({ eyebrow: "Tab", headline: "Payment request", pill: { text: "Not found", tone: "muted" } });
  }
  const r = resolved.record;
  const paid = r.status === "paid" || r.status === "paid_late";
  return ogCard({
    eyebrow: `${clamp(r.requester_label, 30) || "Someone"} requested`,
    headline: <UsdcHeadline amount={formatUsdc(BigInt(r.amount_atomic))} />,
    sub: clamp(r.memo, 60) || undefined,
    pill: paid
      ? { text: "Paid ✓", tone: "paid" }
      : r.status === "expired"
        ? { text: "Expired", tone: "muted" }
        : { text: resolved.source === "payload" ? "Unverified" : r.payer_label ? `Waiting for ${clamp(r.payer_label, 16)}` : "Unpaid", tone: "pending" },
  });
}
