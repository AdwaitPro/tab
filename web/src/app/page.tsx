import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { Coin, Dice, Handshake, Lock, Sparkle, Ticket } from "@/components/illustrations";
import { CopyPrompt } from "@/components/landing/install-prompt";
import { HeroDemo } from "@/components/landing/hero-demo";
import { LiveStrip } from "@/components/landing/live-strip";
import { Magnetic } from "@/components/motion/magnetic";
import { RevealHeadline } from "@/components/landing/reveal-headline";
import { SiteHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { PAYBOX_APP_URL, addressUrl } from "@/lib/constants";

const ESCROW = process.env.NEXT_PUBLIC_TAB_ESCROW;

const STEPS = [
  {
    n: "1",
    title: "Ask in one sentence",
    body: "Say “split dinner with Meera and Aarav” and your PayBox agent makes a link for each of them",
    art: <Ticket className="h-16 w-20" rotate={-6} />,
  },
  {
    n: "2",
    title: "They pay from anything",
    body: "Friends tap the link and pay USDC on Base from any wallet, or hand it to their own agent",
    art: <Coin className="size-16" rotate={8} />,
  },
  {
    n: "3",
    title: "The chain is the receipt",
    body: "Tab finds the exact transfer on Base, so nobody has to trust Tab or chase anyone",
    art: <Lock className="h-16 w-14" rotate={-4} />,
  },
];

const FEATURES = [
  {
    title: "Requests & splits",
    body: "Every link gets a unique amount, so every payment is provable on-chain",
    art: <Ticket className="h-20 w-24" float rotate={-8} />,
    tint: "bg-sun-soft",
  },
  {
    title: "Escrowed deals",
    body: "Money sits in an ownerless contract until the work ships",
    art: <Handshake className="h-20 w-28" float delay={0.8} />,
    tint: "bg-accent-soft",
  },
  {
    title: "Bets between friends",
    body: "Chainlink settles price bets and nobody holds the pot",
    art: <Dice className="size-20" float delay={1.6} rotate={10} />,
    tint: "bg-[var(--violet-soft)]",
  },
];

export default function Landing() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <section className="relative grid items-center gap-12 pt-10 pb-16 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-20">
          <div className="relative">
            <p className="animate-rise inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted shadow-card">
              <Sparkle className="size-3.5" /> Multiplayer money for AI agents
            </p>
            <RevealHeadline
              text="Settle up in one sentence"
              accent={["sentence"]}
              className="mt-6 text-[52px] leading-[0.95] font-black tracking-[-0.045em] sm:text-[72px] lg:text-[88px]"
            />
            <p
              className="animate-rise mt-6 max-w-[46ch] text-[18px] leading-[1.55] text-muted sm:text-[19px]"
              style={{ animationDelay: "380ms" }}
            >
              PayBox gave agents a wallet, Tab gives them each other. Split dinner, get paid back, lock a deal in escrow or
              bet a friend on ETH, all in USDC on Base
            </p>
            <div className="animate-rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "480ms" }}>
              <Magnetic>
                <Button size="lg" asChild>
                  <a href="#install">Install in PayBox</a>
                </Button>
              </Magnetic>
              <Button size="lg" variant="secondary" asChild>
                <a href="#how">How it works</a>
              </Button>
            </div>
          </div>

          <div className="relative flex justify-center lg:justify-end">
            <Coin className="absolute bottom-2 left-0 z-20 hidden size-20 sm:block" float rotate={-12} />
            <HeroDemo />
          </div>
        </section>

        <LiveStrip escrow={ESCROW} />

        <section id="how" className="scroll-mt-20 py-16" aria-labelledby="how-title">
          <h2 id="how-title" className="text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">
            How it works
          </h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-[28px] bg-surface p-6 shadow-card">
                <div className="flex items-start justify-between">
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-fg text-[15px] font-bold text-bg">
                    {step.n}
                  </span>
                  {step.art}
                </div>
                <h3 className="mt-6 text-[20px] font-bold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-6 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="py-8" aria-label="What Tab does">
          <div className="grid gap-4 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className={`relative overflow-hidden rounded-[28px] p-6 ${f.tint}`}>
                <div className="flex h-24 items-center">{f.art}</div>
                <h3 className="mt-4 text-[20px] font-bold tracking-[-0.02em]">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-6 text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="install" className="scroll-mt-20 py-16" aria-labelledby="install-title">
          <div className="grid gap-8 rounded-[32px] bg-surface p-6 shadow-card sm:p-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 id="install-title" className="text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">
                Install in PayBox
              </h2>
              <ol className="mt-6 space-y-4 text-[16px] leading-6">
                {[
                  "Open PayBox and go to Plugins",
                  "Find Tab in Plugins and switch it on",
                  "Ask your agent to split, request, hire or bet, then approve in PayBox",
                ].map((text, i) => (
                  <li key={text} className="flex gap-3">
                    <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-bold text-accent-ink">
                      {i + 1}
                    </span>
                    <span className="text-muted">{text}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-8">
                <Button size="lg" asChild>
                  <a href={PAYBOX_APP_URL} target="_blank" rel="noopener noreferrer">
                    Open PayBox <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-[14px] font-semibold text-subtle">Copy a prompt for your PayBox agent</p>
              <CopyPrompt prompt="Split dinner, 6 USDC, with Meera and Aarav" />
              <CopyPrompt prompt="Bet Meera 2 USDC that ETH is above 4,000 at 9 PM" />
              <CopyPrompt prompt="Pay Meera 3 USDC for a logo when she delivers" />
            </div>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-10 text-[13px] text-subtle sm:px-6">
        <span>Tab never holds your funds · Payments are public on Base</span>
        {ESCROW && (
          <a href={addressUrl(ESCROW)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-muted hover:text-fg">
            <BadgeCheck className="size-4" aria-hidden="true" /> Verified escrow contract
          </a>
        )}
      </footer>
    </>
  );
}
