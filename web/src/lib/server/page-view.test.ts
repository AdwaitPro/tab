import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const pv = await import("./page-view");

describe("page view helpers", () => {
  it("drops bots and empty user agents", () => {
    expect(pv.isBot("")).toBe(true);
    expect(pv.isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(pv.isBot("Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36")).toBe(false);
  });

  it("classifies devices and browsers", () => {
    expect(pv.deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari")).toBe("mobile");
    expect(pv.deviceOf("Mozilla/5.0 (iPad; CPU OS 18_0)")).toBe("tablet");
    expect(pv.deviceOf("Mozilla/5.0 (Macintosh)")).toBe("desktop");
    expect(pv.browserOf("Mozilla/5.0 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge");
    expect(pv.browserOf("Mozilla/5.0 Chrome/130.0 Safari/537.36")).toBe("Chrome");
    expect(pv.browserOf("Mozilla/5.0 Version/18.0 Safari/605.1.15")).toBe("Safari");
  });

  it("keeps only the referrer host and ignores self-referrals and junk", () => {
    expect(pv.referrerHost("https://www.x.com/AdwaitKeshari/status/1?t=secret", "tab-pay.vercel.app")).toBe("x.com");
    expect(pv.referrerHost("https://tab-pay.vercel.app/r/abc", "tab-pay.vercel.app")).toBeNull();
    expect(pv.referrerHost("not a url", "tab-pay.vercel.app")).toBeNull();
    expect(pv.referrerHost(undefined, "tab-pay.vercel.app")).toBeNull();
  });

  it("decodes Vercel geo headers", () => {
    const h = new Headers({ "x-vercel-ip-city": "S%C3%A3o%20Paulo" });
    expect(pv.geoHeader(h, "x-vercel-ip-city")).toBe("São Paulo");
    expect(pv.geoHeader(h, "x-vercel-ip-country")).toBeNull();
  });

  it("hashes visitors per day without exposing the IP", () => {
    const a = pv.dailyVisitorHash("1.2.3.4", "ua", "salt", "2026-10-18");
    expect(a).toHaveLength(24);
    expect(a).not.toContain("1.2.3.4");
    expect(pv.dailyVisitorHash("1.2.3.4", "ua", "salt", "2026-10-19")).not.toBe(a);
  });

  it("validates the beacon body strictly", () => {
    expect(pv.pageViewBody.safeParse({ path: "/" }).success).toBe(true);
    expect(pv.pageViewBody.safeParse({ path: "https://evil" }).success).toBe(false);
    expect(pv.pageViewBody.safeParse({ path: "/", extra: 1 }).success).toBe(false);
  });
});
