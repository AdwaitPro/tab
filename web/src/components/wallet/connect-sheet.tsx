"use client";

import { ChevronRight, Loader2, Wallet } from "lucide-react";
import { useConnect, useConnectors } from "wagmi";
import { Sheet } from "@/components/ui/sheet";
import { errorMessage } from "@/lib/wallet-errors";

export function ConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { mutate: connect, isPending, variables, error, reset } = useConnect();
  const hasInjected = typeof window !== "undefined" && "ethereum" in window;

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Connect a wallet"
      description="Any wallet on Base works"
    >
      <ul className="flex flex-col gap-2">
        {connectors.map((connector) => {
          const isInjected = connector.type === "injected";
          const disabled = isInjected && !hasInjected;
          const pending = isPending && variables?.connector === connector;
          const name = isInjected ? (connector.name === "Injected" ? "Browser wallet" : connector.name) : connector.name;
          return (
            <li key={connector.uid}>
              <button
                type="button"
                disabled={disabled || isPending}
                onClick={() => connect({ connector }, { onSuccess: onClose })}
                className="press flex min-h-16 w-full items-center gap-3 rounded-[20px] bg-surface-2 px-4 text-left ring-1 ring-inset ring-line hover:bg-surface-3 disabled:opacity-50"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                  {connector.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data: URI icon
                    <img src={connector.icon} alt="" className="size-6 rounded-md" />
                  ) : (
                    <Wallet className="size-5" aria-hidden="true" />
                  )}
                </span>
                <span className="flex-1">
                  <span className="block text-[16px] font-semibold">{name}</span>
                  <span className="block text-[13px] text-muted">
                    {isInjected
                      ? hasInjected
                        ? "Zerion, Rabby, MetaMask and in-app browsers"
                        : "Open this link in your wallet app"
                      : "Mobile app or browser extension"}
                  </span>
                </span>
                {pending ? (
                  <Loader2 className="spin size-5 text-muted" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-5 text-subtle" aria-hidden="true" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
          {errorMessage(error)}
        </p>
      )}
    </Sheet>
  );
}
