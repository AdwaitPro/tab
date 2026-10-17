"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "@/components/ui/copy-button";

export function CopyPrompt({ prompt }: { prompt: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(prompt)}
      className="press group flex w-full items-center gap-3 rounded-[20px] bg-[#111] px-5 py-4 text-left font-mono text-[14px] text-white/90 shadow-pop"
    >
      <span className="text-[#8ccbff]" aria-hidden="true">
        ›
      </span>
      <span className="flex-1">{prompt}</span>
      {copied ? <Check className="size-4 text-[#4ad08f]" aria-label="Copied" /> : <Copy className="size-4 text-white/50 group-hover:text-white" aria-label="Copy prompt" />}
    </button>
  );
}
