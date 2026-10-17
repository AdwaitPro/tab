import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAddress } from "viem";
import { BetView } from "@/components/escrow/bet-view";
import { Dice } from "@/components/illustrations";
import { MessageCard, PayCardSkeleton } from "@/components/pay/states";
import { formatUsdc } from "@/lib/amount";
import { publicBaseUrl, serverEnv } from "@/lib/server/env";
import { lookupBet } from "@/lib/server/escrow-pages";

export async function generateMetadata({ params }: PageProps<"/b/[id]">): Promise<Metadata> {
  const { id } = await params;
  const result = await lookupBet(id);
  const robots = { index: false, follow: false };
  if (result.kind !== "ok") return { title: "Bet", robots };
  const b = result.value;
  const title = `Bet: ${formatUsdc(BigInt(b.stake_atomic))} USDC each`;
  return { title, description: b.terms ?? "A friendly bet on Tab, settled on Base", robots, openGraph: { title } };
}

export default function BetPage({ params }: PageProps<"/b/[id]">) {
  return (
    <Suspense fallback={<PayCardSkeleton />}>
      <BetLoader params={params} />
    </Suspense>
  );
}

async function BetLoader({ params }: { params: PageProps<"/b/[id]">["params"] }) {
  const { id } = await params;
  const result = await lookupBet(id);
  if (result.kind === "not_found") notFound();
  if (result.kind === "not_configured") {
    return <MessageCard title="Escrow not configured" body="This Tab has no escrow contract set yet" art={<Dice className="size-24" float />} />;
  }
  if (result.kind === "error") {
    return <MessageCard title="Couldn't read this bet" body="Base is slow to answer right now, stakes in escrow are safe" art={<Dice className="size-24" float />} />;
  }
  const escrow = serverEnv().escrowAddress;
  if (!escrow) notFound();
  return <BetView initial={result.value} escrow={getAddress(escrow)} url={`${publicBaseUrl()}/b/${id}`} />;
}
