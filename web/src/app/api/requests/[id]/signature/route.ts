import { getDb } from "@/lib/db/client";
import { publicClient } from "@/lib/chain/rpc";
import { ApiError } from "@/lib/server/errors";
import { enforceRateLimit, json, parseBody, parseParam, route } from "@/lib/server/http";
import { CREATE_POLICY } from "@/lib/server/rate-limit";
import { attachSignature, getRequestRow } from "@/lib/server/requests";
import { toRequestRecord } from "@/lib/server/records";
import { requestIdParam, signatureBody } from "@/lib/server/schemas";
import { requestSigningMessage } from "@/lib/signature";
import { getAddress, type Hex } from "viem";

export const POST = route(
  "POST /api/requests/:id/signature",
  async (request: Request, ctx: RouteContext<"/api/requests/[id]/signature">) => {
    enforceRateLimit(request, CREATE_POLICY);
    const id = parseParam((await ctx.params).id, requestIdParam, "request id");
    const { signature } = await parseBody(request, signatureBody);
    const db = await getDb();
    const row = await getRequestRow(db, id);
    if (!row) throw new ApiError("not_found", "Request not found");
    const record = toRequestRecord(row);
    const message = requestSigningMessage({
      id: record.id,
      recipient: record.recipient,
      uniqueAtomic: record.unique_atomic,
      expiresAt: record.expires_at,
    });
    // publicClient.verifyMessage covers EOAs plus ERC-1271 / ERC-6492 smart accounts.
    const valid = await publicClient()
      .verifyMessage({ address: getAddress(record.recipient), message, signature: signature as Hex })
      .catch(() => false);
    if (!valid) throw new ApiError("invalid_input", "Signature does not recover to the recipient");
    return json(await attachSignature(db, id, signature as Hex));
  },
);
