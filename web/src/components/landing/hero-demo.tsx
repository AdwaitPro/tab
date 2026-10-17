"use client";

import { Check, Sparkles } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { TiltCard } from "@/components/motion/tilt-card";
import { cn } from "@/lib/cn";

const PROMPT = "Split dinner with Meera, 4 USDC";
// stage: 0 typing · 1 tool call · 2 card appears · 3 card flies + flips to paid · 4 hold
const STAGE_MS = [0, 700, 1500, 2600, 3200];

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Agent chat that turns into a real, tiltable pay card, which flies over and flips to Paid. */
export function HeroDemo() {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const [typed, setTyped] = useState(0);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (reduced) return;
    if (stage === 0 && typed < PROMPT.length) {
      const t = setTimeout(() => setTyped((n) => n + 1), 38 + Math.random() * 40);
      return () => clearTimeout(t);
    }
    if (stage === 4) {
      const t = setTimeout(() => {
        setTyped(0);
        setStage(0);
      }, 3600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStage((s) => s + 1), STAGE_MS[stage + 1] - (STAGE_MS[stage] ?? 0) + (stage === 0 ? 400 : 0));
    return () => clearTimeout(t);
  }, [typed, stage, reduced]);

  const s = reduced ? 4 : stage;
  const text = reduced ? PROMPT : PROMPT.slice(0, typed);

  return (
    <div
      className="relative w-full max-w-[440px]"
      role="img"
      aria-label="Example: you ask your agent to split dinner with Meera, it creates a Tab pay card, Meera pays and it flips to Paid"
    >
      <div className="rounded-[28px] bg-surface/80 p-4 shadow-card backdrop-blur-xl sm:p-5" aria-hidden="true">
        <div className="flex items-center gap-2 pb-3">
          <span className="size-2.5 rounded-full bg-[#ff5a2c]" />
          <span className="size-2.5 rounded-full bg-sun" />
          <span className="size-2.5 rounded-full bg-success-bright" />
          <span className="ml-2 text-[13px] font-bold text-subtle">Your agent · PayBox</span>
        </div>
        <div className="flex min-h-[64px] flex-col gap-2.5">
          <p className="max-w-[88%] self-end rounded-[20px] rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-[1.4] font-medium text-accent-fg">
            {text}
            {s === 0 && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-current" />}
          </p>
          {s >= 1 && (
            <p className="animate-rise flex items-center gap-2 self-start rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-muted">
              <Sparkles className="size-3.5 text-brand" />
              tab_split · Meera owes 2.00
            </p>
          )}
        </div>
      </div>

      <div className="relative mt-5 h-[230px] sm:h-[250px]" aria-hidden="true">
        {s >= 2 && (
          <div
            className={cn("hero-fly absolute inset-x-2 top-0 sm:inset-x-6", s >= 3 && "hero-fly-go")}
          >
            <TiltCard maxDeg={8}>
              <div className={cn("hero-flip relative h-[210px]", s >= 3 && "hero-flipped")}>
                <PayFace />
                <PaidFace />
              </div>
            </TiltCard>
          </div>
        )}
      </div>
    </div>
  );
}

function PayFace() {
  return (
    <div className="hero-face absolute inset-0 overflow-hidden rounded-[24px] bg-surface p-5 shadow-pop">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-[#2cc078] text-[15px] font-black text-white">A</span>
        <p className="text-[14px] font-bold">
          Adwait <span className="font-medium text-muted">is asking</span>
        </p>
        <span className="ml-auto rounded-full bg-pending-soft px-2.5 py-1 text-[12px] font-bold text-pending">Waiting for Meera</span>
      </div>
      <p className="mt-4 text-center text-[14px] font-medium text-muted">Dinner at Toit</p>
      <p className="text-center text-[56px] leading-none font-black tracking-[-0.045em] tabular">
        2.00 <span className="text-[18px] font-bold tracking-normal text-muted">USDC</span>
      </p>
      <div className="mx-auto mt-4 flex h-11 max-w-[240px] items-center justify-center rounded-full bg-accent text-[15px] font-bold text-accent-fg shadow-raised">
        Pay 2.004417 USDC
      </div>
    </div>
  );
}

function PaidFace() {
  return (
    <div className="hero-face hero-back absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-[24px] bg-[#111] p-5 text-white shadow-pop">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-[#2cc078]">
        <Check className="size-7" strokeWidth={3.5} />
      </span>
      <p className="mt-3 text-[28px] leading-none font-black tracking-[-0.03em]">
        Paid <span className="serif-accent text-[30px] font-normal text-[#8ccbff]">by Meera</span>
      </p>
      <p className="mt-2 font-mono text-[13px] text-white/60">2.004417 USDC · Base · 2s</p>
    </div>
  );
}
