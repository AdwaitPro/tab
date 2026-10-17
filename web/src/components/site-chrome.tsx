import { ArrowUpRight } from "lucide-react";
import { PAYBOX_APP_URL } from "@/lib/constants";
import { Wordmark } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] sm:px-6">
      <Wordmark />
      <nav className="flex items-center gap-1" aria-label="Site">
        <a
          href={PAYBOX_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="press hidden h-11 items-center gap-1 rounded-full px-4 text-[15px] font-semibold text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
        >
          PayBox <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
        <ThemeToggle />
      </nav>
    </header>
  );
}

export function PayFooter() {
  return (
    <footer className="mx-auto mt-auto w-full max-w-[440px] px-4 pt-8 pb-[max(env(safe-area-inset-bottom),24px)] text-center text-[13px] leading-5 text-subtle">
      Public on Base · Tab never holds your funds
      <br />
      <a href={PAYBOX_APP_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-muted hover:text-fg">
        Powered by PayBox
      </a>
    </footer>
  );
}
