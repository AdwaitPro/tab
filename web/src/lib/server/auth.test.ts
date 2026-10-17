import { describe, expect, it } from "vitest";
import { isAuthorizedBearer } from "./auth";
import { TokenBucketLimiter } from "./rate-limit";

const KEY = "k_0123456789abcdef0123456789";

describe("isAuthorizedBearer", () => {
  it("accepts only the exact bearer key", () => {
    expect(isAuthorizedBearer(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(isAuthorizedBearer(`bearer ${KEY}`, KEY)).toBe(false);
    expect(isAuthorizedBearer(`Bearer ${KEY}x`, KEY)).toBe(false);
    expect(isAuthorizedBearer(KEY, KEY)).toBe(false);
    expect(isAuthorizedBearer(null, KEY)).toBe(false);
    expect(isAuthorizedBearer("Bearer ", KEY)).toBe(false);
  });

  it("fails closed when the server key is missing or weak", () => {
    expect(isAuthorizedBearer("Bearer x", undefined)).toBe(false);
    expect(isAuthorizedBearer("Bearer short", "short")).toBe(false);
  });
});

describe("TokenBucketLimiter", () => {
  it("allows capacity then refills over time", () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(() => now);
    const policy = { name: "t", capacity: 3, refillPerMinute: 60 };
    expect([1, 2, 3].map(() => limiter.take(policy, "ip").allowed)).toEqual([true, true, true]);
    const denied = limiter.take(policy, "ip");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(limiter.take(policy, "other").allowed).toBe(true);
    now += 1000;
    expect(limiter.take(policy, "ip").allowed).toBe(true);
  });
});
