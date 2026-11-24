// Auto-saved drafts (owner's decisions doc L1, 2026-11-20): Add Payment keeps what is typed - and
// the file picked - in this browser 2 seconds after the last change (localStorage, the file in
// IndexedDB), and puts it back at once when it opens again - no notice, nothing to pick (the
// user, 2026-11-24). Only Save as Draft or Confirm writes the request, and that clears the copy.
//
// STUBBED - every `/api/v1/**` call is answered from the fixtures, so this needs `npm run dev`
// and nothing else. A real reload in between, so the real IndexedDB store is what round-trips
// the file. Phone first (360), then the desktop width.

import { expect, test, type Page } from "@playwright/test";

import { bill } from "../lib/__fixtures__/bills";
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

async function openList(page: Page, drafts: unknown[]) {
  await stubFlaskHub(page);
  await stubApi(page, {
    extra: {
      "/bills/suggested-reference/": { body: { reference: "PR-E2E-18" } },
      "/bills/extract/status/": { body: { enabled: false } },
      "/bills/draft/": { status: 201, body: bill({ id: "bill-draft-18", status: "draft" }) },
    },
  });
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/bills/draft/")) drafts.push(req.url());
  });
  await handoff(page, creds(), pagesOf(creds()).list);
}

async function openAddPayment(page: Page) {
  await page.getByRole("button", { name: /Add Payment/ }).click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#pr-bill-no")).toHaveValue("PR-E2E-18");
  return dialog;
}

test.beforeEach(async () => {
  await requireNextOnly();
});

for (const size of [
  { width: 360, height: 740 },
  { width: 1440, height: 900 },
]) {
  test(`Add Payment keeps what was typed across a reload, and puts it back at once (${size.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const drafts: unknown[] = [];
    await openList(page, drafts);

    let dialog = await openAddPayment(page);
    await dialog.locator("#pr-description").fill("Printer paper");
    await dialog.locator("#pr-amount").fill("1234.50");
    await dialog.locator('input[type="file"]').first().setInputFiles(PDF);
    await expect(dialog.getByRole("button", { name: "Preview invoice.pdf" })).toBeVisible();
    // kept 2 seconds after the last change; nothing sent
    await page.waitForTimeout(2500);
    expect(drafts).toHaveLength(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    dialog = await openAddPayment(page);

    await expect(dialog.locator("#pr-description")).toHaveValue("Printer paper");
    await expect(dialog.locator("#pr-amount")).toHaveValue("1,234.50");
    await expect(dialog.getByRole("button", { name: "Preview invoice.pdf" })).toBeVisible();
    await expect(dialog.locator("#pr-bill-no")).toHaveValue("PR-E2E-18");
    // nothing about the draft is drawn
    await expect(dialog.getByText(/unsaved changes/)).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Restore" })).toHaveCount(0);
    await expectNoSideScroll(page, size.width);
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/prw-draft-${size.width}.png` });

    await dialog.getByRole("button", { name: "Save as Draft" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(drafts).toHaveLength(1);

    dialog = await openAddPayment(page);
    await expect(dialog.locator("#pr-description")).toHaveValue("");
  });
}
