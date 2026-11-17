// "‹ Back" on a payment request's details: to the page the person came from
// (`@minty/shared/backLink`) - the list, or the other request they came from - and to the list
// when nothing in this app came before (a link, a new tab). The list's tabs and filters live in
// the page, not the address, so the list comes back at its default view.
//
// STUBBED - Next alone.

import { expect, test, type Page } from "@playwright/test";

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

const ROWS = [
  billListItem({
    id: "b-1",
    reference: "PR-0001",
    contact: "Young Bros Transport",
    status: "submitted",
    amount_due: "6000.00",
  }),
  billListItem({
    id: "b-2",
    reference: "PR-0002",
    contact: "ABC Furniture",
    status: "paid",
    amount_due: "0.00",
  }),
];

test.beforeEach(async ({ page }) => {
  await requireNextOnly();
  await stubFlaskHub(page);
  await stubApi(page, { bills: ROWS });
});

const back = (page: Page) => page.locator("header [data-back-link]");

/** The text field (input or textarea) holding `value` - Playwright has no by-value query. */
async function fieldHolding(page: Page, value: string) {
  const fields = page.locator("textarea, input");
  await expect
    .poll(async () => {
      for (let i = 0; i < (await fields.count()); i += 1)
        if (
          (await fields
            .nth(i)
            .inputValue()
            .catch(() => "")) === value
        )
          return i;
      return -1;
    })
    .toBeGreaterThan(-1);
  for (let i = 0; i < (await fields.count()); i += 1)
    if (
      (await fields
        .nth(i)
        .inputValue()
        .catch(() => "")) === value
    )
      return fields.nth(i);
  throw new Error(`no field holds ${value}`);
}

test("from another request, Back returns to that request, not the list", async ({ page }) => {
  const first = pagesOf(creds()).request("b-1", "PR-0001");
  await handoff(page, creds(), first);
  await expect(page.getByText("Young Bros Transport").first()).toBeVisible();
  // as the payment history's link to another bill does
  await page.goto(pagesOf(creds()).request("b-2", "PR-0002"));
  await expect(back(page)).toBeVisible();

  await back(page).click();
  await expect(page).toHaveURL((url) => url.pathname === new URL(first, url).pathname);
  await expect(page.getByText("Young Bros Transport").first()).toBeVisible();
});

test("from the list, Back returns to the list", async ({ page }) => {
  await handoff(page, creds(), pagesOf(creds()).list);
  await expect(page.getByRole("searchbox")).toBeVisible();
  await expect(page.getByText("Young Bros Transport").first()).toBeVisible();
  const list = page.url();

  await page.getByText("Young Bros Transport").first().click();
  await expect(
    page
      .getByRole("heading", { name: "Payment Request Details" })
      .or(page.getByText("Payment Request Details"))
      .first(),
  ).toBeVisible();
  await expect(back(page)).toHaveText(/Back/);

  await back(page).click();
  await expect(page).toHaveURL(list);
  await expect(page.getByRole("searchbox")).toBeVisible();
});

test("with nothing before it in this app, Back goes to the list", async ({ page }) => {
  await handoff(page, creds(), pagesOf(creds()).request("b-1", "PR-0001"));
  await expect(page.getByText("Young Bros Transport").first()).toBeVisible();
  // a real link to the list: what a middle-click or a new tab opens
  await expect(back(page)).toHaveAttribute("href", pagesOf(creds()).list);

  await back(page).click();
  await expect(page).toHaveURL((url) => url.pathname === pagesOf(creds()).list);
  await expect(page.getByRole("searchbox")).toBeVisible();
});

test("in edit mode, Back with a change asks first; Go Back stays, Discard changes leaves (2026-11-17)", async ({
  page,
}) => {
  const list = pagesOf(creds()).list;
  await handoff(page, creds(), list);
  await expect(page.getByText("Young Bros Transport").first()).toBeVisible();
  await page.getByText("Young Bros Transport").first().click();
  await page.getByRole("button", { name: "Edit" }).click();
  const description = await fieldHolding(page, "Corporate stationery and printer supplies");
  await description.fill("Half-typed");

  await back(page).click();
  const leave = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Go Back" }).click();
  await expect(leave).toHaveCount(0);
  await expect(description).toHaveValue("Half-typed");

  await back(page).click();
  await leave.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL((url) => url.pathname === new URL(list, url).pathname);
});
