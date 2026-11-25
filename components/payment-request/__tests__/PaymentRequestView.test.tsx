// The list screen (components/payment-request/PaymentRequestView.tsx).
//
// The list endpoint answers with a bare array and no count, so this screen WALKS it: a hundred
// rows at a time until a short page comes back, committing as it goes so the first page paints
// without waiting for the rest. That loop is what these tests are mostly about, because it has
// three stopping conditions and getting one wrong either truncates the list or spins forever.
//
// Queries are scoped to the table (see the note at the top of PaymentRequestTable.test.tsx:
// the table and the card list both render under jsdom).

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/Toast";
import { PaymentRequestView } from "@/components/payment-request/PaymentRequestView";
import { ALL_STATUSES, billList, billListItem } from "@/lib/__fixtures__/bills";
import { unsignedToken } from "@/lib/__fixtures__/tokens";
import { setAuth } from "@/lib/auth";

const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const ENTITY_NAME = "Olive & Vine";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ ref: "360812e1", slug: "olive-and-vine" }),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

// pdf.js wants a canvas; the attachment preview reaches for it through this.
vi.mock("@minty/shared/pdfPreview", () => ({
  PdfJsCanvasPreview: () => <div>pdf preview</div>,
}));

const fetchMock = vi.fn<typeof fetch>();

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Answers by path. `pages` is consulted in order for each `/bills/?page=N` the loop asks for,
 * so a test states the WHOLE conversation rather than queueing responses blind.
 */
function serve({
  pages = [ALL_STATUSES],
  onBills,
  route,
}: {
  pages?: unknown[][];
  onBills?: (page: number) => void;
  /** Answers a path before the defaults; undefined falls through to them. */
  route?: (path: string, init?: RequestInit) => Response | undefined;
} = {}) {
  const billsCalls: number[] = [];
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const routed = route?.(path, init);
    if (routed) return routed;
    if (path.endsWith("/auth/entitlements")) return answer(200, { billing_enabled: true });
    if (path.endsWith("/auth/entity-currency")) return answer(200, { currency_code: "HKD" });
    if (path.endsWith("/auth/xero-status")) return answer(200, { connected: true });
    if (path.endsWith("/profile/me")) return answer(200, { member_entity_ids: [ENTITY_ID] });
    if (path.includes("/payments")) return answer(200, { paid_total: "0.00", payments: [] });
    if (path.endsWith("/bills/")) {
      const page = Number(url.searchParams.get("page") ?? "1");
      billsCalls.push(page);
      onBills?.(page);
      return answer(200, pages[page - 1] ?? []);
    }
    return answer(200, {});
  });
  return { billsCalls };
}

const show = (easyView = false) =>
  render(
    <ToastProvider>
      <PaymentRequestView easyView={easyView} />
    </ToastProvider>,
  );

const table = () => within(screen.getByRole("table"));
const bodyRows = () => screen.getByRole("table").querySelectorAll("tbody tr");

/**
 * Wait for the list to have finished loading. NOT `bodyRows().length > 0`: the loading state
 * draws five skeleton rows, so that condition is already true before a single bill has arrived.
 */
const loaded = () =>
  waitFor(() =>
    expect(screen.getByRole("table").querySelector("tbody")).toHaveAttribute("aria-busy", "false"),
  );

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  setAuth(unsignedToken({ role: "admin", system_role: "normal" }), ENTITY_ID, ENTITY_NAME);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("walking the list", () => {
  it("asks for a hundred rows at a time", async () => {
    serve();

    show();

    await loaded();
    const billsUrl = fetchMock.mock.calls
      .map(([u]) => new URL(String(u)))
      .find((u) => u.pathname.endsWith("/bills/"))!;
    expect(billsUrl.searchParams.get("page_size")).toBe("100");
  });

  it("stops at the page that comes back short", async () => {
    const { billsCalls } = serve({
      pages: [billList(100), billList(100, {}, 101), billList(3, {}, 201)],
    });

    show();

    await loaded();
    await waitFor(() => expect(billsCalls).toContain(3));
    expect(billsCalls).not.toContain(4);
  });

  it("stops rather than looping when the backend ignores the page and repeats itself", async () => {
    // A backend that returns the same hundred rows forever would otherwise be walked all the
    // way to the two-thousand-row cap.
    const same = billList(100);
    const { billsCalls } = serve({ pages: [same, same, same, same] });

    show();

    await loaded();
    expect(billsCalls).not.toContain(3);
  });

  // CHARACTERISATION, and a finding worth acting on separately.
  //
  // The whole walk runs TWICE on every load of this screen. `loadBills` lists `entityCurrency`
  // among its dependencies, and `useEntityCurrency()` reports "" on the first render and the
  // real code once its own read resolves - so the callback is rebuilt, the effect re-runs, and
  // every page is fetched again. The currency is used only to FORMAT the amounts; it does not
  // change which rows the server would send.
  //
  // Cost: 2N requests instead of N for a list of N hundred-row pages, on every visit. Pinned,
  // not fixed - changing a dependency list is a change to the screen's behaviour, not a test.
  it("walks the WHOLE list a second time when the currency arrives", async () => {
    const { billsCalls } = serve({ pages: [billList(100), billList(2, {}, 101)] });

    show();

    await loaded();
    await waitFor(() => expect(billsCalls.filter((p) => p === 1).length).toBe(2));
    expect(billsCalls.filter((p) => p === 2).length).toBe(2);
  });
});

describe("the rows it shows", () => {
  it("are the company's payment requests, with their statuses in words", async () => {
    serve({ pages: [ALL_STATUSES] });

    show();

    await loaded();
    expect(table().getByText("Young Bros Transport")).toBeInTheDocument();
    // The API's `submitted` reads as "Payment Requested" on screen.
    expect(table().getByText("Payment Requested")).toBeInTheDocument();
    expect(table().getByText("Partially Paid")).toBeInTheDocument();
    expect(table().getByText("Paid")).toBeInTheDocument();
    expect(table().getByText("Draft")).toBeInTheDocument();
    expect(table().getByText("Returned")).toBeInTheDocument();
  });

  it("leave a voided request out until its status is asked for", async () => {
    serve({ pages: [ALL_STATUSES] });

    show();

    await loaded();
    expect(table().queryByText("Cancelled Order Inc")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Voided" }));

    await waitFor(() => expect(table().getByText("Cancelled Order Inc")).toBeInTheDocument());
  });

  it("show the amount due with the company's currency", async () => {
    serve({
      pages: [[billListItem({ id: "b1", contact: "One Supplier", amount_due: "6000.00" })]],
    });

    show();

    await waitFor(() => expect(table().getByText("HKD 6,000.00")).toBeInTheDocument());
  });

  it("say so plainly when the company has none", async () => {
    serve({ pages: [[]] });

    show();

    await waitFor(() =>
      expect(table().getByText("No payment requests match this status.")).toBeInTheDocument(),
    );
  });

  it("open the request that was clicked, at its own address", async () => {
    serve({ pages: [[billListItem({ id: "b1", contact: "One Supplier", reference: "PR-0009" })]] });
    show();
    await loaded();
    expect(bodyRows()).toHaveLength(1);

    await userEvent.click(table().getByText("One Supplier"));

    expect(push).toHaveBeenCalledWith("/entity/360812e1/olive-and-vine/payment-request/PR-0009");
  });
});

describe("a list that did not load", () => {
  it("says what went wrong in the API's own words, not 'Failed to fetch'", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/auth/entitlements")) return answer(200, { billing_enabled: true });
      if (path.endsWith("/auth/entity-currency")) return answer(200, { currency_code: "HKD" });
      if (path.endsWith("/bills/"))
        return answer(403, { detail: "You don't have access to that." });
      return answer(200, {});
    });

    show();

    expect(await screen.findByText("You don't have access to that.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("falls back to its own sentence when the failure is not the API's", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/auth/entitlements")) return answer(200, { billing_enabled: true });
      if (path.endsWith("/auth/entity-currency")) return answer(200, { currency_code: "HKD" });
      if (path.endsWith("/bills/")) throw new TypeError("Failed to fetch");
      return answer(200, {});
    });

    show();

    expect(
      await screen.findByText("Your payments didn't come through. Mind trying again?"),
    ).toBeInTheDocument();
  });

  it("tries again when asked", async () => {
    let attempt = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if (path.endsWith("/auth/entitlements")) return answer(200, { billing_enabled: true });
      if (path.endsWith("/auth/entity-currency")) return answer(200, { currency_code: "HKD" });
      if (path.includes("/payments")) return answer(200, { paid_total: "0.00", payments: [] });
      if (path.endsWith("/bills/")) {
        attempt += 1;
        if (attempt === 1) return answer(500, { detail: "boom" });
        return answer(200, [billListItem({ id: "b1", contact: "One Supplier" })]);
      }
      return answer(200, {});
    });
    show();
    await screen.findByRole("button", { name: "Retry" });

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(table().getByText("One Supplier")).toBeInTheDocument());
  });
});

describe("bank slip counts that did not load", () => {
  it("say so instead of offering an upload, and load again when asked", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let paymentsUp = false;
      fetchMock.mockImplementation(async (input) => {
        const url = new URL(String(input));
        const path = url.pathname;
        if (path.endsWith("/auth/entitlements")) return answer(200, { billing_enabled: true });
        if (path.endsWith("/auth/entity-currency")) return answer(200, { currency_code: "HKD" });
        if (path.endsWith("/attachments")) {
          return answer(200, [
            {
              id: "att-1",
              attachment_role: "bank_slip",
              sort_order: 0,
              note: "",
              created_at: "2026-10-12T02:00:00Z",
              attachment: {
                id: "f-1",
                original_name: "slip.pdf",
                mime_type: "application/pdf",
                file_size: 10,
                file_extension: "pdf",
                storage_provider: "s3",
                created_at: "2026-10-12T02:00:00Z",
                download_url: "",
              },
            },
          ]);
        }
        if (path.endsWith("/payments")) {
          if (!paymentsUp) return answer(500, { detail: "boom" });
          return answer(200, {
            paid_total: "0.00",
            payments: [
              {
                id: "pay-1",
                bill_id: "b1",
                payment_status: "completed",
                amount: "1.00",
                currency_code: "HKD",
              },
            ],
          });
        }
        if (path.endsWith("/bills/")) {
          return answer(200, [
            billListItem({ id: "b1", contact: "One Supplier", status: "submitted" }),
          ]);
        }
        return answer(200, {});
      });
      show();

      const retry = await table().findByRole("button", {
        name: "Bank slips didn't load for One Supplier — try again",
      });
      expect(table().queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
      expect(consoleError).toHaveBeenCalled();

      paymentsUp = true;
      await userEvent.click(retry);

      expect(
        await table().findByRole("button", { name: /View bank slip — 1 file uploaded/ }),
      ).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("the status filter", () => {
  it("asks the server for a single status rather than filtering in the browser", async () => {
    serve({ pages: [ALL_STATUSES] });
    show();
    await loaded();
    fetchMock.mockClear();

    await userEvent.click(screen.getByRole("tab", { name: "Draft" }));

    await waitFor(() => {
      const asked = fetchMock.mock.calls
        .map(([u]) => new URL(String(u)))
        .filter((u) => u.pathname.endsWith("/bills/"));
      expect(asked.some((u) => u.searchParams.get("status") === "draft")).toBe(true);
    });
  });
});

describe("a system superuser looking at a company they are not in", () => {
  it("is told the access is read-only", async () => {
    setAuth(
      unsignedToken({ role: "admin", system_role: "superadmin", is_view_only: true }),
      ENTITY_ID,
      ENTITY_NAME,
    );
    serve();

    show();

    expect(
      await screen.findByText("Read-only access — you are not a member of this entity."),
    ).toBeInTheDocument();
  });
});

describe("bulk Publish", () => {
  const KEE = billListItem({
    id: "b-kee",
    reference: "PR-0101",
    status: "submitted",
    contact: "Kee Wah",
  });
  const SAM = billListItem({
    id: "b-sam",
    reference: "PR-0102",
    status: "submitted",
    contact: "Sam's Fish",
  });
  const LEE = billListItem({
    id: "b-lee",
    reference: "PR-0103",
    status: "submitted",
    contact: "Lee Garden",
  });
  const ARCHIVED = {
    detail: "Kee Wah is archived in Xero. Restore it in Xero, or map it to another contact now.",
    archived_contacts: [{ id: "mc-kee", name: "Kee Wah" }],
  };

  async function publishThree() {
    await loaded();
    for (const name of ["Kee Wah", "Sam's Fish", "Lee Garden"]) {
      await userEvent.click(table().getByRole("checkbox", { name: `Select row ${name}` }));
    }
    await userEvent.click(screen.getByRole("button", { name: "Bulk actions, 3 selected" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Publish" }));
  }

  it("opens the archived-contact form, maps, and publishes only the bills it held back", async () => {
    const published: string[] = [];
    let keeTries = 0;
    serve({
      pages: [[KEE, SAM, LEE]],
      route: (path, init) => {
        const m = path.match(/\/bills\/([^/]+)\/publish\/$/);
        if (m && init?.method === "POST") {
          published.push(m[1]);
          if (m[1] === "b-kee") return keeTries++ === 0 ? answer(409, ARCHIVED) : answer(200, KEE);
          if (m[1] === "b-lee")
            return answer(400, {
              detail: "Lee Garden has no account code yet. Add one to publish it.",
            });
          return answer(200, SAM);
        }
        if (path.endsWith("/entity-bill-contacts/xero/"))
          return answer(200, [{ xero_contact_id: "x-kwb", name: "Kee Wah Bakery" }]);
        if (path.endsWith("/entity-bill-contacts/mc-kee/xero-link/"))
          return answer(200, {
            message: "Kee Wah now uses Kee Wah Bakery in Xero.",
            contact_id: "mc-kee",
          });
        return undefined;
      },
    });
    show();
    await publishThree();

    const dialog = await screen.findByRole("dialog", { name: "A contact is archived in Xero" });
    expect(published.sort()).toEqual(["b-kee", "b-lee", "b-sam"]);
    expect(
      await screen.findByText(
        "1 payment request wasn't published. Lee Garden has no account code yet. Add one to publish it.",
      ),
    ).toBeInTheDocument();

    const box = within(dialog).getByRole("combobox", { name: "Map Kee Wah to" });
    await userEvent.click(box);
    await userEvent.clear(box);
    await userEvent.click(await screen.findByRole("option", { name: "Kee Wah Bakery" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Map and publish" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "A contact is archived in Xero" })).toBeNull(),
    );
    await waitFor(() => expect(published.filter((id) => id === "b-kee")).toHaveLength(2));
    expect(published.filter((id) => id !== "b-kee").sort()).toEqual(["b-lee", "b-sam"]);
  });

  it("Go back leaves the held bills unpublished and the list reloaded", async () => {
    // list reads made once publishing began: the reload that shows what went
    let readsAfterPublish = 0;
    let publishing = false;
    serve({
      pages: [[KEE, SAM, LEE]],
      onBills: () => {
        if (publishing) readsAfterPublish++;
      },
      route: (path, init) => {
        if (/\/publish\/$/.test(path) && init?.method === "POST") publishing = true;
        if (/\/bills\/b-kee\/publish\/$/.test(path) && init?.method === "POST")
          return answer(409, ARCHIVED);
        if (/\/publish\/$/.test(path) && init?.method === "POST") return answer(200, SAM);
        if (path.endsWith("/entity-bill-contacts/xero/"))
          return answer(200, [{ xero_contact_id: "x-kwb", name: "Kee Wah Bakery" }]);
        return undefined;
      },
    });
    show();
    await publishThree();

    const dialog = await screen.findByRole("dialog", { name: "A contact is archived in Xero" });
    await waitFor(() => expect(readsAfterPublish).toBeGreaterThan(0));
    await userEvent.click(within(dialog).getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("dialog", { name: "A contact is archived in Xero" })).toBeNull();
    expect(document.querySelector("[data-toast-type='error']")).toBeNull();
  });
});
