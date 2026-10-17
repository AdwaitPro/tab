"use client";

import { useQueries } from "@tanstack/react-query";
import { ChevronRight, Share } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { formatUsdc } from "@/lib/amount";
import { fetchStatus } from "@/lib/api-client";
import type { RequestRecord, SplitRecord } from "@/lib/server/records";
import { shortAddress } from "@/lib/text";
import { Avatar } from "./avatar";
import { PayWithAgentButton } from "./growth";
import { ShareSheet } from "./share-sheet";
import { TimeAgo } from "@/components/time-ago";
import { AddressChip } from "@/components/address";

export function SplitView({ split, requests, url }: { split: SplitRecord; requests: RequestRecord[]; url: string }) {
  const [shareOpen, setShareOpen] = useState(false);
  const statuses = useQueries({
    queries: requests.map((r) => ({
      queryKey: ["request-status", r.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchStatus(r.id, signal),
      initialData: {
        id: r.id,
        status: r.status,
        paid_tx: r.paid_tx,
        paid_at: r.paid_at,
        payer_address: r.payer_address,
        checked_at: r.created_at,
      },
      initialDataUpdatedAt: 0,
      refetchInterval: (q: { state: { data?: { status: string } } }) =>
        q.state.data?.status === "paid" || q.state.data?.status === "paid_late" ? false : 8_000,
    })),
  });

  const total = BigInt(split.total_atomic);
  const membersTotal = requests.reduce((acc, r) => acc + BigInt(r.amount_atomic), 0n);
  const yourShare = total - membersTotal;
  let collected = 0n;
  requests.forEach((r, i) => {
    const s = statuses[i]?.data?.status;
    if (s === "paid" || s === "paid_late") collected += BigInt(r.amount_atomic);
  });
  const pct = membersTotal > 0n ? Number((collected * 1000n) / membersTotal) / 10 : 0;
  const paidCount = statuses.filter((q) => q.data?.status === "paid" || q.data?.status === "paid_late").length;

  return (
    <>
      <Card className="animate-rise overflow-hidden">
        <div className="px-6 pt-6 pb-6 sm:px-7">
          <div className="flex items-center gap-3">
            <Avatar label={split.requester_label ?? split.recipient} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">
                {split.requester_label ? <bdi>{split.requester_label}</bdi> : shortAddress(split.recipient)}
                <span className="font-normal text-muted"> split a bill</span>
              </p>
              <p className="text-[13px] text-subtle">
                <TimeAgo iso={split.created_at} />
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Share this split" onClick={() => setShareOpen(true)}>
              <Share aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-7 text-center">
            {split.memo && (
              <p className="text-[17px] font-medium text-muted">
                <bdi>{split.memo}</bdi>
              </p>
            )}
            <p className="mt-2 flex items-baseline justify-center gap-2">
              <span className="text-amount tabular font-bold tracking-[-0.04em]">{formatUsdc(total)}</span>
              <span className="text-[20px] font-bold text-muted">USDC</span>
            </p>
            {yourShare > 0n && (
              <p className="mt-1 text-[13px] text-subtle">
                includes {split.requester_label ? <bdi>{split.requester_label}</bdi> : "the requester"}&apos;s own{" "}
                <span className="tabular font-mono">{formatUsdc(yourShare)}</span>
              </p>
            )}
          </div>

          <div className="mt-6">
            <div className="flex items-baseline justify-between text-[14px]">
              <span className="font-semibold">
                {paidCount} of {requests.length} paid
              </span>
              <span className="tabular font-mono text-muted">
                {formatUsdc(collected)} / {formatUsdc(membersTotal)}
              </span>
            </div>
            <div
              className="mt-2 h-3 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              aria-label="Collected"
            >
              <div
                className="h-full rounded-full bg-success-bright transition-[width] duration-700 ease-[var(--ease-out)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        <ul className="border-t border-line" aria-live="polite">
          {requests.map((r, i) => {
            const status = statuses[i]?.data?.status ?? r.status;
            const paid = status === "paid" || status === "paid_late";
            return (
              <li key={r.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`/r/${r.id}`}
                  className="flex min-h-16 items-center gap-3 px-6 py-3 hover:bg-surface-2 sm:px-7"
                >
                  <Avatar label={r.payer_label ?? r.id} className="size-10 text-[16px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">
                      <bdi>{r.payer_label ?? "Someone"}</bdi>
                    </span>
                    <span className="tabular block font-mono text-[13px] text-subtle">{formatUsdc(BigInt(r.unique_atomic))} USDC</span>
                  </span>
                  {paid ? (
                    <Pill tone="success" dot>Paid</Pill>
                  ) : status === "expired" ? (
                    <Pill tone="danger">Expired</Pill>
                  ) : status === "checking" ? (
                    <Pill>Checking</Pill>
                  ) : (
                    <Pill tone="pending" dot>Pay</Pill>
                  )}
                  <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between px-6 py-4 text-[14px] sm:px-7">
          <span className="text-muted">Paid to</span>
          <AddressChip address={split.recipient} label="Recipient" />
        </div>
      </Card>
      <div className="mt-3">
        <PayWithAgentButton url={url} />
      </div>
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={url}
        title="Tab split"
        text={`${split.memo ?? "Split"}: ${formatUsdc(total)} USDC`}
      />
    </>
  );
}
