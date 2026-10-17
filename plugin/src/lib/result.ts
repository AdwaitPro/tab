import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { ApiError } from "./api.js";
import { findCause } from "./chain.js";
import { NetError, ToolError } from "./errors.js";
import { log } from "./log.js";
import type { proposeEvm } from "../paybox.js";

export type EvmProposal = ReturnType<typeof proposeEvm>;

export interface AgentHints {
  summary: string;
  next_actions: string[];
  links: Record<string, string>;
}

/**
 * Proposal tools: structuredContent is exactly the starter envelope; content[0] is the exact, non-promotional
 * explanation of what the transaction does; content[1] is a JSON hint block for the calling agent.
 */
export function proposalResult(proposal: EvmProposal, explanation: string, hints: AgentHints): CallToolResult {
  return {
    content: [
      { type: "text", text: `${explanation}\n\nUnsigned proposal: PayBox will simulate it and ask for approval; nothing has been signed or paid yet. It expires in 4 minutes; if it lapses, call this tool again.` },
      { type: "text", text: JSON.stringify(hints) },
    ],
    structuredContent: proposal.structuredContent,
  };
}

export function readResult<T extends Record<string, unknown>>(structured: T, text: string): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

export function errorResult(message: string, remedy?: string): CallToolResult {
  return { content: [{ type: "text", text: remedy ? `${message}\nRemedy: ${remedy}` : message }], isError: true };
}

/** Uniform error mapping + one timing log line per call. Never lets a proposal leak into an error. */
export async function runTool(tool: string, handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const result = await handler();
    log(tool, "done", { ms: Date.now() - started, outcome: result.isError ? "domain_error" : "ok" });
    return result;
  } catch (error) {
    const ms = Date.now() - started;
    if (error instanceof ToolError) {
      log(tool, "done", { ms, outcome: error instanceof ApiError ? `api_${error.status}` : "domain_error" });
      return errorResult(error.message, error.remedy);
    }
    const net = findCause(error, NetError);
    if (net) {
      log(tool, "done", { ms, outcome: `net_${net.kind}`, host: net.host });
      return errorResult(`Network problem: ${net.message}`, "Nothing was created or sent. Retry in a few seconds.");
    }
    if (error instanceof z.ZodError) {
      log(tool, "done", { ms, outcome: "invalid_input" });
      return errorResult(`Invalid input: ${error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
    }
    log(tool, "done", { ms, outcome: "internal_error", error: error instanceof Error ? error.name : "unknown" });
    return errorResult("Tab hit an internal error; nothing was created or sent.", "Retry once; if it persists, report it.");
  }
}
