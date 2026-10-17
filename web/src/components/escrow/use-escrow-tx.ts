"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BaseError, decodeErrorResult, encodeFunctionData, RawContractError, type Address, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { call as ethCall, sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import { base } from "wagmi/chains";
import type { IslandState } from "@/components/pay/status-island";
import { tabEscrowAbi } from "@/lib/chain/tab-escrow-abi";
import { errorMessage, isUserRejection } from "@/lib/wallet-errors";

type EscrowFn =
  | { functionName: "markDelivered" | "release" | "claim" | "refund" | "cancelBySeller" | "dispute"; args: readonly [bigint] }
  | { functionName: "resolve"; args: readonly [bigint, number] }
  | { functionName: "joinBet" | "cancelUnjoined" | "refundStale"; args: readonly [bigint] }
  | { functionName: "settlePrice"; args: readonly [bigint, bigint] }
  | { functionName: "report" | "arbitrate"; args: readonly [bigint, Address] }
  | { functionName: "withdraw"; args: readonly [] };

export interface EscrowTx {
  run: (call: EscrowFn, label: string) => Promise<boolean>;
  pending: string | null;
  island: IslandState | null;
  error: string | null;
  lastTx: Hex | null;
}

/** Simulate (decoded custom errors before the wallet opens) → sign → wait → refresh the object query. */
export function useEscrowTx(escrow: Address, queryKey: readonly unknown[]): EscrowTx {
  const config = useConfig();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [island, setIsland] = useState<IslandState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  async function run(call: EscrowFn, label: string): Promise<boolean> {
    if (!address) return false;
    setError(null);
    setPending(label);
    try {
      const data = encodeEscrowCall(call);
      try {
        await ethCall(config, { account: address, to: escrow, data, chainId: base.id });
      } catch (e) {
        throw new Error(revertReason(e, call.functionName));
      }
      setIsland({ kind: "signing" });
      const hash = await sendTransaction(config, { to: escrow, data, chainId: base.id });
      setLastTx(hash);
      setIsland({ kind: "confirming" });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: base.id });
      if (receipt.status !== "success") throw new Error("Transaction failed on Base");
      setIsland({ kind: "paid", text: `${label} ✓` });
      await queryClient.invalidateQueries({ queryKey });
      setTimeout(() => setIsland(null), 3500);
      return true;
    } catch (e) {
      setIsland(null);
      setError(isUserRejection(e) ? "Cancelled in your wallet, nothing changed" : errorMessage(e));
      return false;
    } finally {
      setPending(null);
    }
  }

  return { run, pending, island, error, lastTx };
}

function encodeEscrowCall(call: EscrowFn): Hex {
  switch (call.functionName) {
    case "resolve":
      return encodeFunctionData({ abi: tabEscrowAbi, functionName: "resolve", args: call.args });
    case "settlePrice":
      return encodeFunctionData({ abi: tabEscrowAbi, functionName: "settlePrice", args: call.args });
    case "report":
      return encodeFunctionData({ abi: tabEscrowAbi, functionName: "report", args: call.args });
    case "arbitrate":
      return encodeFunctionData({ abi: tabEscrowAbi, functionName: "arbitrate", args: call.args });
    case "withdraw":
      return encodeFunctionData({ abi: tabEscrowAbi, functionName: "withdraw" });
    default:
      return encodeFunctionData({ abi: tabEscrowAbi, functionName: call.functionName, args: call.args });
  }
}

const REVERT_TEXT: Record<string, string> = {
  TooEarly: "Not yet, this opens later",
  TooLate: "Too late, the deadline passed",
  JoinClosed: "Joining closed",
  NotInvited: "This bet is for someone else",
  InvalidState: "Not available right now",
  PriceNotFinal: "Chainlink price not final yet, retry in a few minutes",
  SequencerDown: "Base sequencer is down, retry later",
  StalePrice: "Chainlink price is stale, retry later",
  NotFirstRound: "Price round changed, refresh and retry",
  RoundNotProvable: "This price round can't be proven, refund opens 3 days after resolve time",
  NotBuyer: "Only the buyer can do this",
  NotSeller: "Only the seller can do this",
  NotParty: "Only the two of you can do this",
  NotCreator: "Only the creator can do this",
  NotArbiter: "Only the arbiter can do this",
  ArbitrationNotAllowed: "The arbiter steps in after a conflict or 2 days",
  NoArbiter: "No arbiter on this deal, so no disputes",
  InvalidCounterparty: "You can't bet against yourself",
  SafeERC20FailedOperation: "USDC transfer failed, check balance and approval",
};

function revertReason(e: unknown, fn: EscrowFn["functionName"]): string {
  if (e instanceof BaseError) {
    const raw = e.walk((x) => x instanceof RawContractError);
    const data = raw instanceof RawContractError ? raw.data : undefined;
    const hex = typeof data === "string" ? data : (data as { data?: Hex } | undefined)?.data;
    if (hex && hex.length >= 10) {
      try {
        const decoded = decodeErrorResult({ abi: tabEscrowAbi, data: hex });
        if (fn === "dispute" && decoded.errorName === "TooLate") return "Dispute window closed";
        return REVERT_TEXT[decoded.errorName] ?? `The contract would reject this (${decoded.errorName})`;
      } catch {
        // Unknown selector: fall through to the generic message.
      }
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : "This transaction would fail";
}
