// No Publish while a request is being edited (2026-11-20): a publish sends what is saved, not
// what is being typed, so the payment actions menu greys Publish and says why beside it, at a
// phone and a desktop width.
//
// STUBBED - Next alone.

import { expect, test } from "@playwright/test";

import { billListItem } from "../lib/__fixtures__/bills";
import {
  handoff,
  pagesOf,
  requireNextOnly,
  stubApi,
  stubCredentials,
  stubFlaskHub,
} from "./helpers";

const creds = () => stubCredentials();
const REASON = "Save your changes first, then publish.";

test.beforeEach(async ({ page }) => {
  await requireNextOnly();
  await stubFlaskHub(page);
  await stubApi(page, {
    bills: [
      billListItem({
        id: "b-1",
        reference: "PR-0001",
        contact: "Young Bros Transport",
        status: "submitted",
        amount_due: "6000.00",
      }),
    ],
  });
});

for (const width of [360, 1440]) {
  test(`at ${width}px, Publish waits for Save Changes and says so`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await handoff(page, creds(), pagesOf(creds()).request("b-1", "PR-0001"));
    await expect(page.getByText("Young Bros Transport").first()).toBeVisible();

    // Not editing: Publish is offered.
    await page.getByRole("button", { name: "More payment actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Publish" })).toBeEnabled();
    await expect(page.getByText(REASON)).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
    await page.getByRole("button", { name: "More payment actions" }).click();

    const publish = page.getByRole("menuitem", { name: "Publish" });
    await expect(publish).toBeDisabled();
    await expect(page.getByText(REASON)).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Void" })).toBeEnabled();

    // The menu, reason included, stays on screen and the page never scrolls sideways.
    const menu = await page.getByRole("menu", { name: "Payment actions" }).boundingBox();
    expect(menu).not.toBeNull();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/pr-publish-held-${width}.png` });
  });
}
