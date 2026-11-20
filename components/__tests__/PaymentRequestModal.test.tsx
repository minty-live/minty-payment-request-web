// The Add Payment dialog (components/PaymentRequestModal.tsx).
//
// e2e/02_bill_lifecycle.spec.ts walks the happy path in a browser. What the unit layer adds is
// the refusals - every required field, one at a time - and the two ways out, Save as Draft and
// Confirm, which post to different endpoints and must not be confused.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentRequestModal } from "@/components/PaymentRequestModal";
import { ToastProvider } from "@/components/Toast";
import { bill, billAttachment } from "@/lib/__fixtures__/bills";
import { SUPPLIERS } from "@/lib/__fixtures__/contacts";
import { entityBillAccounts } from "@/lib/__fixtures__/accounts";
import { moduleTokenClaims, unsignedToken } from "@/lib/__fixtures__/tokens";
import { setAuth } from "@/lib/auth";
import { draftFiles, keptDrafts } from "@/test/draftFiles";

const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const ENTITY_NAME = "Olive & Vine";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ ref: "360812e1", slug: "olive-and-vine" }),
  useRouter: () => router,
}));

vi.mock("@/components/PdfJsCanvasPreview", () => ({
  PdfJsCanvasPreview: () => <div>pdf preview</div>,
}));

const fetchMock = vi.fn<typeof fetch>();

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Posted = { path: string; body: unknown };

function serve({
  submit,
  draft,
  currency,
  upload,
}: {
  submit?: () => Response;
  draft?: () => Response;
  currency?: () => Response;
  /** `POST /bills/{id}/attachments`; given the one file the call carries. */
  upload?: (file: File) => Response;
} = {}) {
  const posted: Posted[] = [];
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path.endsWith("/auth/entity-currency")) {
      return (currency ?? (() => answer(200, { currency_code: "HKD" })))();
    }
    if (path.endsWith("/auth/entitlements")) return answer(200, { billing_enabled: true });
    if (path.endsWith("/profile/me")) return answer(200, { member_entity_ids: [ENTITY_ID] });
    if (path.endsWith("/entity-bill-contacts/")) return answer(200, SUPPLIERS);
    if (path.includes("/entity-bill-accounts/")) return answer(200, entityBillAccounts());
    if (path.endsWith("/bills/suggested-reference/")) return answer(200, { reference: "MBIOVI-1" });
    if (path.endsWith("/currencies/")) return answer(200, []);
    if (init?.method === "POST") {
      // An upload's body is FormData, which only a string body could be parsed from.
      posted.push({
        path,
        body: typeof init.body === "string" ? JSON.parse(init.body) : (init.body ?? null),
      });
      if (/\/bills\/[^/]+\/attachments$/.test(path)) {
        const sent = init.body instanceof FormData ? (init.body.get("files") as File) : null;
        return (upload ?? (() => answer(201, [billAttachment()])))(sent as File);
      }
      if (path.endsWith("/bills/draft/")) return (draft ?? (() => answer(201, bill())))();
      if (path.endsWith("/bills/submit/") || path.endsWith("/bills/")) {
        return (submit ?? (() => answer(201, bill())))();
      }
    }
    return answer(200, {});
  });
  return { posted };
}

const onClose = vi.fn();
const onConfirm = vi.fn();
const onSaveDraft = vi.fn();

const show = () =>
  render(
    <ToastProvider>
      <PaymentRequestModal open onClose={onClose} onConfirm={onConfirm} onSaveDraft={onSaveDraft} />
    </ToastProvider>,
  );

const dialog = () => screen.getAllByRole("dialog")[0];

const file = (name: string, type: string) => new File(["x"], name, { type });

/** Hand the input a file past its `accept` filter, the way a drag-drop does. */
const drop = (input: HTMLInputElement, f: File) => {
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  fireEvent.change(input);
};

const filePicker = () => within(dialog()).getByLabelText("Choose files to attach");

/** The dashed box behind the (invisible, overlaid) file input. */
const dropZone = () => filePicker().parentElement!.querySelector(".border-dashed") as HTMLElement;

const attach = (f: File) =>
  userEvent.upload(within(dialog()).getByLabelText("Choose files to attach"), f);

/** The inline preview pane: found by the enlarge control it carries. */
const findPane = async () => {
  const button = await screen.findByRole("button", { name: `View full — ${"receipt.png"}` });
  return button.parentElement as HTMLElement;
};

const findViewer = async () => {
  const close = await screen.findByRole("button", { name: "Close preview" });
  return close.closest('[role="dialog"]') as HTMLElement;
};
const confirm = () => screen.getByRole("button", { name: /^Confirm/ });
const saveDraft = () => screen.getByRole("button", { name: /Save as Draft/ });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  setAuth(unsignedToken({ role: "admin", system_role: "normal" }), ENTITY_ID, ENTITY_NAME);
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the dialog", () => {
  it("is modal and has a name", () => {
    show();

    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(dialog()).toHaveAccessibleName();
  });

  it("offers both ways out: a draft, or a submitted request", () => {
    show();

    expect(saveDraft()).toBeInTheDocument();
    expect(confirm()).toBeInTheDocument();
  });

  it("closes without saving", async () => {
    show();

    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("marks the fields it insists on", () => {
    show();

    const required = Array.from(dialog().querySelectorAll("label"))
      .filter((l) => l.textContent?.includes("*"))
      .map((l) => l.textContent?.replace(/\s*\*$/, "").trim());
    expect(required).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Due Date"),
        expect.stringContaining("Amount"),
      ]),
    );
  });

  it("suggests a Payment No. so one need not be typed", async () => {
    show();

    await waitFor(() =>
      expect(within(dialog()).getByLabelText(/Payment No\./)).toHaveValue("MBIOVI-1"),
    );
  });
});

describe("what it refuses", () => {
  it("submits nothing at all when the form is empty", async () => {
    const { posted } = serve();
    show();

    await userEvent.click(confirm());

    expect(posted).toHaveLength(0);
  });

  it("asks for an amount", async () => {
    const { posted } = serve();
    show();

    await userEvent.click(confirm());

    expect(
      await screen.findByText("The amount is still empty. Add the amount to continue.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  it("asks for a supplier", async () => {
    serve();
    show();

    await userEvent.click(confirm());

    expect(
      await screen.findByText("The supplier is still empty. Choose a supplier to continue.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("asks for an account code", async () => {
    serve();
    show();

    await userEvent.click(confirm());

    expect(
      await screen.findByText("The account is still empty. Choose an account to continue.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("asks for a due date", async () => {
    serve();
    show();

    await userEvent.click(confirm());

    expect(
      await screen.findByText("The due date is still empty. Add the due date to continue.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("refuses an amount that is not one", async () => {
    serve();
    show();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "0");

    await userEvent.click(confirm());

    expect(
      await screen.findByText("The amount is zero. Add an amount above 0 to continue.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });
});

describe("saving a draft", () => {
  it("posts to the draft endpoint, not the submit one", async () => {
    const { posted } = serve();
    show();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");

    await userEvent.click(saveDraft());

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].path).toContain("/bills/draft/");
    expect(posted.every((p) => !p.path.endsWith("/bills/submit/"))).toBe(true);
  });

  it("does not insist on the fields a submitted request needs", async () => {
    // A draft is a work in progress: it may be saved without a supplier or an account code.
    const { posted } = serve();
    show();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");

    await userEvent.click(saveDraft());

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(
      screen.queryByText("The supplier is still empty. Choose a supplier to continue.", {
        selector: "p",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the API's own sentence when the draft is refused", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      serve({ draft: () => answer(500, { detail: "boom" }) });
      show();
      await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");

      await userEvent.click(saveDraft());

      // An ApiError already carries readable copy (lib/api.ts), so it is shown as it stands.
      expect(
        await screen.findByText("Something went wrong on my end. Mind trying again?"),
      ).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("falls back to its own sentence when the failure is not the API's", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      serve({
        draft: () => {
          throw new TypeError("Failed to fetch");
        },
      });
      show();
      await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");

      await userEvent.click(saveDraft());

      expect(
        await screen.findByText("That draft didn't quite save. Mind trying again?"),
      ).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("uploading the invoice after the request exists", () => {
  const SENT = bill({ id: "bill-sent", reference: "PR-0100", contact: "ABC Furniture" });
  const REQUEST_PAGE = "/entity/360812e1/olive-and-vine/payment-request/PR-0100";

  /** Everything Confirm insists on, and the files to attach. */
  async function fillForConfirm(...files: File[]) {
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");
    fireEvent.change(document.getElementById("pr-invoice-date")!, {
      target: { value: "2026-03-03" },
    });
    fireEvent.change(document.getElementById("pr-due-date")!, { target: { value: "2026-03-31" } });
    await userEvent.click(document.getElementById("pr-contact")!);
    await userEvent.click(await screen.findByRole("option", { name: "ABC Furniture" }));
    await userEvent.click(document.getElementById("pr-account")!);
    await userEvent.click(await screen.findByRole("option", { name: /^429 - / }));
    await userEvent.upload(filePicker(), files);
  }

  const uploads = (posted: Posted[]) => posted.filter((p) => p.path.endsWith("/attachments"));
  const warning = () => document.querySelector('[data-toast-type="warning"]');

  beforeEach(() => {
    router.push.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 2026-11-03 walk: a new request's line was saved with the account's code and no name.
  it("sends the account's name on the line as well as its code", async () => {
    const { posted } = serve({ submit: () => answer(201, SENT) });
    show();
    await fillForConfirm(file("invoice.pdf", "application/pdf"));

    await userEvent.click(confirm());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(REQUEST_PAGE));
    const sent = posted.find(
      (p) => p.path.endsWith("/bills/submit/") || p.path.endsWith("/bills/"),
    );
    expect((sent?.body as { line_items: unknown[] }).line_items[0]).toMatchObject({
      account_code: "429",
      account_name: "General Expenses",
    });
  });

  it("posts the file to the new request's attachments and opens it, with no warning", async () => {
    const { posted } = serve({ submit: () => answer(201, SENT) });
    show();
    await fillForConfirm(file("invoice.pdf", "application/pdf"));

    await userEvent.click(confirm());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(REQUEST_PAGE));
    expect(uploads(posted).map((p) => p.path)).toEqual(["/api/v1/bills/bill-sent/attachments"]);
    expect(warning()).toBeNull();
  });

  it("says the file didn't upload when the server fails, and still opens the request", async () => {
    serve({ submit: () => answer(201, SENT), upload: () => answer(500, { detail: "boom" }) });
    show();
    await fillForConfirm(file("invoice.pdf", "application/pdf"));

    await userEvent.click(confirm());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(REQUEST_PAGE));
    expect(warning()?.textContent).toContain(
      "Payment request for ABC Furniture sent, but invoice.pdf didn't upload. Edit the request and add it again.",
    );
  });

  it("says the same when the server refuses the file", async () => {
    serve({
      submit: () => answer(201, SENT),
      upload: () => answer(422, { detail: "Files need to be under 10MB." }),
    });
    show();
    await fillForConfirm(file("invoice.pdf", "application/pdf"));

    await userEvent.click(confirm());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(REQUEST_PAGE));
    expect(warning()?.textContent).toContain("invoice.pdf didn't upload");
  });

  it("names only the file that failed when several were sent", async () => {
    const { posted } = serve({
      submit: () => answer(201, SENT),
      upload: (f) =>
        f.name === "second.pdf" ? answer(500, { detail: "boom" }) : answer(201, [billAttachment()]),
    });
    show();
    await fillForConfirm(
      file("first.pdf", "application/pdf"),
      file("second.pdf", "application/pdf"),
    );

    await userEvent.click(confirm());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(REQUEST_PAGE));
    expect(uploads(posted)).toHaveLength(2);
    expect(warning()?.textContent).toContain("but second.pdf didn't upload");
    expect(warning()?.textContent).not.toContain("first.pdf");
  });

  it("opens a saved draft whose file didn't upload, so it can be added again", async () => {
    const draft = bill({ id: "bill-draft", reference: "PR-0101", status: "draft" });
    serve({ draft: () => answer(201, draft), upload: () => answer(500, { detail: "boom" }) });
    show();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");
    await attach(file("invoice.pdf", "application/pdf"));

    await userEvent.click(saveDraft());

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        "/entity/360812e1/olive-and-vine/payment-request/PR-0101",
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(warning()?.textContent).toContain(
      "Draft saved, but invoice.pdf didn't upload. Edit the draft and add it again.",
    );
  });
});

describe("the company's currency", () => {
  // lib/entityCurrency.ts caches the code for the page's life, so each case takes fresh modules.
  async function showFresh() {
    vi.resetModules();
    const [{ PaymentRequestModal: Modal }, { ToastProvider: Toasts }, { setAuth: auth }] =
      await Promise.all([
        import("@/components/PaymentRequestModal"),
        import("@/components/Toast"),
        import("@/lib/auth"),
      ]);
    auth(unsignedToken({ role: "admin", system_role: "normal" }), ENTITY_ID, ENTITY_NAME);
    render(
      <Toasts>
        <Modal open onClose={onClose} onConfirm={onConfirm} onSaveDraft={onSaveDraft} />
      </Toasts>,
    );
  }

  it("stands beside the amount", async () => {
    serve();
    await showFresh();

    await waitFor(() =>
      expect(within(dialog()).getByLabelText("Currency")).toHaveTextContent("HKD"),
    );
    expect(saveDraft()).toBeEnabled();
  });

  it("says when the company has none, and sends nothing", async () => {
    const { posted } = serve({ currency: () => answer(200, { currency_code: "" }) });
    await showFresh();

    expect(await screen.findByText(/Your company has no currency set/)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Currency")).toHaveTextContent("—");
    // the currency is set on the hub's General tab (2026-11-10), through accounts-api
    expect(screen.getByRole("link", { name: "Settings, under General" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/entity/${ENTITY_ID}/settings/general`),
    );
    expect(confirm()).toBeDisabled();
    expect(saveDraft()).toBeDisabled();
    expect(posted).toHaveLength(0);
  });

  it("takes no point for a 0-place currency (JPY), and posts whole yen", async () => {
    const { posted } = serve({
      currency: () => answer(200, { currency_code: "JPY", decimal_places: 0 }),
    });
    await showFresh();
    await waitFor(() =>
      expect(within(dialog()).getByLabelText("Currency")).toHaveTextContent("JPY"),
    );
    const amount = within(dialog()).getByPlaceholderText("0.00");

    await userEvent.type(amount, "12.5");
    expect(amount).toHaveValue("125");

    await userEvent.clear(amount);
    await userEvent.type(amount, "1234");
    await userEvent.click(saveDraft());

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].body).toMatchObject({ amount: "1234" });
  });

  it("tells a failed read apart from none set, and tries again", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let calls = 0;
      serve({
        currency: () =>
          ++calls === 1 ? answer(500, { detail: "boom" }) : answer(200, { currency_code: "HKD" }),
      });
      await showFresh();

      expect(await screen.findByText(/couldn.t load your company.s currency/)).toBeInTheDocument();
      expect(saveDraft()).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      await waitFor(() =>
        expect(within(dialog()).getByLabelText("Currency")).toHaveTextContent("HKD"),
      );
      expect(saveDraft()).toBeEnabled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("the amount field", () => {
  it("takes digits and refuses the rest", async () => {
    show();
    const amount = within(dialog()).getByPlaceholderText("0.00");

    await userEvent.type(amount, "12abc34");

    expect(amount).toHaveValue("1,234");
  });

  it("refuses a twelfth integer digit rather than truncating", async () => {
    show();
    const amount = within(dialog()).getByPlaceholderText("0.00");

    await userEvent.type(amount, "123456789012");

    expect(amount).toHaveValue("12,345,678,901");
  });

  it("puts the commas in as the person types", async () => {
    show();
    const amount = within(dialog()).getByPlaceholderText("0.00");

    await userEvent.type(amount, "1234567.8");

    expect(amount).toHaveValue("1,234,567.8");
  });

  it("still posts the amount as a plain decimal string", async () => {
    const { posted } = serve();
    show();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "1234567.5");

    await userEvent.click(saveDraft());

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].body).toMatchObject({ amount: "1234567.50" });
  });

  it("groups the amount once the field is left", async () => {
    show();
    const amount = within(dialog()).getByPlaceholderText("0.00");

    await userEvent.type(amount, "6000");
    await userEvent.tab();

    expect(amount).toHaveValue("6,000.00");
  });
});

describe("the attachments", () => {
  it("invites a file, and names the control for a reader", () => {
    show();

    expect(within(dialog()).getByText("Click or drag files here to upload")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Choose files to attach")).toBeInTheDocument();
  });

  // The upload is mandatory, and it used to say so only after Confirm. The marker goes up
  // front; the red border waits for a failed Confirm, like every other field here.
  it("says it is mandatory before anything is attempted", () => {
    show();

    expect(within(dialog()).getByText(/Uploaded files/)).toHaveTextContent("*");
    expect(filePicker()).toHaveAttribute("aria-required", "true");
  });

  it("is not red until Confirm has been tried", async () => {
    show();

    expect(dropZone()).toHaveClass("border-border-input");
    expect(filePicker()).not.toHaveAttribute("aria-invalid");

    await userEvent.click(confirm());

    await waitFor(() => expect(dropZone()).toHaveClass("border-action-danger"));
    expect(dropZone()).not.toHaveClass("border-border-input");
    expect(filePicker()).toHaveAttribute("aria-invalid", "true");
  });

  it("ties the refusal to the control it is about", async () => {
    show();

    await userEvent.click(confirm());

    const message = await screen.findByText(
      "The invoice is still missing. Attach at least one file to continue.",
      { selector: "p" },
    );
    expect(filePicker()).toHaveAttribute("aria-describedby", message.id);
    expect(message.id).toBeTruthy();
  });

  it("clears the red as soon as a file arrives", async () => {
    show();
    await userEvent.click(confirm());
    await waitFor(() => expect(dropZone()).toHaveClass("border-action-danger"));

    await attach(file("receipt.png", "image/png"));

    await waitFor(() => expect(dropZone()).toHaveClass("border-border-input"));
    expect(filePicker()).not.toHaveAttribute("aria-invalid");
  });

  it("does not offer a spreadsheet in the picker at all", async () => {
    show();
    const input = within(dialog()).getByLabelText("Choose files to attach");

    expect(input.getAttribute("accept")).not.toContain("xls");
    expect(input.getAttribute("accept")).not.toContain("excel");
    expect(input.getAttribute("accept")).not.toContain("spreadsheet");

    // The picker filters it out, so it never even reaches the handler.
    await attach(file("books.xlsx", "application/vnd.ms-excel"));

    expect(screen.queryByText("books.xlsx")).toBeNull();
  });

  it("refuses a spreadsheet dropped past the picker, without naming Excel", async () => {
    show();
    const input = within(dialog()).getByLabelText("Choose files to attach") as HTMLInputElement;

    // Drag-drop bypasses `accept`, so this is the path the error copy is actually for.
    drop(input, file("books.xlsx", "application/vnd.ms-excel"));

    const refusal = await screen.findByText(
      /^I can't open .+\. Choose a PDF, JPEG, PNG or HTML file\.$/,
    );
    expect(refusal).toHaveTextContent(
      "I can't open books.xlsx. Choose a PDF, JPEG, PNG or HTML file.",
    );
    expect(refusal).not.toHaveTextContent("Excel");
    expect(screen.queryByText("books.xlsx")).toBeNull();
  });
});

// A staged file is PREVIEWED IN PLACE and enlarged over the dialog. It must never leave the
// app: an anchor here was the bug (the whole pane used to be a target="_blank" link), so the
// absence of one is the thing worth asserting.
describe("previewing a staged file", () => {
  it("shows the file inline with no link out of the app", async () => {
    show();

    await attach(file("receipt.png", "image/png"));

    const pane = await findPane();
    expect(within(pane).getByAltText("receipt.png")).toBeInTheDocument();
    expect(within(pane).queryAllByRole("link")).toHaveLength(0);
    expect(pane.querySelector('[target="_blank"]')).toBeNull();
  });

  it("enlarges to a full-screen preview over the dialog", async () => {
    show();
    await attach(file("receipt.png", "image/png"));

    await userEvent.click(await screen.findByRole("button", { name: "View full — receipt.png" }));

    const viewer = await findViewer();
    expect(viewer).toHaveAttribute("aria-modal", "true");
    expect(within(viewer).getByAltText("receipt.png")).toBeInTheDocument();
    expect(within(viewer).queryAllByRole("link")).toHaveLength(0);
  });

  it("unwinds one layer per Escape: the viewer first, then the dialog", async () => {
    show();
    await attach(file("receipt.png", "image/png"));
    await userEvent.click(await screen.findByRole("button", { name: "View full — receipt.png" }));
    await findViewer();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Close preview" })).toBeNull());
    expect(screen.getByText("Add Payment Request")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so, rather than offering a download, for a file it cannot draw", async () => {
    show();

    await attach(file("payload.bin", "application/octet-stream"));

    // Refused at the gate - the point is that no download link appears anywhere.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.querySelector("a[download]")).toBeNull();
  });
});

// The rules in CLAUDE.md: two or more problems on a refused Confirm show a summary at the top that
// takes focus and links to each field; one problem moves focus to that field; a required field's
// label also says "(required)" to a screen reader; Save as Draft is never blocked (2026-11-04).
describe("the error summary", () => {
  it("two or more problems: a summary at the top takes focus and links to each field", async () => {
    serve();
    show();

    await userEvent.click(confirm());

    const box = await waitFor(() => {
      const found = within(dialog())
        .getAllByRole("alert")
        .find((el) => /details need a look/.test(el.textContent ?? ""));
      expect(found).toBeDefined();
      return found!;
    });
    expect(box).toHaveFocus();
    expect(box).toHaveClass("bg-status-danger-bg");
    const links = within(box)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(links).toEqual([
      "The invoice is still missing. Attach at least one file to continue.",
      "The due date is still empty. Add the due date to continue.",
      "The amount is still empty. Add the amount to continue.",
      "The supplier is still empty. Choose a supplier to continue.",
      "The account is still empty. Choose an account to continue.",
    ]);
    await userEvent.click(within(box).getByRole("link", { name: /amount is still empty/ }));
    expect(document.getElementById("pr-amount")).toHaveFocus();
  });

  it("one problem: no summary, and focus goes to that field", async () => {
    serve();
    show();
    const due = document.getElementById("pr-due-date") as HTMLInputElement;
    fireEvent.change(due, { target: { value: "2026-12-01" } });
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "120");
    await userEvent.click(document.getElementById("pr-account")!);
    await userEvent.click(await screen.findByRole("option", { name: "429 - General Expenses" }));
    await attach(file("receipt.png", "image/png"));
    await userEvent.click(confirm());

    expect(
      await screen.findByText("The supplier is still empty. Choose a supplier to continue.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByText(/details need a look/)).toBeNull();
    await waitFor(() => expect(document.getElementById("pr-contact")).toHaveFocus());
  });

  it("a required field's label says so to a screen reader, and its control is aria-required", () => {
    serve();
    show();
    for (const [id, name] of [
      ["pr-invoice-date", "Invoice Date (required)"],
      ["pr-due-date", "Due Date (required)"],
      ["pr-amount", "Amount (required)"],
    ]) {
      const label = document.querySelector(`label[for="${id}"]`) as HTMLElement;
      expect(
        label.textContent
          ?.replace(/\s*\*\s*/, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ).toBe(name);
      expect(within(label).getByText("(required)")).toHaveClass("sr-only");
    }
    expect(document.querySelector('label[for="pr-description"]')!.textContent).not.toMatch(
      /required/,
    );
  });

  it("Save as Draft is never blocked by missing fields", async () => {
    const { posted } = serve();
    show();

    await userEvent.click(saveDraft());

    await waitFor(() => expect(posted.some((p) => p.path.endsWith("/bills/draft/"))).toBe(true));
    expect(within(dialog()).queryByText(/details need a look/)).toBeNull();
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
        contact: "ABC Furniture",
        amount: "6000.00",
        invoice_date: "2026-03-03",
      },
    ],
  };
  /** The first save is the duplicate 409; every later one saves. */
  const firstAsks = () => {
    let n = 0;
    return () => (n++ === 0 ? answer(409, DUPLICATE) : answer(201, bill({ id: "bill-new" })));
  };
  const saves = (posted: Posted[], end: string) => posted.filter((p) => p.path.endsWith(end));
  const question = () => screen.findByRole("alertdialog", { name: "Save it anyway?" });

  async function fillForConfirm() {
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");
    fireEvent.change(document.getElementById("pr-invoice-date")!, {
      target: { value: "2026-03-03" },
    });
    fireEvent.change(document.getElementById("pr-due-date")!, { target: { value: "2026-03-31" } });
    await userEvent.click(document.getElementById("pr-contact")!);
    await userEvent.click(await screen.findByRole("option", { name: "ABC Furniture" }));
    await userEvent.click(document.getElementById("pr-account")!);
    await userEvent.click(await screen.findByRole("option", { name: /^429 - / }));
    await userEvent.upload(filePicker(), file("invoice.pdf", "application/pdf"));
  }

  beforeEach(() => {
    router.push.mockClear();
    onConfirm.mockClear();
    onSaveDraft.mockClear();
    onClose.mockClear();
  });

  it("Confirm asks with the API's sentence and the matching bill, and sends nothing more", async () => {
    const { posted } = serve({ submit: firstAsks() });
    show();
    await fillForConfirm();

    await userEvent.click(confirm());

    const asked = await question();
    expect(asked).toHaveTextContent(SENTENCE);
    expect(asked).toHaveTextContent("PR-0002 · ABC Furniture · HKD 6,000.00 · 03 Mar 2026");
    expect(saves(posted, "/bills/submit/")).toHaveLength(1);
    expect(saves(posted, "/attachments")).toHaveLength(0);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Save anyway sends the same body with confirm_duplicate, then carries on as a normal save", async () => {
    const { posted } = serve({ submit: firstAsks() });
    show();
    await fillForConfirm();
    await userEvent.click(confirm());

    await userEvent.click(within(await question()).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    const [first, second] = saves(posted, "/bills/submit/");
    expect(second.body).toEqual({ ...(first.body as object), confirm_duplicate: true });
    expect(first.body).not.toHaveProperty("confirm_duplicate");
    expect(saves(posted, "/attachments")).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("Go back sends nothing, and the dialog keeps everything typed", async () => {
    const { posted } = serve({ submit: firstAsks() });
    show();
    await fillForConfirm();
    await userEvent.click(confirm());

    await userEvent.click(within(await question()).getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("alertdialog", { name: "Save it anyway?" })).toBeNull();
    expect(saves(posted, "/bills/submit/")).toHaveLength(1);
    expect(within(dialog()).getByPlaceholderText("0.00")).toHaveValue("6,000.00");
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm()).toBeEnabled();
  });

  it("Escape on the question is its Go back: the form stays open", async () => {
    serve({ submit: firstAsks() });
    show();
    await fillForConfirm();
    await userEvent.click(confirm());
    await question();

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Save it anyway?" })).toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Save as Draft asks too, and Save anyway saves the draft with confirm_duplicate", async () => {
    const { posted } = serve({ draft: firstAsks() });
    show();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");
    await userEvent.click(saveDraft());

    await userEvent.click(within(await question()).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled());
    const drafts = saves(posted, "/bills/draft/");
    expect(drafts).toHaveLength(2);
    expect(drafts[1].body).toMatchObject({ confirm_duplicate: true });
  });

  it("another 409 (no duplicates) shows its sentence as before, with no question", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    serve({ draft: () => answer(409, { detail: "Someone else changed that first." }) });
    show();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");
    await userEvent.click(saveDraft());

    expect(await screen.findByText("Someone else changed that first.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog", { name: "Save it anyway?" })).toBeNull();
    vi.restoreAllMocks();
  });
});

// Auto-saved drafts (owner's decisions doc L1, 2026-11-20): what is typed is kept in this browser
// 2 seconds after the last change (`@minty/shared/drafts`), and offered back - ask first - when
// the dialog opens again. Never the real bill: only Save as Draft or Confirm writes that.
describe("the auto-saved draft", () => {
  const notice = () => screen.queryByText(/You have unsaved changes from/);

  /** The page's own button, with the dialog it opens: open/closed the way the list drives it. */
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <ToastProvider>
        <button type="button" onClick={() => setOpen(true)}>
          Add Payment
        </button>
        <PaymentRequestModal
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={onConfirm}
          onSaveDraft={onSaveDraft}
        />
      </ToastProvider>
    );
  }

  const suggested = () =>
    waitFor(() => expect(within(dialog()).getByLabelText(/Payment No\./)).toHaveValue("MBIOVI-1"));
  const description = () => within(dialog()).getByPlaceholderText("Description (optional)");
  const reopen = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Add Payment" }));
    await suggested();
  };

  /** Type a description and an amount and attach a file, then close with the X. */
  async function typeAndClose() {
    render(<Harness />);
    await suggested();
    await userEvent.type(description(), "Printer paper");
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "1234.5");
    await userEvent.upload(filePicker(), file("invoice.pdf", "application/pdf"));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  }

  beforeEach(() => {
    // a token naming the person and the company, as Minty mints it: drafts are kept per both
    setAuth(unsignedToken(moduleTokenClaims()), ENTITY_ID, ENTITY_NAME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps what is typed 2 seconds after the last change, and writes nothing to the API", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { posted } = serve();
    render(<Harness />);
    await suggested();

    fireEvent.change(description(), { target: { value: "Printer paper" } });
    await act(async () => {
      vi.advanceTimersByTime(1900);
    });
    expect(keptDrafts()).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const kept = keptDrafts();
    expect(kept).toHaveLength(1);
    expect(kept[0].key).toBe(
      `minty:draft:1:${moduleTokenClaims().user_id}:${ENTITY_ID}:pr.add-payment:new`,
    );
    expect(kept[0].value).toMatchObject({
      form: "pr.add-payment",
      record: "new",
      basedOn: null,
      // the suggested Payment No. and today's invoice date are not the person's: not kept
      value: { billNo: null, invoiceDate: null, description: "Printer paper" },
    });
    expect(posted).toEqual([]);
  });

  it("keeps nothing for a form nobody touched", async () => {
    render(<Harness />);
    await suggested();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(keptDrafts()).toEqual([]);
  });

  it("the X keeps it; opening again asks first, and Restore puts the fields and the file back", async () => {
    await typeAndClose();
    expect(keptDrafts()).toHaveLength(1);
    expect([...draftFiles.data.values()].flat().map((f) => f.name)).toEqual(["invoice.pdf"]);

    await reopen();

    expect(
      await screen.findByText(/You have unsaved changes from \d\d:\d\d\./),
    ).toBeInTheDocument();
    // nothing changes until the person picks
    expect(description()).toHaveValue("");
    expect(within(dialog()).getByText(/Uploaded files \(0\)/)).toBeInTheDocument();

    await userEvent.click(within(dialog()).getByRole("button", { name: "Restore" }));

    expect(notice()).toBeNull();
    expect(description()).toHaveValue("Printer paper");
    expect(within(dialog()).getByPlaceholderText("0.00")).toHaveValue("1,234.50");
    expect(within(dialog()).getByText(/Uploaded files \(1\)/)).toBeInTheDocument();
    expect(
      within(dialog()).getByRole("button", { name: "Preview invoice.pdf" }),
    ).toBeInTheDocument();
    // the freshly suggested Payment No. stays, since the person never typed one
    expect(within(dialog()).getByLabelText(/Payment No\./)).toHaveValue("MBIOVI-1");
  });

  it("puts back a Payment No. the person typed", async () => {
    render(<Harness />);
    await suggested();
    fireEvent.change(within(dialog()).getByLabelText(/Payment No\./), {
      target: { value: "INV-77" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await reopen();
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Restore" }));

    expect(within(dialog()).getByLabelText(/Payment No\./)).toHaveValue("INV-77");
  });

  it("Discard removes it, files and all", async () => {
    await typeAndClose();
    await reopen();

    await userEvent.click(await within(dialog()).findByRole("button", { name: "Discard" }));

    expect(notice()).toBeNull();
    expect(keptDrafts()).toEqual([]);
    expect(draftFiles.data.size).toBe(0);
    expect(description()).toHaveValue("");
  });

  it("Save as Draft clears it, so the next Add Payment starts clean", async () => {
    await typeAndClose();
    await reopen();
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Restore" }));

    await userEvent.click(saveDraft());

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalled());
    expect(keptDrafts()).toEqual([]);
    await reopen();
    expect(notice()).toBeNull();
  });

  it("Confirm clears it too", async () => {
    serve({ submit: () => answer(201, bill({ id: "bill-sent", reference: "PR-0100" })) });
    render(<Harness />);
    await suggested();
    await userEvent.type(within(dialog()).getByPlaceholderText("0.00"), "6000");
    fireEvent.change(document.getElementById("pr-due-date")!, { target: { value: "2026-03-31" } });
    await userEvent.click(document.getElementById("pr-contact")!);
    await userEvent.click(await screen.findByRole("option", { name: "ABC Furniture" }));
    await userEvent.click(document.getElementById("pr-account")!);
    await userEvent.click(await screen.findByRole("option", { name: /^429 - / }));
    await userEvent.upload(filePicker(), file("invoice.pdf", "application/pdf"));

    await userEvent.click(confirm());

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(keptDrafts()).toEqual([]);
    expect(draftFiles.data.size).toBe(0);
  });

  it("Cancel throws it away - the person said so", async () => {
    render(<Harness />);
    await suggested();
    await userEvent.type(description(), "Printer paper");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(keptDrafts()).toEqual([]);
    await reopen();
    expect(notice()).toBeNull();
  });

  it("Escape and the backdrop keep it, like the X", async () => {
    render(<Harness />);
    await suggested();
    await userEvent.type(description(), "Printer paper");
    await userEvent.keyboard("{Escape}");
    expect(keptDrafts()).toHaveLength(1);

    await reopen();
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Restore" }));
    await userEvent.type(description(), " and toner");
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(keptDrafts()[0].value).toMatchObject({
      value: { description: "Printer paper and toner" },
    });
  });

  it("is never offered to another person signed in on the same browser", async () => {
    await typeAndClose();
    cleanup();
    setAuth(unsignedToken(moduleTokenClaims({ user_id: "someone-else" })), ENTITY_ID, ENTITY_NAME);

    render(<Harness />);
    await suggested();

    expect(notice()).toBeNull();
  });
});
