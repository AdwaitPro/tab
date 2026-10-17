"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, Hourglass, Share } from "lucide-react";
import { useState } from "react";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { Lock } from "@/components/illustrations";
import { StatusIsland } from "@/components/pay/status-island";
import { ShareSheet } from "@/components/pay/share-sheet";
import { PayWithAgentButton } from "@/components/pay/growth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, type Tone } from "@/components/ui/pill";
import { useNow } from "@/components/use-now";
import { WalletGate } from "@/components/wallet/wallet-bar";
import { formatUsdc } from "@/lib/amount";
import { txUrl } from "@/lib/constants";
import { fetchDeal, type ClientDeal } from "@/lib/escrow-client";
import { DISPUTE_TIMEOUT_S, type DealState } from "@/lib/escrow-types";
import { FlipCountdown } from "@/components/motion/flip-countdown";
import { ActionCard, Party, TermsBox, Timeline, type TimelineStep } from "./parts";
import { useEscrowTx } from "./use-escrow-tx";
import { WithdrawCard } from "./withdraw-card";

const STATE_TONE: Record<DealState, Tone> = {
  None: "neutral",
  Funded: "accent",
  Delivered: "info",
  Released: "success",
  Refunded: "neutral",
  Disputed: "danger",
  Resolved: "success",
};
const STATE_LABEL: Record<DealState, string> = {
  None: "Unknown",
  Funded: "Funded",
  Delivered: "Delivered",
  Released: "Released",
  Refunded: "Refunded",
  Disputed: "Disputed",
  Resolved: "Resolved",
};

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
const fmtDate = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function DealView({ initial, escrow, url }: { initial: ClientDeal; escrow: Address; url: string }) {
  const queryKey = ["deal", initial.id] as const;
  const { data: deal } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchDeal(initial.id, signal),
    initialData: initial,
    refetchInterval: 8_000,
  });
  const now = useNow();
  const { address } = useAccount();
  const tx = useEscrowTx(escrow, queryKey);
  const [shareOpen, setShareOpen] = useState(false);
  const [bps, setBps] = useState(5000);

  const me = address ? getAddress(address) : null;
  const isBuyer = me === deal.buyer;
  const isSeller = me === deal.seller;
  const isArbiter = deal.arbiter !== null && me === deal.arbiter;
  const id = BigInt(deal.id);
  const amount = formatUsdc(BigInt(deal.amount_atomic));
  const deliverBy = ms(deal.deliver_by);
  const reviewEnds = deal.delivered_at ? ms(deal.delivered_at) + deal.review_window_seconds * 1000 : 0;
  const disputeRefundAt = ms(deal.disputed_at) + DISPUTE_TIMEOUT_S * 1000;
  const disputeOpen =
    (deal.state === "Funded" && now < deliverBy) || (deal.state === "Delivered" && now < reviewEnds);
  const ready = now > 0;

  const deadline =
    deal.state === "Funded"
      ? { label: now < deliverBy ? "Seller delivers within" : "Delivery deadline passed", at: deliverBy }
      : deal.state === "Delivered"
        ? { label: now < reviewEnds ? "Buyer review ends in" : "Review window over", at: reviewEnds }
        : deal.state === "Disputed"
          ? { label: "Timeout refund opens in", at: disputeRefundAt }
          : null;

  const steps: TimelineStep[] = [
    { label: "Funded", detail: `${amount} USDC locked by the buyer`, state: "done" },
    {
      label: "Delivered",
      detail: deal.delivered_at ? `Marked ${fmtDate(ms(deal.delivered_at))}` : `Due by ${fmtDate(deliverBy)}`,
      state: deal.delivered_at ? "done" : deal.state === "Funded" ? "current" : "todo",
    },
  ];
  if (deal.state === "Refunded") steps.push({ label: "Refunded", detail: "Funds returned to the buyer", state: "alt" });
  else if (deal.state === "Disputed") steps.push({ label: "Disputed", detail: "Waiting for the arbiter", state: "alt" });
  else if (deal.state === "Resolved") steps.push({ label: "Resolved", detail: "The arbiter split the funds", state: "done" });
  else
    steps.push({
      label: "Released",
      detail: deal.state === "Released" ? "Paid to the seller" : "Buyer releases, or seller claims after review",
      state: deal.state === "Released" ? "done" : deal.state === "Delivered" ? "current" : "todo",
    });

  const busy = tx.pending !== null;
  const act = (label: string, fn: Parameters<typeof tx.run>[0]) => (
    <Button block size="lg" disabled={busy} onClick={() => void tx.run(fn, label)}>
      {tx.pending === label ? "Working…" : label}
    </Button>
  );

  const actions: React.ReactNode[] = [];
  if (ready && isSeller && deal.state === "Funded" && now < deliverBy) {
    actions.push(
      <ActionCard key="deliver" title="Mark as delivered" consequence={`Starts the buyer's review window, if they go quiet you can claim ${amount} USDC after`}>
        {act("Mark delivered", { functionName: "markDelivered", args: [id] })}
      </ActionCard>,
    );
  }
  if (ready && isBuyer && (deal.state === "Funded" || deal.state === "Delivered")) {
    actions.push(
      <ActionCard key="release" title="Release payment" consequence={`Sends ${amount} USDC to the seller now, no take-backs`}>
        {act("Release funds", { functionName: "release", args: [id] })}
      </ActionCard>,
    );
  }
  if (ready && isSeller && deal.state === "Delivered" && now >= reviewEnds) {
    actions.push(
      <ActionCard key="claim" title="Claim payment" consequence={`Review window is over, your ${amount} USDC is ready`}>
        {act("Claim funds", { functionName: "claim", args: [id] })}
      </ActionCard>,
    );
  }
  if (ready && isBuyer && deal.state === "Funded" && now >= deliverBy) {
    actions.push(
      <ActionCard key="refund" title="Refund" consequence={`The seller missed the deadline, get your ${amount} USDC back`}>
        {act("Refund me", { functionName: "refund", args: [id] })}
      </ActionCard>,
    );
  }
  if (ready && (isBuyer || isSeller) && deal.state === "Disputed" && now >= disputeRefundAt) {
    actions.push(
      <ActionCard key="refund-timeout" title="Timeout refund" consequence={`The arbiter didn't rule in time, ${amount} USDC goes back to the buyer`}>
        {act("Refund buyer", { functionName: "refund", args: [id] })}
      </ActionCard>,
    );
  }
  if (ready && isSeller && deal.state === "Funded") {
    actions.push(
      <ActionCard key="cancel" title="Decline this deal" consequence={`Sends ${amount} USDC back to the buyer and closes the deal`} tone="warn">
        <Button block size="md" variant="secondary" disabled={busy} onClick={() => void tx.run({ functionName: "cancelBySeller", args: [id] }, "Decline")}>
          Decline and refund buyer
        </Button>
      </ActionCard>,
    );
  }
  if (ready && (isBuyer || isSeller) && deal.arbiter && disputeOpen) {
    actions.push(
      <ActionCard key="dispute" title="Open a dispute" consequence="Freezes the funds until the arbiter decides the split" tone="warn">
        <Button block size="md" variant="danger" disabled={busy} onClick={() => void tx.run({ functionName: "dispute", args: [id] }, "Dispute")}>
          Dispute
        </Button>
      </ActionCard>,
    );
  }
  if (ready && isArbiter && deal.state === "Disputed") {
    const sellerShare = (BigInt(deal.amount_atomic) * BigInt(bps)) / 10_000n;
    actions.push(
      <ActionCard key="resolve" title="Resolve dispute" consequence={`Seller receives ${formatUsdc(sellerShare)} USDC, buyer receives ${formatUsdc(BigInt(deal.amount_atomic) - sellerShare)} USDC.`}>
        <label className="mb-3 block text-[13px] font-semibold text-muted">
          Seller share: {(bps / 100).toFixed(0)}%
          <input type="range" min={0} max={10000} step={500} value={bps} onChange={(e) => setBps(Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" />
        </label>
        {act("Resolve", { functionName: "resolve", args: [id, bps] })}
      </ActionCard>,
    );
  }

  const terminal = deal.state === "Released" || deal.state === "Refunded" || deal.state === "Resolved";

  return (
    <>
      <StatusIsland state={tx.island} />
      <Card className="animate-rise overflow-hidden">
        <div className="px-6 pt-6 sm:px-7">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold">
              Escrowed deal <span className="font-mono text-muted">#{deal.id}</span>
            </p>
            <div className="flex items-center gap-1">
              <Pill tone={STATE_TONE[deal.state]} dot>
                {STATE_LABEL[deal.state]}
              </Pill>
              <Button variant="ghost" size="icon" aria-label="Share this deal" onClick={() => setShareOpen(true)}>
                <Share aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="mt-6 flex items-center justify-center gap-4">
            <Lock className="h-20 w-16" float rotate={-6} />
            <div>
              <p className="flex items-baseline gap-2">
                <span className="text-[52px] leading-none font-bold tracking-[-0.04em] tabular">{amount}</span>
                <span className="text-[18px] font-bold text-muted">USDC</span>
              </p>
              <p className="mt-1 text-[14px] text-muted">{terminal ? "Settled from escrow" : "Locked in escrow"}</p>
            </div>
          </div>
          {deadline && ready && (
            <p className="mt-5 flex items-center justify-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-[14px]" aria-live="off">
              <Hourglass className="size-4 text-muted" aria-hidden="true" />
              <span className="text-muted">{deadline.label}</span>
              {deadline.at > now && <FlipCountdown ms={deadline.at - now} />}
            </p>
          )}
        </div>

        <div className="mt-6 space-y-4 border-t border-line px-6 py-5 sm:px-7">
          <Party role="Buyer" address={deal.buyer} you={isBuyer} />
          <Party role="Seller" address={deal.seller} you={isSeller} />
          {deal.arbiter && <Party role="Arbiter" address={deal.arbiter} you={isArbiter} />}
        </div>

        <div className="space-y-5 border-t border-line px-6 py-5 sm:px-7">
          <TermsBox terms={deal.terms} hash={deal.terms_hash} />
          <Timeline steps={steps} />
          {deal.created_tx && (
            <a href={txUrl(deal.created_tx)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-accent-ink hover:underline">
              Funding transaction <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>

        {(!terminal || me) && (
          <div className="border-t border-line px-6 py-5 sm:px-7" aria-live="polite">
            <WalletGate prompt="Buyer, seller or arbiter, connect to see your actions">
              <WithdrawCard escrow={escrow} tx={tx} />
              {terminal ? null : actions.length > 0 ? (
                <div className="space-y-3">{actions}</div>
              ) : (
                <p className="rounded-2xl bg-surface-2 px-4 py-3 text-center text-[14px] text-muted">
                  {isBuyer || isSeller || isArbiter ? "Nothing for you to do yet" : "Only the buyer, seller or arbiter can act here"}
                </p>
              )}
            </WalletGate>
            {tx.error && (
              <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {tx.error}
              </p>
            )}
          </div>
        )}
      </Card>
      <div className="mt-3">
        <PayWithAgentButton url={url} />
      </div>
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} url={url} title="Tab deal" text={`Escrowed deal: ${amount} USDC`} />
    </>
  );
}
