import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { Odometer } from "@/components/motion/odometer";
import { formatUsdcShort } from "@/lib/amount";
import { addressUrl } from "@/lib/constants";
import { liveStats } from "@/lib/server/stats";

const REPO_URL = "https://github.com/AdwaitPro/tab";

/** "Live on Base" proof strip. Hidden entirely if the numbers can't be read; never shows made-up values. */
export async function LiveStrip({ escrow }: { escrow: string | undefined }) {
  const stats = await liveStats();
  if (!stats) return null;
  const items = [
    { label: "USDC settled through Tab", value: formatUsdcShort(BigInt(stats.settledAtomic)) },
    { label: "Payments verified on-chain", value: stats.payments },
    { label: "Escrowed deals", value: stats.deals },
    { label: "Bets between friends", value: stats.bets },
    // Fixed engineering facts, true for the deployed contract (contracts/SECURITY.md).
    { label: "Contract tests", value: "124" },
    { label: "Test coverage", value: "100%" },
  ];
  return (
    <section aria-label="Live on Base" className="py-6">
      <div className="flex flex-col gap-5 rounded-[28px] bg-surface/70 px-6 py-5 shadow-card backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-[13px] font-bold text-subtle">
          <span className="relative inline-flex size-2.5">
            <span className="pulse-ring absolute inset-0 rounded-full bg-success-bright" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success-bright" />
          </span>
          Live on Base
        </p>
        <dl className="grid grid-cols-3 gap-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
          {items.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="min-h-8 text-[12px] leading-4 text-subtle">{item.label}</dt>
              <dd className="mt-1 overflow-hidden text-[20px] leading-none font-bold tracking-[-0.03em] sm:text-[24px]">
                <Odometer value={item.value} />
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex gap-2 text-[13px] font-semibold">
          {escrow && (
            <a href={addressUrl(escrow)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-muted ring-1 ring-line ring-inset hover:text-fg">
              <BadgeCheck className="size-4" aria-hidden="true" /> Verified contract
            </a>
          )}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-muted ring-1 ring-line ring-inset hover:text-fg">
            GitHub <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
