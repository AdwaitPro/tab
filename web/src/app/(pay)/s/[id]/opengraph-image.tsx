import { connection } from "next/server";
import { formatUsdc } from "@/lib/amount";
import { getDb } from "@/lib/db/client";
import { isId } from "@/lib/ids";
import { clamp, ogCard, OG_SIZE, UsdcHeadline } from "@/lib/server/og";
import { getSplit } from "@/lib/server/requests";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Tab split";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const split = isId(id) ? await getDb().then((db) => getSplit(db, id)).catch(() => null) : null;
  if (!split) return ogCard({ eyebrow: "Tab", headline: "Split", pill: { text: "Not found", tone: "muted" } });
  const paid = split.requests.filter((r) => r.status === "paid" || r.status === "paid_late").length;
  return ogCard({
    eyebrow: `${clamp(split.split.requester_label, 30) || "Someone"} split a bill`,
    headline: <UsdcHeadline amount={formatUsdc(BigInt(split.split.total_atomic))} />,
    sub: clamp(split.split.memo, 60) || undefined,
    pill: { text: `${paid}/${split.requests.length} paid`, tone: paid === split.requests.length ? "paid" : "pending" },
  });
}
