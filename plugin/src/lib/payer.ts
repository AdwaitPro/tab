import type { Address } from "viem";

import { findCause } from "./chain.js";
import type { ToolContext } from "./context.js";
import { NetError, ToolError } from "./errors.js";
import { log } from "./log.js";

/**
 * Records who is expected to pay a request (POST /api/requests/:id/payer) so the payer's "you owe" list works.
 * Purely informational metadata: the server only fills an unknown payer, and payment truth stays on-chain, so any
 * failure is logged and ignored.
 */
export async function bestEffortSetPayer(ctx: ToolContext, requestId: string, payer: Address): Promise<boolean> {
  try {
    await ctx.api().setPayer(requestId, payer);
    return true;
  } catch (error) {
    if (error instanceof ToolError || findCause(error, NetError)) {
      log("payer", "set_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return false;
    }
    throw error;
  }
}

export function payAnyAgent(uniqueDisplay: string, recipient: Address): string {
  return `Any agent can pay this without Tab: send exactly ${uniqueDisplay} USDC on Base to ${recipient}. In PayBox that's request_transfer.`;
}
