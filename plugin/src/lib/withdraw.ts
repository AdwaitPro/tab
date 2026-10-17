import type { CallToolResult } from "@modelcontextprotocol/server";
import { encodeFunctionData, type Address } from "viem";

import { formatUsdc } from "./amount.js";
import { requireEscrow } from "./config.js";
import { CHAIN } from "./constants.js";
import type { ToolContext } from "./context.js";
import { ToolError } from "./errors.js";
import { tabEscrowAbi } from "./escrowAbi.js";
import { proposalResult } from "./result.js";
import { simulateOrThrow } from "./revert.js";
import { proposeEvm } from "../paybox.js";

/**
 * TabEscrow v2 credits a payout to `owed[user]` when a direct USDC transfer fails (e.g. a blocklisted recipient at
 * the time). `withdraw()` pulls the whole credited balance to the caller.
 */
export async function withdrawProposal(ctx: ToolContext, caller: Address): Promise<CallToolResult> {
  const escrow = requireEscrow(ctx.config);
  const owed = await ctx.chain.owed(escrow, caller);
  if (owed === 0n) throw new ToolError(`TabEscrow owes ${caller} nothing; there is nothing to withdraw.`);
  const data = encodeFunctionData({ abi: tabEscrowAbi, functionName: "withdraw" });
  await simulateOrThrow(ctx, caller, escrow, data, "withdraw");
  return proposalResult(proposeEvm({ chain: CHAIN, to: escrow, value: "0", data }),
    `Calls TabEscrow.withdraw() on ${escrow} from ${caller}: transfers the ${formatUsdc(owed)} USDC (${owed.toString()} base units) that TabEscrow ` +
    "holds for you from an earlier payout that could not be delivered directly. Sends no ETH and grants no allowance.",
    {
      summary: `TabEscrow.withdraw of ${formatUsdc(owed)} USDC to ${caller}`,
      next_actions: ["Show the explanation; the user approves in PayBox.", `After confirmation, tab_list for ${caller} should show nothing owed.`],
      links: {},
    });
}

export async function readOwed(ctx: ToolContext, user: Address): Promise<bigint> {
  return ctx.chain.owed(requireEscrow(ctx.config), user);
}

