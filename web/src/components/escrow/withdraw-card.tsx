"use client";

import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { base } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { formatUsdc } from "@/lib/amount";
import { tabEscrowAbi } from "@/lib/chain/tab-escrow-abi";
import { ActionCard } from "./parts";
import type { EscrowTx } from "./use-escrow-tx";

/** Payouts the contract couldn't push are parked in `owed`; anyone owed can pull them. */
export function WithdrawCard({ escrow, tx }: { escrow: Address; tx: EscrowTx }) {
  const { address } = useAccount();
  const owed = useReadContract({
    address: escrow,
    abi: tabEscrowAbi,
    functionName: "owed",
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  if (!owed.data || owed.data === 0n) return null;
  return (
    <div className="mb-3">
    <ActionCard title={`Withdraw ${formatUsdc(owed.data)} USDC`} consequence="Escrow is holding this for you, send it to your wallet">
      <Button
        block
        size="lg"
        disabled={tx.pending !== null}
        onClick={() => void tx.run({ functionName: "withdraw", args: [] }, "Withdraw").then(() => owed.refetch())}
      >
        {tx.pending === "Withdraw" ? "Withdrawing…" : "Withdraw"}
      </Button>
    </ActionCard>
    </div>
  );
}
