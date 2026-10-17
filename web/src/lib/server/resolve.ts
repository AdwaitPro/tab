import "server-only";
import { getAddress } from "viem";
import type { Db } from "../db/client";
import { isId } from "../ids";
import { decodePayloadId, PAYLOAD_PREFIX } from "../payload";
import { liveChain } from "./chain-deps";
import { payloadToRecord, type RequestRecord, type StatusRecord } from "./records";
import { getRequestRow, payloadStatus, refreshRequestStatus } from "./requests";
import { toRequestRecord } from "./records";

export type ResolvedRequest =
  | { source: "db"; record: RequestRecord }
  | { source: "payload"; record: RequestRecord };

/** Looks up a stored request, or decodes and integrity-checks an offline `p.` link. */
export async function resolveRequest(db: Db | null, id: string): Promise<ResolvedRequest | null> {
  if (id.startsWith(PAYLOAD_PREFIX)) {
    const decoded = decodePayloadId(id);
    return decoded.ok ? { source: "payload", record: payloadToRecord(id, decoded.payload) } : null;
  }
  if (!isId(id) || !db) return null;
  const row = await getRequestRow(db, id);
  return row ? { source: "db", record: toRequestRecord(row) } : null;
}

export async function resolveStatus(db: Db, id: string): Promise<StatusRecord | null> {
  if (id.startsWith(PAYLOAD_PREFIX)) {
    const decoded = decodePayloadId(id);
    if (!decoded.ok) return null;
    const p = decoded.payload;
    return payloadStatus(
      {
        id,
        recipient: getAddress(p.r),
        uniqueAtomic: BigInt(p.u),
        startBlock: BigInt(p.b),
        expiresAt: new Date(p.e * 1000),
      },
      liveChain(),
    );
  }
  if (!isId(id)) return null;
  const row = await getRequestRow(db, id);
  return row ? refreshRequestStatus(db, row, liveChain()) : null;
}
