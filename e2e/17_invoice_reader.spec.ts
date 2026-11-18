// The invoice reader is read only on a press (owner, 2026-11-18): staging an invoice reads
// nothing; "Read the invoice" appears under the drop zone when the API says the reader is on
// (`GET /bills/extract/status/`), and pressing it sends the file to `POST /bills/extract/`.
//
// STUBBED - every `/api/v1/**` call is answered from the fixtures, so this needs `npm run dev`
// and nothing else. Phone first (360), then the tablet and desktop widths.

import { expect, test, type Page } from "@playwright/test";

import {
  expectNoSideScroll,
  handoff,
  pagesOf,
  requireNextOnly,
  stubApi,
  stubCredentials,
  stubFlaskHub,
} from "./helpers";

const creds = () => stubCredentials();

const PDF = { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") };

const field = (value: string, extra = {}) => ({
  value,
  confidence: 0.95,
  band: "high",
  applied: true,
  ...extra,
});
const READ = {
  suggestions: {
    amount: field("1200.50"),
    description: field("Office chairs"),
    currency: "HKD",
    entity_currency: "HKD",
  },
  reason: null,
};

/** Opens Add Payment with the reader switched on or off; counts the reads. */
async function openAddDialog(page: Page, enabled: boolean) {
  const reads: string[] = [];
  await stubFlaskHub(page);
  await stubApi(page, {
    extra: {
      "/bills/suggested-reference/": { body: { reference: "PR-E2E-17" } },
      "/bills/extract/status/": { body: { enabled } },
    },
  });
  // registered last, so it answers the read before the stub's catch-all
  await page.route("**/api/v1/bills/extract/", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    reads.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(READ),
    });
  });
  await handoff(page, creds(), pagesOf(creds()).list);
  await page.getByRole("button", { name: /Add Payment/ }).click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  return { dialog, reads };
}

test.beforeEach(async () => {
  await requireNextOnly();
});

for (const size of [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`staging reads nothing; "Read the invoice" reads it (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize(size);
    const { dialog, reads } = await openAddDialog(page, true);

    await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
    const button = dialog.getByRole("button", { name: "Read the invoice" });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(reads).toHaveLength(0);
    await expectNoSideScroll(page, size.width);
    await button.scrollIntoViewIfNeeded();
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-read-${size.width}.png` });

    await button.click();
    await expect(dialog.locator("#pr-amount")).toHaveValue("1,200.50");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('name="invoice"; filename="invoice.pdf"');
    await expect(button).toHaveCount(0);
  });
}

test("the reader switched off on the API offers no button", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const { dialog, reads } = await openAddDialog(page, false);

  await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
  await expect(dialog.getByRole("button", { name: "Preview invoice.pdf" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Read the invoice" })).toHaveCount(0);
  expect(reads).toHaveLength(0);
});
