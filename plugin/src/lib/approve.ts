import { encodeFunctionData, erc20Abi, type Address } from "viem";

import { formatUsdc } from "./amount.js";
import { CHAIN, DEPOSIT_URL, USDC } from "./constants.js";
import type { ToolContext } from "./context.js";
import { ToolError } from "./errors.js";
import { proposalResult } from "./result.js";
import { proposeEvm } from "../paybox.js";
import type { CallToolResult } from "@modelcontextprotocol/server";

export interface FundingCheck {
  allowance: bigint;
  balance: bigint;
}

/** Reads what an approve-then-act flow needs and fails early on a balance that could never fund the lock. */
export async function checkFunding(ctx: ToolContext, owner: Address, escrow: Address, amount: bigint): Promise<FundingCheck> {
  const [allowance, balance] = await Promise.all([ctx.chain.usdcAllowance(owner, escrow), ctx.chain.usdcBalance(owner)]);
  if (balance < amount) {
    throw new ToolError(`Insufficient USDC: ${owner} holds ${formatUsdc(balance)} USDC on Base but ${formatUsdc(amount)} is needed.`,
      `Top up USDC on Base at ${DEPOSIT_URL}, then call this tool again.`);
  }
  return { allowance, balance };
}

/**
 * Step 1 of 2: an approve for EXACTLY `amount` (never unlimited). PayBox sends one call per proposal and does not
 * add approvals itself, so the agent re-calls the same tool after this confirms to get the step-2 proposal.
 */
export function approveProposal(escrow: Address, amount: bigint, purpose: string, retry: string, link?: string, briefing?: string): CallToolResult {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, amount] });
  const proposal = proposeEvm({ chain: CHAIN, to: USDC, value: "0", data });
  return proposalResult(proposal,
    `Step 1 of 2: allow TabEscrow (${escrow}) to move exactly ${formatUsdc(amount)} USDC (${amount.toString()} base units) ` +
    `from your wallet, for ${purpose.replace(/\.+$/, "")}. Calls USDC.approve on ${USDC}. This grants an allowance of exactly that amount ` +
    `(not unlimited) and moves no funds by itself.${briefing ? `\n\nWhat you are agreeing to: ${briefing}` : ""}`,
    {
      summary: `USDC approve of exactly ${formatUsdc(amount)} to TabEscrow (step 1 of 2)`,
      next_actions: [
        "Show the explanation; the user approves it in PayBox.",
        "Wait until the PayBox request is confirmed on-chain.",
        retry,
      ],
      links: link ? { page: link } : {},
    });
}
