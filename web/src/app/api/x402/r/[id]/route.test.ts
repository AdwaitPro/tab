import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MIN_SCAN_BLOCK } from "@/lib/constants";
import { createPgliteDb, setDbForTesting, type Db } from "@/lib/db/client";
import { requests } from "@/lib/db/schema";
import { createRequest } from "@/lib/server/requests";
import { decodeHeaderJson, encodeHeaderJson } from "@/lib/x402/protocol";
import { PAYER, RECIPIENT } from "@/test/fixtures";
import { GET } from "./route";

let db: Db;
const TX = `0x${"cd".repeat(32)}`;
const call = (id: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/x402/r/${id}`, { headers: { "x-forwarded-for": "10.0.0.9", ...headers } }), {
    params: Promise.resolve({ id }),
  });

async function seed(expiresInMs = 3600_000) {
  return createRequest(db, {
    recipient: RECIPIENT,
    amountAtomic: 50_000n,
    memo: "Chai",
    payerLabel: null,
    requesterLabel: null,
    expiresAt: new Date(Date.now() + expiresInMs),
    startBlock: MIN_SCAN_BLOCK,
  });
}

beforeEach(async () => {
  db = await createPgliteDb();
  setDbForTesting(db);
});
afterAll(() => setDbForTesting(undefined));

describe("GET /api/x402/r/:id", () => {
  it("answers 402 with v1 body and v2 PAYMENT-REQUIRED header", async () => {
    const r = await seed();
    const res = await call(r.id);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(1);
    expect(body.accepts[0]).toMatchObject({ maxAmountRequired: r.unique_atomic, payTo: RECIPIENT, network: "base" });
    const v2 = decodeHeaderJson(res.headers.get("payment-required") ?? "") as { accepts: Array<{ amount: string }> };
    expect(v2.accepts[0].amount).toBe(r.unique_atomic);
  });

  it("answers 402 with an error for a malformed payment header", async () => {
    const r = await seed();
    const res = await call(r.id, { "X-PAYMENT": encodeHeaderJson({ x402Version: 1 }) });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/Malformed/);
  });

  it("404s unknown and 410s expired requests", async () => {
    expect((await call("0000000000000000000000")).status).toBe(404);
    const r = await seed(1000);
    await db.update(requests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(requests.id, r.id));
    expect((await call(r.id)).status).toBe(410);
  });

  it("returns a 200 receipt with X-PAYMENT-RESPONSE for an already-paid request", async () => {
    const r = await seed();
    await db
      .update(requests)
      .set({ status: "paid", paidTx: TX, paidLogIndex: 0, paidAt: new Date(), payerAddress: PAYER })
      .where(eq(requests.id, r.id));
    const res = await call(r.id);
    expect(res.status).toBe(200);
    expect((await res.json()).payment).toMatchObject({ rail: "x402", tx: TX, payer: PAYER });
    expect(decodeHeaderJson(res.headers.get("x-payment-response") ?? "")).toMatchObject({ success: true, transaction: TX });
  });
});
