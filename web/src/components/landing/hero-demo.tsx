"use client";

import { Check, Sparkles } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { TiltCard } from "@/components/motion/tilt-card";
import { Avatar } from "@/components/pay/avatar";
import { cn } from "@/lib/cn";

const PROMPT = "Split a 4 USDC dinner with Meera";
// Loop (~5.5s): type (≈1s) → tool call → card pulses Pay → flies + flips to Paid → hold → back.
type Stage = "typing" | "tool" | "pay" | "paid";

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Agent chat beside a real, tiltable pay card that flips to Paid. The card is always on stage. */
export function HeroDemo() {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const [typed, setTyped] = useState(PROMPT.length);
  const [stage, setStage] = useState<Stage>("pay");

  useEffect(() => {
    if (reduced) return;
    let t: ReturnType<typeof setTimeout>;
    if (stage === "typing") {
      t = typed < PROMPT.length ? setTimeout(() => setTyped((n) => n + 1), 28) : setTimeout(() => setStage("tool"), 250);
    } else if (stage === "tool") {
      t = setTimeout(() => setStage("pay"), 500);
    } else if (stage === "pay") {
      t = setTimeout(() => setStage("paid"), 1300);
    } else {
      t = setTimeout(() => {
        setTyped(0);
        setStage("typing");
      }, 2600);
    }
    return () => clearTimeout(t);
  }, [typed, stage, reduced]);

  const s: Stage = reduced ? "paid" : stage;
  const text = reduced ? PROMPT : PROMPT.slice(0, typed);
  const showTool = s !== "typing";

  return (
    <div
      className="relative w-full max-w-[500px]"
      role="img"
      aria-label="Example: you ask your agent to split dinner with Meera, it creates a Tab pay card, Meera pays and it flips to Paid"
    >
      <div className="relative z-10 mr-10 rounded-[24px] bg-surface/85 p-4 shadow-card backdrop-blur-xl sm:mr-20" aria-hidden="true">
        <div className="flex items-center gap-2 pb-3">
          <span className="size-2.5 rounded-full bg-[#ff5a2c]" />
          <span className="size-2.5 rounded-full bg-sun" />
          <span className="size-2.5 rounded-full bg-success-bright" />
          <span className="ml-2 text-[13px] font-bold text-subtle">Your agent · PayBox</span>
        </div>
        <div className="flex min-h-[86px] flex-col gap-2.5">
          <p className="max-w-[92%] self-end rounded-[20px] rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-[1.4] font-medium text-accent-fg">
            {text || "\u00a0"}
            {s === "typing" && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-current" />}
          </p>
          <p
            className={cn(
              "flex items-center gap-2 self-start rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-muted transition-opacity duration-300",
              showTool ? "opacity-100" : "opacity-0",
            )}
          >
            <Sparkles className="size-3.5 text-brand" />
            tab_split · Meera owes 2.00
          </p>
        </div>
      </div>

      <div className="relative -mt-4 ml-8 sm:ml-16" aria-hidden="true">
        <div className={cn("hero-fly", s === "paid" && "hero-fly-go")}>
          <TiltCard maxDeg={9}>
            <div className={cn("hero-flip relative h-[236px] sm:h-[256px]", s === "paid" && "hero-flipped")}>
              <PayFace pulsing={s === "pay"} />
              <PaidFace />
            </div>
          </TiltCard>
        </div>
      </div>
    </div>
  );
}

function PayFace({ pulsing }: { pulsing: boolean }) {
  return (
    <div className="hero-face absolute inset-0 overflow-hidden rounded-[24px] bg-surface p-5 shadow-pop">
      <div className="flex items-center gap-2.5">
        <Avatar label="Adwait" className="size-9 text-[15px]" />
        <p className="text-[14px] font-bold">
          Adwait <span className="font-medium text-muted">is asking</span>
        </p>
        <span className="ml-auto rounded-full bg-pending-soft px-2.5 py-1 text-[12px] font-bold text-pending">Waiting for Meera</span>
      </div>
      <p className="mt-4 text-center text-[14px] font-medium text-muted">Dinner at Toit</p>
      <p className="text-center text-[64px] leading-none font-black tracking-[-0.05em] tabular">
        2.00 <span className="text-[18px] font-bold tracking-normal text-muted">USDC</span>
      </p>
      <div
        className={cn(
          "mx-auto mt-5 flex h-12 max-w-[260px] items-center justify-center rounded-full bg-accent text-[15px] font-bold text-accent-fg shadow-raised transition-transform duration-300",
          pulsing && "scale-[0.97]",
        )}
      >
        Pay 2.00 USDC
      </div>
    </div>
  );
}

function PaidFace() {
  return (
    <div className="hero-face hero-back absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-[24px] bg-[#111] p-5 text-white shadow-pop">
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-[#2cc078] shadow-[0_0_40px_-6px_#2cc078]">
        <Check className="size-7" strokeWidth={3.5} />
      </span>
      <p className="mt-4 text-[34px] leading-none font-black tracking-[-0.035em]">
        Paid <span className="serif-accent text-[38px] font-normal text-[#8ccbff]">by Meera</span>
      </p>
      <p className="mt-2 font-mono text-[13px] text-white/60">2.00 USDC on Base in 2s</p>
    </div>
  );
}
