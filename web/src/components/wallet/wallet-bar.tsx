"use client";

import { Loader2, Wallet } from "lucide-react";
import { useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/text";
import { ConnectSheet } from "./connect-sheet";

/** Connect / switch-network gate for escrow pages. Renders children only when on Base with an account. */
export function WalletGate({ children, prompt }: { children: React.ReactNode; prompt: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (!isConnected || !address) {
    return (
      <>
        <Button size="lg" block onClick={() => setOpen(true)}>
          <Wallet aria-hidden="true" /> Connect wallet
        </Button>
        <p className="mt-2 text-center text-[13px] text-subtle">{prompt}</p>
        <ConnectSheet open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  if (chainId !== base.id) {
    return (
      <Button size="lg" block onClick={() => switchChain({ chainId: base.id })} disabled={isPending}>
        {isPending ? <Loader2 className="spin" aria-hidden="true" /> : null} Switch to Base
      </Button>
    );
  }
  return (
    <>
      {children}
      <p className="mt-3 flex items-center justify-center gap-1 text-[13px] text-subtle">
        <Wallet className="size-3.5" aria-hidden="true" />
        <span className="font-mono">{shortAddress(address)}</span>
        <button type="button" onClick={() => disconnect()} className="ml-1 min-h-9 rounded-full px-2 font-semibold text-muted hover:text-fg">
          Disconnect
        </button>
      </p>
    </>
  );
}
