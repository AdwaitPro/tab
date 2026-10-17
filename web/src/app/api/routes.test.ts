import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import { createPgliteDb, setDbForTesting } from "@/lib/db/client";
import { encodePayloadId } from "@/lib/payload";
import { RECIPIENT } from "@/test/fixtures";
import { POST as createRequestRoute } from "./requests/route";
import { GET as getRequestRoute } from "./requests/[id]/route";
import { POST as createSplitRoute } from "./splits/route";
import { GET as getSplitRoute } from "./splits/[id]/route";
import { POST as createTermsRoute } from "./terms/route";

const KEY = "test_plugin_key_0123456789abcdef";
const ORIGIN = "http://localhost";
const future = () => new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

function post(path: string, body: unknown, auth: string | null = `Bearer ${KEY}`): Request {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" };
  if (auth) headers.authorization = auth;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
const get = (path: string) => new Request(`${ORIGIN}${path}`, { headers: { "x-forwarded-for": "10.0.0.2" } });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

const validRequest = () => ({
  recipient: RECIPIENT.toLowerCase(),
  amount_atomic: "2000000",
  memo: "Dinner at Toit",
  payer_label: "Meera",
  requester_label: "Adwait",
  expires_at: future(),
  start_block: "52737334",
});

beforeAll(() => {
  process.env.TAB_PLUGIN_KEY = KEY;
});
afterAll(() => setDbForTesting(undefined));
beforeEach(async () => setDbForTesting(await createPgliteDb()));

describe("POST /api/requests", () => {
  it("creates a request with the contract shape", async () => {
    const res = await createRequestRoute(post("/api/requests", validRequest()), undefined);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      recipient: RECIPIENT,
      amount_atomic: "2000000",
      memo: "Dinner at Toit",
      status: "open",
      start_block: "52737334",
      split_id: null,
      signature: null,
      paid_tx: null,
      payer_address: null,
    });
    expect(body.id).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const read = await getRequestRoute(get(`/api/requests/${String(body.id)}`), params({ id: String(body.id) }));
    expect(await read.json()).toEqual(body);
  });

  it("requires the bearer key", async () => {
    expect((await createRequestRoute(post("/api/requests", validRequest(), null), undefined)).status).toBe(401);
    const wrong = await createRequestRoute(post("/api/requests", validRequest(), "Bearer nope"), undefined);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it.each([
    ["unknown field", { extra: true }],
    ["float amount", { amount_atomic: "2.5" }],
    ["zero amount", { amount_atomic: "0" }],
    ["number amount", { amount_atomic: 2000000 }],
    ["over cap", { amount_atomic: "1000000001" }],
    ["bad address", { recipient: "0x123" }],
    ["past expiry", { expires_at: "2020-01-01T00:00:00Z" }],
    ["non-UTC expiry", { expires_at: "2030-01-01T00:00:00+05:30" }],
    ["long memo", { memo: "x".repeat(141) }],
    ["long label", { payer_label: "x".repeat(41) }],
  ])("rejects %s", async (_name, patch) => {
    const res = await createRequestRoute(post("/api/requests", { ...validRequest(), ...patch }), undefined);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_input");
  });

  it("rejects non-JSON bodies", async () => {
    const req = new Request(`${ORIGIN}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: "{not json",
    });
    expect((await createRequestRoute(req, undefined)).status).toBe(400);
  });
});

describe("splits", () => {
  it("creates and reads a split in body order", async () => {
    const res = await createSplitRoute(
      post("/api/splits", {
        recipient: RECIPIENT,
        total_atomic: "6000000",
        memo: "Dinner",
        requester_label: "Adwait",
        expires_at: future(),
        start_block: "1",
        requests: [
          { payer_label: "Meera", amount_atomic: "2000000" },
          { payer_label: "Aarav", amount_atomic: "2000000" },
        ],
      }),
      undefined,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { split: { id: string }; requests: Array<{ payer_label: string; split_id: string }> };
    expect(body.requests.map((r) => r.payer_label)).toEqual(["Meera", "Aarav"]);
    expect(body.requests[0]?.split_id).toBe(body.split.id);

    const read = await getSplitRoute(get(`/api/splits/${body.split.id}`), params({ id: body.split.id }));
    const detail = (await read.json()) as { outstanding_atomic: string; collected_atomic: string };
    expect(detail.collected_atomic).toBe("0");
    expect(BigInt(detail.outstanding_atomic) > 4_000_000n).toBe(true);
  });

  it("rejects sums above the total", async () => {
    const res = await createSplitRoute(
      post("/api/splits", {
        recipient: RECIPIENT,
        total_atomic: "1000000",
        expires_at: future(),
        start_block: "1",
        requests: [{ payer_label: "Meera", amount_atomic: "2000000" }],
      }),
      undefined,
    );
    expect(res.status).toBe(400);
  });
});

describe("terms", () => {
  it("verifies the hash and is idempotent", async () => {
    const body = "Logo design, 3 concepts";
    const hash = keccak256(stringToBytes(body));
    expect((await createTermsRoute(post("/api/terms", { hash, body }), undefined)).status).toBe(201);
    expect((await createTermsRoute(post("/api/terms", { hash, body }), undefined)).status).toBe(200);
    const bad = await createTermsRoute(post("/api/terms", { hash, body: "tampered" }), undefined);
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/requests/:id", () => {
  it("404s unknown and malformed ids", async () => {
    expect((await getRequestRoute(get("/api/requests/x"), params({ id: "0000000000000000000000" }))).status).toBe(404);
    expect((await getRequestRoute(get("/api/requests/x"), params({ id: "../etc" }))).status).toBe(404);
  });

  it("synthesizes offline payload records", async () => {
    const id = encodePayloadId({
      r: RECIPIENT,
      a: "1500000",
      c: Math.floor(Date.now() / 1000),
      e: Math.floor(Date.now() / 1000) + 3600,
      b: "100",
      n: "0011223344556677",
      m: "Coffee",
      pl: "",
      rl: "Adwait",
    });
    const res = await getRequestRoute(get(`/api/requests/${id}`), params({ id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, memo: "Coffee", payer_label: null, status: "open" });
  });
});
