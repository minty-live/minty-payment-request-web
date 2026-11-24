// The invoice reader is read only on a press (owner, 2026-11-18): staging an invoice reads
// nothing; "Read invoice" appears under the drop zone when the API says the reader is on, with the
// company's AI allowance left beside it, and reads the file the person selected
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

/** The company's AI allowance, shared with Petty Cash (owner, 2026-11-18). */
const OPEN = {
  enabled: true,
  reads_used: null,
  reads_limit: null,
  reads_left: null,
  percent_left: 80,
  blocked: false,
  resumes_at: null,
};

/** Opens Add Payment with the reader switched on or off; counts the reads. */
async function openAddDialog(page: Page, enabled: boolean, answer: unknown = READ) {
  const reads: string[] = [];
  await stubFlaskHub(page);
  await stubApi(page, {
    extra: {
      "/bills/suggested-reference/": { body: { reference: "PR-E2E-17" } },
      "/bills/extract/status/": { body: enabled ? OPEN : { enabled: false } },
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
      body: JSON.stringify(answer),
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
  test(`staging reads nothing; "Read invoice" reads it (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize(size);
    const { dialog, reads } = await openAddDialog(page, true);

    await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
    const button = dialog.getByRole("button", { name: "Read invoice" });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(button).toHaveAccessibleDescription("80% of your AI allowance left");
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
    // owner, 2026-11-19: the caution under the filled fields, read with Confirm
    const caution = dialog.getByText("AI suggestions may be inaccurate.", { exact: true });
    await expect(caution).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm" })).toHaveAccessibleDescription(
      /^AI suggestions may be inaccurate/,
    );
    await expectNoSideScroll(page, size.width);
    await caution.scrollIntoViewIfNeeded();
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-caution-${size.width}.png` });
  });
}

test("the reader switched off on the API offers no button", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const { dialog, reads } = await openAddDialog(page, false);

  await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
  await expect(dialog.getByRole("button", { name: "Preview invoice.pdf" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Read invoice" })).toHaveCount(0);
  expect(reads).toHaveLength(0);
});

test("with two files the person chooses which one is read (360px)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const { dialog, reads } = await openAddDialog(page, true);
  const input = dialog.locator('input[type="file"]').first();
  await input.setInputFiles(PDF);
  await input.setInputFiles({ ...PDF, name: "statement.pdf" });

  await expect(
    dialog.getByText("Reads statement.pdf. To read another file, select it above."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Preview invoice.pdf" }).click();
  await expect(
    dialog.getByText("Reads invoice.pdf. To read another file, select it above."),
  ).toBeVisible();
  await expectNoSideScroll(page, 360);
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-choose-file-360.png` });
  await dialog.getByRole("button", { name: "Read invoice" }).click();

  await expect(dialog.locator("#pr-amount")).toHaveValue("1,200.50");
  expect(reads).toHaveLength(1);
  expect(reads[0]).toContain('filename="invoice.pdf"');
});

// Owner, 2026-11-19: an invoice in another currency comes back converted at Frankfurter's rate.
const CONVERTED = {
  suggestions: {
    ...READ.suggestions,
    amount: field("96.82"),
    currency: "USD",
    exchange: {
      original_currency: "USD",
      original_amount: "12.34",
      rate: "7.846",
      rate_date: "2026-11-13",
      date_basis: "receipt",
      source: "Frankfurter",
    },
  },
  reason: null,
};

for (const size of [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`a USD invoice fills the converted amount and says how (${size.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const { dialog } = await openAddDialog(page, true, CONVERTED);
    await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
    await dialog.getByRole("button", { name: "Read invoice" }).click();

    const amount = dialog.locator("#pr-amount");
    await expect(amount).toHaveValue("96.82");
    await expect(amount).toHaveAccessibleDescription(
      "Suggested from the invoice. Converted from USD\u00a012.34 at 1 USD = 7.85 HKD (13 Nov 2026 rate).",
    );
    const caution = dialog.locator("#pr-ai-caution");
    await expect(caution).toHaveText("AI suggestions may be inaccurate."); // one sentence (owner, 2026-11-23)
    await expectNoSideScroll(page, size.width);
    await amount.scrollIntoViewIfNeeded();
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-fx-${size.width}.png` });
  });
}

// The owner's launch decisions, 2026-11-23 (IRD "A Guide to Keeping Business Records").
for (const size of [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`an invoice that doesn't say what was paid for fills nothing and says why (${size.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const { dialog } = await openAddDialog(page, true, {
      suggestions: null,
      reason: "no_description",
    });
    await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
    await dialog.getByRole("button", { name: "Read invoice" }).click();

    const line = dialog.getByText(
      "We can't tell what this payment was for, so this document isn't sufficient as an invoice. Please attach a receipt or invoice that shows the goods or services.",
    );
    await expect(line).toBeVisible();
    await expect(dialog.locator("#pr-amount")).toHaveValue("");
    await expectNoSideScroll(page, size.width);
    await line.scrollIntoViewIfNeeded();
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-no-evidence-${size.width}.png` });
  });

  test(`several invoices in one file ask for one at a time (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize(size);
    const { dialog } = await openAddDialog(page, true, {
      suggestions: null,
      reason: "several_documents",
    });
    await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
    await dialog.getByRole("button", { name: "Read invoice" }).click();

    const question = page.getByRole("alertdialog", { name: "More than one invoice" });
    await expect(question).toContainText(
      "This file contains more than one invoice. Please upload each invoice separately.",
    );
    await expectNoSideScroll(page, size.width);
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-several-${size.width}.png` });
    await question.getByRole("button", { name: "OK" }).click();
    await expect(question).toHaveCount(0);
    await expect(dialog.locator("#pr-amount")).toHaveValue("");
  });

  test(`required fields a read left empty are red with their sentence (${size.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const { dialog } = await openAddDialog(page, true); // amount and description only
    await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
    await dialog.getByRole("button", { name: "Read invoice" }).click();

    await expect(dialog.locator("#pr-amount")).toHaveValue("1,200.50");
    const supplierLine = dialog.getByText(
      "The supplier is still empty. Choose a supplier to continue.",
    );
    await expect(supplierLine).toBeVisible();
    await expect(
      dialog.getByText("The account is still empty. Choose an account to continue."),
    ).toBeVisible();
    await expect(dialog.getByText(/details need a look/)).toHaveCount(0);
    await expectNoSideScroll(page, size.width);
    await supplierLine.scrollIntoViewIfNeeded();
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-red-${size.width}.png` });
  });
}
