import "server-only";
import { getAddress, isAddress, type Address } from "viem";

export interface ServerEnv {
  databaseUrl: string | undefined;
  pluginKey: string | undefined;
  cronSecret: string | undefined;
  rpcUrl: string | undefined;
  escrowAddress: Address | null;
  escrowStartBlock: bigint | null;
  baseUrl: string;
}

/** Read lazily so tests and route handlers see the current process env. */
export function serverEnv(): ServerEnv {
  const escrow = process.env.NEXT_PUBLIC_TAB_ESCROW?.trim();
  const start = process.env.TAB_ESCROW_START_BLOCK?.trim();
  return {
    databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
    pluginKey: process.env.TAB_PLUGIN_KEY?.trim() || undefined,
    cronSecret: process.env.CRON_SECRET?.trim() || undefined,
    rpcUrl: process.env.BASE_RPC_URL?.trim() || undefined,
    escrowAddress: escrow && isAddress(escrow, { strict: false }) ? getAddress(escrow) : null,
    escrowStartBlock: start && /^\d+$/.test(start) ? BigInt(start) : null,
    baseUrl: publicBaseUrl(),
  };
}

export function publicBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
