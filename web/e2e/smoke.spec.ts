import { expect, test } from "@playwright/test";

const KEY = process.env.TAB_PLUGIN_KEY;

test("pay page shows the exact amount, never the odometer strip", async ({ page, request }) => {
  test.skip(!KEY, "TAB_PLUGIN_KEY is required to create a request");
  const res = await request.post("/api/requests", {
    headers: { authorization: `Bearer ${KEY}` },
    data: {
      recipient: "0xbeff1786a7ad59a8d62d46ee8d31dfb9a7a73d2e",
      amount_atomic: "100000",
      memo: "e2e coffee",
      requester_label: "Adwait",
      expires_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      start_block: "52738600",
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };

  // First paint (server HTML) carries the plain amount, not digit strips.
  const html = await (await request.get(`/r/${id}`)).text();
  expect(html).toMatch(/>0\.10<\/span>/);
  expect(html).not.toContain("0123456789");

  await page.goto(`/r/${id}`);
  const amount = page.getByText("USDC", { exact: true }).first().locator("xpath=..");
  await expect(amount).toBeVisible();
  await page.waitForTimeout(1800);
  // The digit strips exist in the DOM but must be clipped: the amount row stays one line high and inside the card.
  const box = await amount.boundingBox();
  const card = await page.locator(".ticket").first().boundingBox();
  expect(box?.height ?? 999).toBeLessThan(140);
  expect((box?.x ?? 0) >= (card?.x ?? 0) && (box?.x ?? 0) + (box?.width ?? 0) <= (card?.x ?? 0) + (card?.width ?? 0)).toBe(true);
  await expect(page.locator(".sr-only", { hasText: /^0\.10$/ })).toHaveCount(1);
});

test("brand fonts load", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    accent: getComputedStyle(document.querySelector(".serif-accent") as Element).fontFamily,
    satoshi: document.fonts.check("700 16px satoshi") || [...document.fonts].some((f) => /satoshi/i.test(f.family) && f.status === "loaded"),
    serif: [...document.fonts].some((f) => /instrument/i.test(f.family) && f.status === "loaded"),
  }));
  expect(fonts.body.toLowerCase()).toContain("satoshi");
  expect(fonts.accent.toLowerCase()).toContain("instrument");
  expect(fonts.satoshi).toBe(true);
  expect(fonts.serif).toBe(true);
});
