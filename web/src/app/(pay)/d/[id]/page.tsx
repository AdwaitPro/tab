import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAddress } from "viem";
import { DealView } from "@/components/escrow/deal-view";
import { Lock } from "@/components/illustrations";
import { MessageCard, PayCardSkeleton } from "@/components/pay/states";
import { formatUsdc } from "@/lib/amount";
import { publicBaseUrl, serverEnv } from "@/lib/server/env";
import { lookupDeal } from "@/lib/server/escrow-pages";

export async function generateMetadata({ params }: PageProps<"/d/[id]">): Promise<Metadata> {
  const { id } = await params;
  const result = await lookupDeal(id);
  const robots = { index: false, follow: false };
  if (result.kind !== "ok") return { title: "Escrowed deal", robots };
  const title = `${formatUsdc(BigInt(result.value.amount_atomic))} USDC locked in escrow`;
  return { title, description: result.value.terms ?? "Escrowed deal on Tab", robots, openGraph: { title } };
}

export default function DealPage({ params }: PageProps<"/d/[id]">) {
  return (
    <Suspense fallback={<PayCardSkeleton />}>
      <DealLoader params={params} />
    </Suspense>
  );
}

async function DealLoader({ params }: { params: PageProps<"/d/[id]">["params"] }) {
  const { id } = await params;
  const result = await lookupDeal(id);
  if (result.kind === "not_found") notFound();
  if (result.kind === "not_configured") {
    return <MessageCard title="Escrow not configured" body="This Tab has no escrow contract set yet" art={<Lock className="h-24 w-20" float />} />;
  }
  if (result.kind === "error") {
    return <MessageCard title="Couldn't read this deal" body="Base is slow to answer right now, funds in escrow are safe" art={<Lock className="h-24 w-20" float />} />;
  }
  const escrow = serverEnv().escrowAddress;
  if (!escrow) notFound();
  return <DealView initial={result.value} escrow={getAddress(escrow)} url={`${publicBaseUrl()}/d/${id}`} />;
}
