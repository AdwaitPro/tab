import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { formatUnitsExact } from "../lib/amount.js";
import { ASSETS, FEEDS, type Asset } from "../lib/constants.js";
import type { ToolContext } from "../lib/context.js";
import { ToolError } from "../lib/errors.js";
import { readResult } from "../lib/result.js";
import { isoSeconds } from "../lib/time.js";

export const quoteInput = z.object({
  asset: z.enum(ASSETS).describe("ETH or BTC (priced in USD)."),
}).strict();

export const quoteOutput = z.object({
  asset: z.enum(ASSETS),
  pair: z.string(),
  price: z.string().describe("Exact decimal USD price from the feed."),
  price_raw: z.string().describe("Raw int256 answer in feed decimals."),
  decimals: z.number().int(),
  updated_at: z.string(),
  age_seconds: z.number().int(),
  feed: z.string(),
  source: z.literal("Chainlink Data Feeds on Base"),
}).strict();

export const quoteTool = {
  name: "tab_quote",
  title: "Live Chainlink price",
  description:
    "Read the live Chainlink USD price for ETH or BTC on Base. Use before bet_create to phrase a price bet " +
    "(pick a sensible threshold) or whenever the user asks for the current price that Tab bets settle against. " +
    "Read-only; no wallet needed. Returns the exact decimal price, raw answer, feed decimals, and update time.",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
} as const;

export async function readPrice(ctx: ToolContext, asset: Asset) {
  const feed = FEEDS[asset];
  const round = await ctx.chain.feedRound(feed.address);
  if (round.answer <= 0n) throw new ToolError(`${feed.pair} feed returned a non-positive price; try again later.`);
  return { feed, round };
}

export async function quote(input: z.infer<typeof quoteInput>, ctx: ToolContext): Promise<CallToolResult> {
  const { feed, round } = await readPrice(ctx, input.asset);
  const price = formatUnitsExact(round.answer, round.decimals, 2);
  const age = Math.max(0, Math.floor(ctx.now() / 1000) - Number(round.updatedAt));
  const structured = {
    asset: input.asset,
    pair: feed.pair,
    price,
    price_raw: round.answer.toString(),
    decimals: round.decimals,
    updated_at: isoSeconds(round.updatedAt),
    age_seconds: age,
    feed: feed.address,
    source: "Chainlink Data Feeds on Base" as const,
  };
  return readResult(structured, `${feed.pair} = $${price} (Chainlink on Base, updated ${age}s ago at ${structured.updated_at}).`);
}
