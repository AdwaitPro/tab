import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { isAuthorizedBearer } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { indexEscrow } from "@/lib/server/indexer";

export const maxDuration = 30;

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
const handler = route("GET /api/cron/index-escrow", async (request: Request) => {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    throw new ApiError("unauthorized", "Missing or invalid cron secret");
  }
  const result = await indexEscrow(await getDb(), { budgetMs: 20_000 });
  return json(result);
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handler(request, undefined);
}
