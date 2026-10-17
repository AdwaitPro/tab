import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RequestPay } from "@/components/pay/request-pay";
import { MessageCard, PayCardSkeleton } from "@/components/pay/states";
import { formatUsdc } from "@/lib/amount";
import { getDb } from "@/lib/db/client";
import { publicBaseUrl } from "@/lib/server/env";
import { resolveRequest, type ResolvedRequest } from "@/lib/server/resolve";

type Lookup = { ok: true; value: ResolvedRequest | null } | { ok: false };

async function lookup(rawId: string): Promise<Lookup> {
  await connection();
  const id = decodeURIComponent(rawId);
  try {
    const db = id.startsWith("p.") ? null : await getDb();
    return { ok: true, value: await resolveRequest(db, id) };
  } catch {
    return { ok: false };
  }
}

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await params;
  const result = await lookup(id);
  const robots = { index: false, follow: false };
  if (!result.ok || !result.value) return { title: "Payment request", robots };
  const r = result.value.record;
  const who = r.requester_label ?? "Someone";
  const title = `${who} requested ${formatUsdc(BigInt(r.amount_atomic))} USDC`;
  return {
    title,
    description: r.memo ? `${r.memo} · Pay from any wallet on Base or with your agent` : "Pay from any wallet on Base or with your agent",
    robots,
    openGraph: { title, description: r.memo ?? "Tab payment request on Base" },
  };
}

export default function RequestPage({ params }: PageProps<"/r/[id]">) {
  return (
    <Suspense fallback={<PayCardSkeleton />}>
      <RequestLoader params={params} />
    </Suspense>
  );
}

async function RequestLoader({ params }: { params: PageProps<"/r/[id]">["params"] }) {
  const { id: rawId } = await params;
  const result = await lookup(rawId);
  if (!result.ok) {
    return (
      <MessageCard
        title="Couldn't load this Tab"
        body="Tab is having a moment, your money is safe and nothing moves without your wallet"
      />
    );
  }
  if (!result.value) notFound();
  const id = decodeURIComponent(rawId);
  return <RequestPay request={result.value.record} source={result.value.source} url={`${publicBaseUrl()}/r/${id}`} />;
}
