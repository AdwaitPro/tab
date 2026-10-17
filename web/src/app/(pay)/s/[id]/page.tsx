import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SplitView } from "@/components/pay/split-view";
import { MessageCard, PayCardSkeleton } from "@/components/pay/states";
import { formatUsdc } from "@/lib/amount";
import { getDb } from "@/lib/db/client";
import { isId } from "@/lib/ids";
import { publicBaseUrl } from "@/lib/server/env";
import { getSplit } from "@/lib/server/requests";

async function lookup(id: string) {
  await connection();
  if (!isId(id)) return { ok: true as const, value: null };
  try {
    return { ok: true as const, value: await getSplit(await getDb(), id) };
  } catch {
    return { ok: false as const };
  }
}

export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  const { id } = await params;
  const result = await lookup(id);
  const robots = { index: false, follow: false };
  if (!result.ok || !result.value) return { title: "Split", robots };
  const s = result.value.split;
  const title = `${s.requester_label ?? "Someone"} split ${formatUsdc(BigInt(s.total_atomic))} USDC`;
  return { title, description: s.memo ?? "Split on Tab", robots, openGraph: { title, description: s.memo ?? "Split on Tab" } };
}

export default function SplitPage({ params }: PageProps<"/s/[id]">) {
  return (
    <Suspense fallback={<PayCardSkeleton />}>
      <SplitLoader params={params} />
    </Suspense>
  );
}

async function SplitLoader({ params }: { params: PageProps<"/s/[id]">["params"] }) {
  const { id } = await params;
  const result = await lookup(id);
  if (!result.ok) {
    return <MessageCard title="Couldn't load this split" body="Tab is having a moment, try again shortly" />;
  }
  if (!result.value) notFound();
  return <SplitView split={result.value.split} requests={result.value.requests} url={`${publicBaseUrl()}/s/${id}`} />;
}
