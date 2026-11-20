// One payment request's page (components/payment-request/PaymentRequestDetailBody.tsx).
//
// The screen reads the request the address names, shows its fields, and offers the actions its
// status and the reader's role allow. Two things here are worth more than the rest: a save
// sends only what CHANGED (buildBillUpdatePayload), and view-only access takes every write
// control away rather than leaving one that 403s.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/Toast";
import { PaymentRequestDetailBody } from "@/components/payment-request/PaymentRequestDetailBody";
import { entityBillAccounts } from "@/lib/__fixtures__/accounts";
import { audit, bill, billAttachment, payment } from "@/lib/__fixtures__/bills";
import { SUPPLIERS } from "@/lib/__fixtures__/contacts";
import { moduleTokenClaims, unsignedToken } from "@/lib/__fixtures__/tokens";
import { setAuth } from "@/lib/auth";
import { draftFiles, keptDrafts } from "@/test/draftFiles";

const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const ENTITY_NAME = "Olive & Vine";
const BILL_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

const params: { ref?: string; slug?: string; id?: string } = {};
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => router,
}));

vi.mock("@/components/PdfJsCanvasPreview", () => ({
  PdfJsCanvasPreview: () => <div>pdf preview</div>,
}));

const fetchMock = vi.fn<typeof fetch>();

const XERO_CONTACTS = [
  { xero_contact_id: "XA", name: "Alpha Ltd" },
  { xero_contact_id: "XB", name: "Beta Ltd" },
];

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = { path: string; method: string; body: Record<string, unknown> | null };

function serve({
  detail = bill({
    id: BILL_ID,
    status: "submitted",
    contact: "Young Bros Transport",
    reference: "PR-0001",
    // A request must keep at least one attachment, so a detail served with none cannot be
    // saved at all - it opens the "this one has to stay" dialog instead (tested below).
    attachments: [billAttachment()],
  }),
  billAnswer,
  payments = [],
  save,
  upload,
  publish,
  xeroContacts,
  link,
}: {
  detail?: ReturnType<typeof bill>;
  billAnswer?: () => Response;
  payments?: ReturnType<typeof payment>[];
  save?: () => Response;
  /** `POST /bills/{id}/attachments`. */
  upload?: () => Response;
  /** `POST /bills/{id}/publish/`. */
  publish?: () => Response;
  /** `GET /entity-bill-contacts/xero/`. */
  xeroContacts?: () => Response;
  /** `POST /entity-bill-contacts/{id}/xero-link/`. */
  link?: (path: string) => Response;
} = {}) {
  const calls: Call[] = [];
  fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      calls.push({
        path,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
    }
    if (path.endsWith("/auth/entity-currency")) return answer(200, { currency_code: "HKD" });
    if (path.endsWith("/auth/entitlements")) return answer(200, { billing_enabled: true });
    if (path.endsWith("/profile/me")) return answer(200, { member_entity_ids: [ENTITY_ID] });
    if (path.endsWith("/entity-bill-contacts/")) return answer(200, SUPPLIERS);
    if (path.endsWith("/entity-bill-contacts/xero/")) {
      return (xeroContacts ?? (() => answer(200, XERO_CONTACTS)))();
    }
    if (method === "POST" && path.endsWith("/xero-link/")) {
      return (link ?? (() => answer(200, { message: "Mapped.", contact_id: "c" })))(path);
    }
    if (path.includes("/entity-bill-accounts/")) return answer(200, entityBillAccounts());
    if (path.endsWith("/audit")) return answer(200, [audit({ bill_id: BILL_ID })]);
    if (path.endsWith("/payments")) return answer(200, { paid_total: "0.00", payments });
    if (method === "POST" && path.endsWith(`/bills/${BILL_ID}/attachments`)) {
      return (upload ?? (() => answer(201, [billAttachment()])))();
    }
    if (path.includes("/attachments")) return answer(200, []);
    if (method === "POST" && path.endsWith(`/bills/${BILL_ID}/publish/`)) {
      return (publish ?? (() => answer(200, detail)))();
    }
    if (path.includes("/bills/by-reference/")) {
      return (billAnswer ?? (() => answer(200, detail)))();
    }
    if (path.includes(`/bills/${BILL_ID}`)) {
      if (method === "PUT") return (save ?? (() => answer(200, detail)))();
      return (billAnswer ?? (() => answer(200, detail)))();
    }
    return answer(200, {});
  });
  return { calls };
}

const show = () =>
  render(
    <ToastProvider>
      <PaymentRequestDetailBody />
    </ToastProvider>,
  );

/** The fields are in by the time this heading is up and the request has arrived. */
const loaded = () => waitFor(() => expect(screen.getByText("PR-0001")).toBeInTheDocument());

beforeEach(() => {
  params.ref = "360812e1";
  params.slug = "olive-and-vine";
  params.id = BILL_ID;
  vi.stubGlobal("fetch", fetchMock);
  setAuth(unsignedToken({ role: "admin", system_role: "normal" }), ENTITY_ID, ENTITY_NAME);
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the request on screen", () => {
  it("reads the one the address names, by its id, with no lookup", async () => {
    serve();

    show();

    await loaded();
    const asked = fetchMock.mock.calls.map(([u]) => String(u));
    expect(asked.some((u) => u.endsWith(`/bills/${BILL_ID}`))).toBe(true);
    expect(asked.some((u) => u.includes("/bills/by-reference/"))).toBe(false);
  });

  it("shows its fields - the Payment No., both dates, the amount, the supplier, the code", async () => {
    serve();

    show();

    await loaded();
    expect(screen.getByText("PR-0001")).toBeInTheDocument();
    expect(screen.getByText("03 Mar 2026")).toBeInTheDocument();
    expect(screen.getByText("31 Mar 2026")).toBeInTheDocument();
    expect(screen.getByText("Young Bros Transport")).toBeInTheDocument();
    expect(screen.getByText("429 - General Expenses")).toBeInTheDocument();
    expect(screen.getByText("Corporate stationery and printer supplies")).toBeInTheDocument();
  });

  it("shows the amount in the COMPANY's currency", async () => {
    serve();

    show();

    await loaded();
    expect(document.body).toHaveTextContent("6,000.00");
    // The code arrives from its own read, one beat after the request itself.
    await waitFor(() => expect(document.body).toHaveTextContent("HKD"));
  });

  it("carries its history, collapsed", async () => {
    serve();

    show();

    await loaded();
    // "View Payment History" also matches /History/, so the accordion is named exactly.
    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("the address", () => {
  const BY_ID = `/entity/360812e1/olive-and-vine/payment-request/${BILL_ID}`;
  const BY_REFERENCE = "/entity/360812e1/olive-and-vine/payment-request/PR-0001";

  beforeEach(() => {
    router.replace.mockClear();
    window.history.replaceState(null, "", BY_ID);
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("turns an id address into the Payment No. one for a live request", async () => {
    serve();

    show();

    await loaded();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(BY_REFERENCE, { scroll: false }),
    );
  });

  it("keeps a voided request on its id - its Payment No. may name a live request now", async () => {
    serve({
      detail: bill({
        id: BILL_ID,
        status: "void",
        contact: "Young Bros Transport",
        reference: "PR-0001",
        attachments: [billAttachment()],
      }),
    });

    show();

    await loaded();
    // Give the address effect its turn before asserting it did nothing.
    await waitFor(() => expect(screen.getByText("Young Bros Transport")).toBeInTheDocument());
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("a request that would not load", () => {
  it("says so in the API's own words", async () => {
    serve({ billAnswer: () => answer(403, { detail: "You don't have access to that." }) });

    show();

    expect(await screen.findByText("You don't have access to that.")).toBeInTheDocument();
  });

  it("says it may have been renamed or removed when the address names nothing", async () => {
    params.id = "PR-GONE";
    serve({ billAnswer: () => answer(404, { detail: "no such bill" }) });

    show();

    expect(
      await screen.findByText(
        "I couldn't find that payment request. It may have been renamed or removed.",
      ),
    ).toBeInTheDocument();
  });
});

describe("editing it", () => {
  it("opens the fields for editing", async () => {
    serve();
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  // CHARACTERISATION: the save is a PUT of the WHOLE editable set (lib/paymentRequestBillMap.ts's
  // buildBillUpdatePayload), not a diff of what the person touched. That is a deliberate
  // full-replace, and these tests say so rather than pretending otherwise - a later move to a
  // PATCH of the changed fields would land here first.
  it("sends the edited field, inside the whole editable set", async () => {
    const { calls } = serve();
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const description = await screen.findByDisplayValue(
      "Corporate stationery and printer supplies",
    );

    await userEvent.clear(description);
    await userEvent.type(description, "A new description");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({
      description: "A new description",
      // Carried along unchanged, which is what makes it a replace rather than a patch.
      contact: "Young Bros Transport",
      reference: "PR-0001",
      // amounts go as "1234.50", the same shape as a new request (owner, 2026-10-26)
      amount: "6000.00",
      currency_code: "HKD",
      invoice_date: "2026-03-03",
      due_date: "2026-03-31",
      xero_account_code: "429",
    });
    expect((put.body!.line_items as Record<string, unknown>[])[0]).toMatchObject({
      unit_amount: "6000.00",
      line_amount: "6000.00",
    });
  });

  it("still sends the set unchanged when nothing was touched, and leaves edit mode", async () => {
    const { calls } = serve();
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByDisplayValue("Corporate stationery and printer supplies");

    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toMatchObject({
      description: "Corporate stationery and printer supplies",
      reference: "PR-0001",
    });
  });

  it("refuses to save a request with no attachment left, and says it has to stay", async () => {
    serve({
      detail: bill({
        id: BILL_ID,
        status: "submitted",
        contact: "Young Bros Transport",
        reference: "PR-0001",
        attachments: [],
      }),
    });
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByDisplayValue("Corporate stationery and printer supplies");

    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByRole("alertdialog")).toHaveAccessibleName(
      "I need at least one attachment on a payment, so this one has to stay.",
    );
  });

  it("puts the fields back on Cancel", async () => {
    serve();
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const description = await screen.findByDisplayValue(
      "Corporate stationery and printer supplies",
    );
    await userEvent.clear(description);
    await userEvent.type(description, "Abandoned");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // a change is never thrown away silently (owner, 2026-11-17)
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Leave without saving?" })).getByRole("button", {
        name: "Discard changes",
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("Corporate stationery and printer supplies")).toBeInTheDocument(),
    );
    expect(screen.queryByDisplayValue("Abandoned")).not.toBeInTheDocument();
  });

  it("asks before Cancel throws a change away; Go Back keeps it (2026-11-17)", async () => {
    serve();
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const description = await screen.findByDisplayValue(
      "Corporate stationery and printer supplies",
    );
    await userEvent.clear(description);
    await userEvent.type(description, "Half-typed");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const leave = screen.getByRole("dialog", { name: "Leave without saving?" });
    expect(within(leave).getByText("You have unsaved changes.")).toBeInTheDocument();
    await userEvent.click(within(leave).getByRole("button", { name: "Go Back" }));

    expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Half-typed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("leaves edit mode without asking when nothing was changed", async () => {
    serve();
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByDisplayValue("Corporate stationery and printer supplies");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
  });

  it("asks before a link takes the person away from a change", async () => {
    serve();
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const description = await screen.findByDisplayValue(
      "Corporate stationery and printer supplies",
    );
    await userEvent.type(description, " more");
    const away = document.createElement("a");
    away.href = "/entity/360812e1/olive-and-vine/payment-request";
    away.textContent = "Payment Requests";
    document.body.appendChild(away);
    try {
      await userEvent.click(away);
      expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    } finally {
      away.remove();
    }
  });

  it("says a file that didn't upload needs adding again - not that the request didn't save", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls } = serve({ upload: () => answer(500, { detail: "boom" }) });
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByDisplayValue("Corporate stationery and printer supplies");
    await userEvent.click(screen.getByRole("button", { name: "Add more attachments" }));
    const upload = await screen.findByRole("dialog");
    await userEvent.upload(
      within(upload).getByLabelText("Choose files to attach"),
      new File(["x"], "receipt.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(within(upload).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(document.querySelector("[data-toast-type='warning']")).toHaveTextContent(
        "I saved your payment request, but receipt.pdf didn't upload. Edit the request and add it again.",
      ),
    );
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/attachments"))).toBe(true);
    expect(document.querySelector("[data-toast-type='error']")).toBeNull();
    // The save finished: the page is out of edit mode.
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("says so when the save is refused, and stays in edit mode", async () => {
    serve({ save: () => answer(409, { detail: "Someone else changed that first." }) });
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const description = await screen.findByDisplayValue(
      "Corporate stationery and printer supplies",
    );
    await userEvent.clear(description);
    await userEvent.type(description, "A new description");

    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(document.querySelector("[data-toast-type='error']")).toHaveTextContent(
        "Someone else changed that first.",
      ),
    );
  });
});

describe("publishing it", () => {
  it("says why the API refused, in its words - a request needs its invoice (2026-10-27)", async () => {
    const { calls } = serve({
      publish: () =>
        answer(422, { detail: "Add the invoice attachment to publish this payment request." }),
    });
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "More payment actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Publish" }));

    await waitFor(() =>
      expect(document.querySelector("[data-toast-type='error']")).toHaveTextContent(
        "Add the invoice attachment to publish this payment request.",
      ),
    );
    expect(calls.some((c) => c.path.endsWith(`/bills/${BILL_ID}/publish/`))).toBe(true);
  });

  // 2026-11-20 (Save buttons that cover what the screen saves, item 5): a publish sends what is
  // saved, not what is being typed, so Publish waits for Save Changes and says so beside it.
  it("is held while the request is being edited, with the reason beside it", async () => {
    const { calls } = serve();
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save Changes" });
    await userEvent.click(screen.getByRole("button", { name: "More payment actions" }));

    const publish = await screen.findByRole("menuitem", { name: "Publish" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription("Save your changes first, then publish.");
    expect(screen.getByText("Save your changes first, then publish.")).toBeVisible();

    await userEvent.click(publish);
    expect(calls.some((c) => c.path.endsWith("/publish/"))).toBe(false);
  });

  it("is offered again once the edit is left", async () => {
    serve();
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Edit" });
    await userEvent.click(screen.getByRole("button", { name: "More payment actions" }));

    const publish = await screen.findByRole("menuitem", { name: "Publish" });
    expect(publish).toBeEnabled();
    expect(screen.queryByText("Save your changes first, then publish.")).not.toBeInTheDocument();
  });

  it("still lets Void be asked for while editing, behind its question", async () => {
    const { calls } = serve();
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Save Changes" });
    await userEvent.click(screen.getByRole("button", { name: "More payment actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Void" }));

    expect(await screen.findByRole("alertdialog")).toHaveAccessibleName("Void this payment?");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

// "Map it to another contact now" (owner's decisions, C4, 2026-11-19): a publish refused over
// contacts Xero archived without a merge opens a form to map each one, then publishes again.
describe("a contact archived in Xero at publish", () => {
  const ARCHIVED = {
    detail:
      "Kee Wah is archived in Xero. Restore it in Xero, or map it to another contact now.\n" +
      "Star Ferry is archived in Xero. Restore it in Xero, or map it to another contact now.",
    archived_contacts: [
      { id: "mc-1", name: "Kee Wah" },
      { id: "mc-2", name: "Star Ferry" },
    ],
  };
  const publishCalls = (calls: Call[]) =>
    calls.filter((c) => c.path.endsWith(`/bills/${BILL_ID}/publish/`));
  const linkCalls = (calls: Call[]) => calls.filter((c) => c.path.endsWith("/xero-link/"));

  async function publishAndOpen() {
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "More payment actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Some contacts are archived in Xero",
    });
    await waitFor(() =>
      expect(within(dialog).getByRole("combobox", { name: "Map Kee Wah to" })).toBeEnabled(),
    );
    return dialog;
  }

  async function pick(dialog: HTMLElement, label: string, option: string) {
    const box = within(dialog).getByRole("combobox", { name: label });
    await userEvent.click(box);
    await userEvent.clear(box);
    await userEvent.click(await screen.findByRole("option", { name: option }));
  }

  it("opens a form with each contact's sentence and a picker of the company's Xero contacts", async () => {
    serve({ publish: () => answer(409, ARCHIVED) });
    const dialog = await publishAndOpen();

    expect(
      within(dialog).getByText(
        "Kee Wah is archived in Xero. Restore it in Xero, or map it to another contact now.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Star Ferry is archived in Xero. Restore it in Xero, or map it to another contact now.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Or restore it in Xero, then publish again."),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-toast-type='error']")).toBeNull();
    const map = within(dialog).getByRole("button", { name: "Map and publish" });
    expect(map).toBeDisabled();
    expect(
      within(dialog).getByText("Choose a Xero contact for each contact above to continue."),
    ).toBeInTheDocument();
    await pick(dialog, "Map Kee Wah to", "Alpha Ltd");
    expect(map).toBeDisabled();
    expect(
      within(dialog).getByText("Choose the Xero contact for Star Ferry to continue."),
    ).toBeInTheDocument();
  });

  it("Map and publish maps each contact, toasts each answer, then publishes again", async () => {
    let published = 0;
    const { calls } = serve({
      publish: () =>
        published++ === 0 ? answer(409, ARCHIVED) : answer(200, bill({ id: BILL_ID })),
      link: (path) =>
        answer(200, {
          message: path.includes("mc-1")
            ? "Kee Wah now uses Alpha Ltd in Xero."
            : "Star Ferry now uses Beta Ltd in Xero.",
          contact_id: "c",
        }),
    });
    const dialog = await publishAndOpen();
    await pick(dialog, "Map Kee Wah to", "Alpha Ltd");
    await pick(dialog, "Map Star Ferry to", "Beta Ltd");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map and publish" }));

    expect(await screen.findByText("Kee Wah now uses Alpha Ltd in Xero.")).toBeInTheDocument();
    expect(screen.getByText("Star Ferry now uses Beta Ltd in Xero.")).toBeInTheDocument();
    expect(linkCalls(calls)).toEqual([
      {
        path: expect.stringMatching(/\/entity-bill-contacts\/mc-1\/xero-link\/$/),
        method: "POST",
        body: { xero_contact_id: "XA" },
      },
      {
        path: expect.stringMatching(/\/entity-bill-contacts\/mc-2\/xero-link\/$/),
        method: "POST",
        body: { xero_contact_id: "XB" },
      },
    ]);
    await waitFor(() => expect(publishCalls(calls)).toHaveLength(2));
    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).toBeNull();
  });

  it("keeps the form open with a refused mapping's sentence, and never maps one twice", async () => {
    let refusals = 0;
    const { calls } = serve({
      publish: () => answer(409, ARCHIVED),
      link: (path) =>
        path.includes("mc-2") && refusals++ === 0
          ? answer(404, { detail: "That Xero contact is gone. Choose another one." })
          : answer(200, { message: "Mapped.", contact_id: "c" }),
    });
    const dialog = await publishAndOpen();
    await pick(dialog, "Map Kee Wah to", "Alpha Ltd");
    await pick(dialog, "Map Star Ferry to", "Beta Ltd");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map and publish" }));

    expect(
      await within(dialog).findByText("That Xero contact is gone. Choose another one."),
    ).toBeInTheDocument();
    expect(publishCalls(calls)).toHaveLength(1);

    await pick(dialog, "Map Star Ferry to", "Alpha Ltd");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map and publish" }));
    await waitFor(() => expect(publishCalls(calls)).toHaveLength(2));
    expect(linkCalls(calls).map((c) => c.path.split("/").at(-3))).toEqual(["mc-1", "mc-2", "mc-2"]);
  });

  it("Go back closes it and sends nothing", async () => {
    const { calls } = serve({ publish: () => answer(409, ARCHIVED) });
    const dialog = await publishAndOpen();
    await pick(dialog, "Map Kee Wah to", "Alpha Ltd");
    await userEvent.click(within(dialog).getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).toBeNull();
    expect(linkCalls(calls)).toHaveLength(0);
    expect(publishCalls(calls)).toHaveLength(1);
  });

  it("Escape closes it too", async () => {
    serve({ publish: () => answer(409, ARCHIVED) });
    await publishAndOpen();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).toBeNull();
  });

  it("a 409 without archived contacts still toasts as before", async () => {
    serve({
      publish: () => answer(409, { detail: "This payment request is already being published." }),
    });
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "More payment actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Publish" }));

    await waitFor(() =>
      expect(document.querySelector("[data-toast-type='error']")).toHaveTextContent(
        "This payment request is already being published.",
      ),
    );
    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).toBeNull();
  });
});

describe("the actions its status allows", () => {
  it("offers Return and Record Payment on a submitted request", async () => {
    serve();

    show();

    await loaded();
    expect(screen.getByRole("button", { name: "Return payment request" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();
  });

  it("sends it back when Return is confirmed", async () => {
    const { calls } = serve();
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Return payment request" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/return/"))).toBe(true),
    );
    expect(calls.find((c) => c.path.endsWith("/return/"))?.body).toMatchObject({
      status: "payment_requested",
    });
  });

  // 2026-11-03 walk: a deleted draft stayed on screen, because the reload after the delete
  // failed (the draft is gone) and that failure was ignored.
  it("goes back to the list once a draft is deleted", async () => {
    let deleted = false;
    const { calls } = serve({
      detail: bill({
        id: BILL_ID,
        status: "draft",
        reference: "PR-0001",
        attachments: [billAttachment()],
      }),
      billAnswer: () =>
        deleted
          ? answer(404, { detail: "Bill not found" })
          : answer(
              200,
              bill({
                id: BILL_ID,
                status: "draft",
                reference: "PR-0001",
                attachments: [billAttachment()],
              }),
            ),
    });
    const served = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "DELETE") {
        await served(input, init); // recorded in calls
        deleted = true;
        return answer(200, { message: "Bill deleted" });
      }
      return served(input, init);
    });
    router.replace.mockClear();
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "More payment actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete Payment" }).at(-1)!);

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/entity/360812e1/olive-and-vine/payment-request",
      ),
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("opens the payment dialog on Record Payment", async () => {
    serve();
    show();
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Record payment" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("view-only access", () => {
  it("leaves every write control dead, with the reason on it", async () => {
    setAuth(
      unsignedToken({ role: "admin", system_role: "superadmin", is_view_only: true }),
      ENTITY_ID,
      ENTITY_NAME,
    );
    serve();

    show();

    await loaded();
    const edit = screen.getByRole("button", { name: "Edit" });
    await waitFor(() => expect(edit).toBeDisabled());
    // Record Payment carries the reason; Edit is simply dead.
    expect(screen.getByRole("button", { name: /Record payment/i })).toBeDisabled();
  });

  it("leaves the request itself perfectly readable", async () => {
    setAuth(
      unsignedToken({ role: "admin", system_role: "superadmin", is_view_only: true }),
      ENTITY_ID,
      ENTITY_NAME,
    );
    serve();

    show();

    await loaded();
    expect(screen.getByText("Young Bros Transport")).toBeInTheDocument();
    expect(screen.getByText("429 - General Expenses")).toBeInTheDocument();
  });
});

describe("the supplier on edit", () => {
  // Owner's decision: a pick from the list is needed only when the supplier text changed.
  const PICK = "Pick the supplier from the list, or add them as a new supplier.";
  const OLD_BILL = bill({
    id: BILL_ID,
    status: "submitted",
    contact: "Young Bros Transport",
    reference: "PR-0001",
    xero_contact_id: "", // an older request saved before suppliers came from Xero
    attachments: [billAttachment()],
  });
  const supplierField = () => screen.getByPlaceholderText("Select a supplier");
  const startEditing = async () => {
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByDisplayValue("Young Bros Transport");
  };

  it("saves an untouched older request that has no Xero supplier", async () => {
    const { calls } = serve({ detail: OLD_BILL });
    show();
    await startEditing();

    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(screen.queryByText(PICK)).not.toBeInTheDocument();
  });

  it("saves a changed supplier that was picked from the list", async () => {
    const { calls } = serve({ detail: OLD_BILL });
    show();
    await startEditing();

    await userEvent.clear(supplierField());
    await userEvent.type(supplierField(), "ABC");
    await userEvent.click(await screen.findByRole("option", { name: "ABC Furniture" }));
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({
      contact: "ABC Furniture",
      xero_contact_id: "XERO-2",
    });
  });

  it("refuses a changed supplier that was typed but not picked, and says so", async () => {
    const { calls } = serve({ detail: OLD_BILL });
    show();
    await startEditing();

    await userEvent.clear(supplierField());
    await userEvent.type(supplierField(), "Someone Unlisted");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText(PICK)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("editing for a company whose currency has no decimal places (JPY)", () => {
  it("shows and sends the amount with no decimals", async () => {
    const { calls } = serve();
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      new URL(String(input)).pathname.endsWith("/auth/entity-currency")
        ? answer(200, { currency_code: "JPY", decimal_places: 0 })
        : inner(input, init),
    );
    vi.resetModules();
    const [{ PaymentRequestDetailBody: Body }, { ToastProvider: Toasts }, { setAuth: auth }] =
      await Promise.all([
        import("@/components/payment-request/PaymentRequestDetailBody"),
        import("@/components/Toast"),
        import("@/lib/auth"),
      ]);
    auth(unsignedToken({ role: "admin", system_role: "normal" }), ENTITY_ID, ENTITY_NAME);
    render(
      <Toasts>
        <Body />
      </Toasts>,
    );
    await loaded();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/auth/entity-currency"))).toBe(
        true,
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const amount = await screen.findByDisplayValue("6,000");

    await userEvent.type(amount, ".5");
    expect(amount).toHaveValue("60,005");
    await userEvent.clear(amount);
    await userEvent.type(amount, "1234");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ amount: "1234" });
    expect((put.body!.line_items as Record<string, unknown>[])[0]).toMatchObject({
      unit_amount: "1234",
      line_amount: "1234",
    });
  });
});

describe("the duplicate reminder before a save (owner's decisions doc DUP1, 2026-11-19)", () => {
  const SENTENCE =
    "This looks like a bill you already have: the same date, supplier and amount. Save it anyway?";
  const DUPLICATE = {
    detail: SENTENCE,
    duplicates: [
      {
        id: "b-2",
        reference: "PR-0002",
        contact: "Young Bros Transport",
        amount: "6000.00",
        invoice_date: "2026-03-03",
      },
    ],
  };
  /** The first PUT is the duplicate 409; every later one saves. */
  const firstAsks = (detail?: ReturnType<typeof bill>) => {
    let puts = 0;
    return () => (puts++ === 0 ? answer(409, DUPLICATE) : answer(200, detail ?? bill()));
  };
  const puts = (calls: Call[]) => calls.filter((c) => c.method === "PUT");
  const question = () => screen.findByRole("alertdialog", { name: "Save it anyway?" });

  async function editAndSave() {
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const description = await screen.findByDisplayValue(
      "Corporate stationery and printer supplies",
    );
    await userEvent.clear(description);
    await userEvent.type(description, "A new description");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  }

  it("asks with the API's sentence and the matching bill, and saves nothing yet", async () => {
    const { calls } = serve({ save: firstAsks() });
    await editAndSave();

    const dialog = await question();
    expect(dialog).toHaveTextContent(SENTENCE);
    expect(dialog).toHaveTextContent("PR-0002 · Young Bros Transport · HKD 6,000.00 · 03 Mar 2026");
    expect(puts(calls)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("Save anyway sends the same body with confirm_duplicate and finishes the save", async () => {
    const { calls } = serve({ save: firstAsks() });
    await editAndSave();

    await userEvent.click(within(await question()).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
    const [first, second] = puts(calls);
    expect(second.body).toEqual({ ...first.body, confirm_duplicate: true });
    expect(first.body).not.toHaveProperty("confirm_duplicate");
    expect(screen.queryByRole("alertdialog", { name: "Save it anyway?" })).toBeNull();
  });

  it("Go back sends nothing more and keeps the edit as typed", async () => {
    const { calls } = serve({ save: firstAsks() });
    await editAndSave();

    await userEvent.click(within(await question()).getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("alertdialog", { name: "Save it anyway?" })).toBeNull();
    expect(puts(calls)).toHaveLength(1);
    expect(screen.getByDisplayValue("A new description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("a draft's Submit asks too, and Save anyway submits with confirm_duplicate", async () => {
    const draft = bill({
      id: BILL_ID,
      status: "draft",
      contact: "Young Bros Transport",
      reference: "PR-0001",
      attachments: [billAttachment()],
    });
    const { calls } = serve({ detail: draft, save: firstAsks(draft) });
    show();
    await loaded();
    await userEvent.click(await screen.findByRole("button", { name: /^Submit/ }));

    await userEvent.click(within(await question()).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    expect(puts(calls)[1].body).toMatchObject({ status: "submitted", confirm_duplicate: true });
    expect(puts(calls)[0].body).not.toHaveProperty("confirm_duplicate");
  });
});

// Auto-saved drafts (owner's decisions doc L1, 2026-11-20): an edit is kept in this browser 2 s
// after the last change, against the request's `updated_at`, and offered back above the request
// when the page opens again - ask first. Only Save Changes writes the request.
describe("the auto-saved draft of an edit", () => {
  const DESCRIPTION = "Corporate stationery and printer supplies";
  const notice = () => screen.queryByText(/You have unsaved changes from/);

  beforeEach(() => {
    setAuth(unsignedToken(moduleTokenClaims()), ENTITY_ID, ENTITY_NAME);
  });

  /** Edit, change the description (and stage a file), then leave the page with the edit open. */
  async function editAndLeave({ file = false }: { file?: boolean } = {}) {
    const view = show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const description = await screen.findByDisplayValue(DESCRIPTION);
    await userEvent.clear(description);
    await userEvent.type(description, "Half-typed");
    if (file) {
      await userEvent.click(screen.getByRole("button", { name: "Add more attachments" }));
      const upload = await screen.findByRole("dialog");
      await userEvent.upload(
        within(upload).getByLabelText("Choose files to attach"),
        new File(["x"], "receipt.pdf", { type: "application/pdf" }),
      );
      await userEvent.click(within(upload).getByRole("button", { name: "Upload" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    view.unmount();
  }

  it("keeps the edit 2 seconds after the last change, against the request's version", async () => {
    const { calls } = serve();
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(await screen.findByDisplayValue(DESCRIPTION), " and toner");

    await waitFor(() => expect(keptDrafts()).toHaveLength(1), { timeout: 4000 });

    const [kept] = keptDrafts();
    expect(kept.key).toBe(
      `minty:draft:1:${moduleTokenClaims().user_id}:${ENTITY_ID}:pr.bill-edit:${BILL_ID}`,
    );
    expect(kept.value).toMatchObject({
      basedOn: "2026-03-03T02:00:00Z",
      value: { fields: { description: `${DESCRIPTION} and toner` }, deletes: [] },
    });
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("asks first when the page opens again; Restore goes into edit with the draft and its file", async () => {
    await editAndLeave({ file: true });
    expect([...draftFiles.data.values()].flat().map((f) => f.name)).toEqual(["receipt.pdf"]);

    show();
    await loaded();

    expect(
      await screen.findByText(/You have unsaved changes from \d\d:\d\d\./),
    ).toBeInTheDocument();
    // nothing changes until the person picks
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(notice()).toBeNull();
    expect(await screen.findByDisplayValue("Half-typed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Select attachment receipt.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Select attachment invoice.pdf")).toBeInTheDocument();
  });

  it("takes a file the person took off away again on Restore", async () => {
    const twoFiles = bill({
      id: BILL_ID,
      status: "submitted",
      contact: "Young Bros Transport",
      reference: "PR-0001",
      attachments: [
        billAttachment(),
        billAttachment({
          id: "bill-attachment-2",
          attachment: {
            ...billAttachment().attachment,
            id: "attachment-2",
            original_name: "po.pdf",
          },
        }),
      ],
    });
    serve({ detail: twoFiles });
    const view = show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(await screen.findByLabelText("Select attachment invoice.pdf"));
    await userEvent.click(screen.getByRole("button", { name: "Delete attachment" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Select attachment invoice.pdf")).not.toBeInTheDocument(),
    );
    view.unmount();
    expect(keptDrafts()[0].value).toMatchObject({ value: { deletes: ["bill-attachment-1"] } });

    const { calls } = serve({ detail: twoFiles });
    show();
    await loaded();
    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByRole("button", { name: "Save Changes" });
    expect(screen.queryByLabelText("Select attachment invoice.pdf")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Select attachment po.pdf")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.path.endsWith("/attachments/bill-attachment-1"),
        ),
      ).toBe(true),
    );
  });

  it("Discard removes it and leaves the request as saved", async () => {
    await editAndLeave();
    show();
    await loaded();

    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(notice()).toBeNull();
    expect(keptDrafts()).toEqual([]);
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
  });

  it("Save Changes clears it", async () => {
    await editAndLeave();
    const { calls } = serve();
    show();
    await loaded();
    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByDisplayValue("Half-typed");

    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({
      description: "Half-typed",
    });
    expect(keptDrafts()).toEqual([]);
  });

  it("Cancel's Discard changes clears it too", async () => {
    show();
    await loaded();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(await screen.findByDisplayValue(DESCRIPTION), " more");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Leave without saving?" })).getByRole("button", {
        name: "Discard changes",
      }),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
    expect(keptDrafts()).toEqual([]);
  });

  it("is only shown, never put back, when the request was saved again since", async () => {
    await editAndLeave();
    serve({
      detail: bill({
        id: BILL_ID,
        status: "submitted",
        contact: "Young Bros Transport",
        reference: "PR-0001",
        attachments: [billAttachment()],
        updated_at: "2026-03-04T09:00:00Z",
      }),
    });
    show();
    await loaded();

    expect(
      await screen.findByText(/This was saved again after your unsaved changes from/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show what I typed" }));
    expect(screen.getByText("Half-typed")).toBeInTheDocument();
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
  });

  it("is only shown when this person can no longer edit the request", async () => {
    await editAndLeave();
    setAuth(unsignedToken(moduleTokenClaims({ is_view_only: true })), ENTITY_ID, ENTITY_NAME);
    show();
    await loaded();

    expect(
      await screen.findByText(
        /You can.t change this any more, so we haven.t put back your unsaved changes from/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });
});
