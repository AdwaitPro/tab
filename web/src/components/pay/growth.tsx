"use client";

import { ArrowUpRight, Bot, Check, Copy } from "lucide-react";
import { Coin } from "@/components/illustrations";
import { useCopy } from "@/components/ui/copy-button";
import { PAYBOX_APP_URL } from "@/lib/constants";

export function GrowthCard() {
  return (
    <a
      href={PAYBOX_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="press group relative flex items-center gap-4 overflow-hidden rounded-[24px] bg-[#111] p-5 text-white shadow-pop"
    >
      <span className="flex-1">
        <span className="block text-[17px] leading-6 font-bold tracking-[-0.01em]">Let your agent handle this next time</span>
        <span className="mt-1 block text-[14px] leading-5 text-white/70">
          Split, request and settle in one sentence with PayBox
        </span>
        <span className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-[#8ccbff]">
          Get PayBox <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden="true" />
        </span>
      </span>
      <Coin className="size-20 shrink-0" float delay={0.4} rotate={-8} />
    </a>
  );
}

/** Copies a ready-to-paste instruction for the payer's own agent. */
export function PayWithAgentButton({ url }: { url: string }) {
  const { copied, copy } = useCopy(2200);
  return (
    <button
      type="button"
      onClick={() => void copy(`Pay this Tab: ${url}`)}
      className="press flex min-h-14 w-full items-center gap-3 rounded-full bg-surface-2 pr-5 pl-2 text-left ring-1 ring-inset ring-line hover:bg-surface-3"
    >
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface text-fg shadow-card">
        <Bot className="size-5" aria-hidden="true" />
      </span>
      <span className="flex-1">
        <span className="block text-[15px] font-semibold">Pay with your agent</span>
        <span className="block text-[13px] text-muted" aria-live="polite">
          {copied ? "Copied, paste it to your PayBox agent" : "Copies “Pay this Tab: …” for PayBox"}
        </span>
      </span>
      {copied ? <Check className="size-5 text-success" aria-hidden="true" /> : <Copy className="size-5 text-subtle" aria-hidden="true" />}
    </button>
  );
}
