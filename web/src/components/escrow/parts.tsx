import { BadgeCheck, Check, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { AddressChip } from "@/components/address";
import { Avatar } from "@/components/pay/avatar";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/text";

export function Party({ role, address, you }: { role: string; address: string; you: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar label={address} className="size-10 text-[15px]" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-subtle">
          {role}
          {you && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-ink">You</span>}
        </p>
        <AddressChip address={address} label={role} />
      </div>
    </div>
  );
}

export function TermsBox({ terms, hash }: { terms: string | null; hash: string }) {
  return (
    <div className="rounded-[20px] bg-surface-2 p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-subtle">
        <FileText className="size-4" aria-hidden="true" /> Terms
      </p>
      {terms ? (
        <>
          <p className="mt-2 text-[15px] leading-6 whitespace-pre-wrap">
            <bdi>{terms}</bdi>
          </p>
          <p className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-success">
            <BadgeCheck className="size-3.5" aria-hidden="true" /> Matches on-chain hash {shortAddress(hash, 8, 6)}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[14px] text-muted">
          No terms text shared, on-chain hash <span className="font-mono">{shortAddress(hash, 8, 6)}</span>
        </p>
      )}
    </div>
  );
}

export interface TimelineStep {
  label: string;
  detail?: ReactNode;
  state: "done" | "current" | "todo" | "alt";
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative space-y-4">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3">
          {i < steps.length - 1 && (
            <span
              className={cn(
                "absolute top-7 left-[11px] h-[calc(100%-4px)] w-0.5 rounded-full",
                s.state === "done" ? "bg-success-bright" : "bg-line-strong",
              )}
              aria-hidden="true"
            />
          )}
          <span
            className={cn(
              "relative z-10 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full",
              s.state === "done" && "bg-success-bright text-white",
              s.state === "current" && "bg-accent text-accent-fg",
              s.state === "todo" && "bg-surface-3",
              s.state === "alt" && "bg-pending-soft text-pending",
            )}
            aria-hidden="true"
          >
            {s.state === "done" && <Check className="size-3.5" strokeWidth={3} />}
            {s.state === "current" && <span className="pulse-ring absolute inset-0 rounded-full bg-accent" />}
            {s.state === "current" && <span className="relative size-2 rounded-full bg-accent-fg" />}
          </span>
          <div className="min-w-0 pb-1">
            <p className={cn("text-[15px] font-semibold", s.state === "todo" && "text-subtle")}>
              {s.label}
              <span className="sr-only">{` (${s.state === "todo" ? "upcoming" : s.state})`}</span>
            </p>
            {s.detail && <p className="text-[13px] leading-5 text-muted">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ActionCard({
  title,
  consequence,
  children,
  tone = "default",
}: {
  title: string;
  consequence: string;
  children: ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <div className={cn("rounded-[20px] p-4 ring-1 ring-inset", tone === "warn" ? "bg-pending-soft ring-transparent" : "bg-surface-2 ring-line")}>
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-1 mb-3 text-[14px] leading-5 text-muted">{consequence}</p>
      {children}
    </div>
  );
}
