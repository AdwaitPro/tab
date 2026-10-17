"use client";

import { Check, Loader2, PenLine, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

export type IslandState = { kind: "signing" } | { kind: "confirming" } | { kind: "paid"; text?: string } | { kind: "error"; text: string };

/** Dynamic-island style status toast pinned to the top of the viewport. */
export function StatusIsland({ state }: { state: IslandState | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),10px)] z-50 h-0" role="status" aria-live="polite">
      {state && (
        <div
          key={state.kind}
          className={cn(
            "island absolute left-1/2 flex h-11 items-center gap-2.5 rounded-full bg-[#111] pr-5 pl-2 text-[15px] font-semibold text-white shadow-pop",
          )}
        >
          <span
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-full",
              state.kind === "paid" && "bg-[#2cc078]",
              state.kind === "error" && "bg-[#ff5a2c]",
              (state.kind === "signing" || state.kind === "confirming") && "bg-white/12",
            )}
          >
            {state.kind === "signing" && <PenLine className="size-4" aria-hidden="true" />}
            {state.kind === "confirming" && <Loader2 className="spin size-4" aria-hidden="true" />}
            {state.kind === "paid" && <Check className="size-4" strokeWidth={3} aria-hidden="true" />}
            {state.kind === "error" && <TriangleAlert className="size-4" aria-hidden="true" />}
          </span>
          <span className="whitespace-nowrap">
            {state.kind === "signing" && "Confirm in your wallet"}
            {state.kind === "confirming" && "Confirming on Base…"}
            {state.kind === "paid" && (state.text ?? "Paid")}
            {state.kind === "error" && state.text}
          </span>
        </div>
      )}
    </div>
  );
}
