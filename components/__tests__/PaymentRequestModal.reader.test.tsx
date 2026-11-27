// The invoice reader in the Add Payment dialog (owner, 2026-11-04): an attached invoice is read
// (`POST /bills/extract/`, lib/invoiceReader.ts) and the form's EMPTY fields are filled as
// suggestions - or a field still at its untouched default (today's date, the default account).
// What the person set is never overwritten; a failed read says so in one quiet line. Since
// 2026-11-18 (owner) the invoice is read only when the person presses "Read the invoice".

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentRequestModal } from "@/components/PaymentRequestModal";
import { ToastProvider } from "@/components/Toast";
import { bill } from "@/lib/__fixtures__/bills";
import { SUPPLIERS } from "@/lib/__fixtures__/contacts";
import { entityBillAccount, entityBillAccounts } from "@/lib/__fixtures__/accounts";
import { unsignedToken } from "@/lib/__fixtures__/tokens";
import { setAuth } from "@/lib/auth";
import { DUE_FALLBACK_DETAIL } from "@/lib/invoiceReader";
import { INVOICE_LATCH } from "@/lib/invoiceReader";
import { todayLocalISODate, formatIsoDateAsDdMmmYyyy } from "@/lib/dateDisplayFormat";
import { photoQuality, SUGGESTED_RING } from "@minty/shared/reader";

const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";

vi.mock("next/navigation", () => ({
  useParams: () => ({ ref: "360812e1", slug: "olive-and-vine" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@minty/shared/pdfPreview", () => ({
  PdfJsCanvasPreview: () => <div>pdf preview</div>,
}));
// jsdom can't decode a photo: the free photo check is stood in for (the user, 2026-11-24)
vi.mock("@minty/shared/reader", async (original) => ({
  ...(await original<typeof import("@minty/shared/reader")>()),
  photoQuality: vi.fn(),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const field = (value: string, band: "high" | "medium" | "low" = "high", extra = {}) => ({
  value,
  confidence: band === "high" ? 0.95 : band === "medium" ? 0.7 : 0.3,
  band,
  applied: band !== "low" && value !== "",
  ...extra,
});

const READ = {
  suggestions: {
    supplier: field("ABC Furniture", "high", { contact_id: "XERO-2" }),
    account: field("429 - General Expenses", "medium", { code: "429", name: "General Expenses" }),
    amount: field("1200.50"),
    description: field("Office chairs"),
    invoice_date: field("2026-10-20"),
    due_date: field("2026-11-19"),
    currency: "HKD",
    entity_currency: "HKD",
  },
  reason: null,
};

type Seen = { extracts: FormData[]; submits: unknown[] };

function serve({
  extract = () => json(200, READ),
  accounts = entityBillAccounts(),
  enabled = true,
  status,
}: {
  extract?: () => Response | Promise<Response>;
  accounts?: unknown[];
  /** `GET /bills/extract/status/`: whether the reader is switched on (`BILL_AI_ENABLED`). */
  enabled?: boolean;
  /** The whole status, the company's AI reads included (owner, 2026-11-18). */
  status?: Record<string, unknown>;
} = {}): Seen {
  const seen: Seen = { extracts: [], submits: [] };
  fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/auth/entity-currency")) return json(200, { currency_code: "HKD" });
    if (path.endsWith("/entity-bill-contacts/")) return json(200, SUPPLIERS);
    if (path.includes("/entity-bill-accounts/")) return json(200, accounts);
    if (path.endsWith("/bills/suggested-reference/")) return json(200, { reference: "MBIOVI-1" });
    if (path.endsWith("/bills/extract/status/")) return json(200, status ?? { enabled });
    if (path.endsWith("/bills/extract/")) {
      seen.extracts.push(init?.body as FormData);
      return extract();
    }
    if (path.endsWith("/bills/submit/")) {
      seen.submits.push(JSON.parse(String(init?.body)));
      return json(201, bill());
    }
    if (/\/attachments$/.test(path)) return json(201, []);
    return json(200, {});
  });
  return seen;
}

const show = () =>
  render(
    <ToastProvider>
      <PaymentRequestModal open onClose={vi.fn()} onConfirm={vi.fn()} onSaveDraft={vi.fn()} />
    </ToastProvider>,
  );
const dialog = () => screen.getAllByRole("dialog")[0];
const byId = (id: string) => document.getElementById(id) as HTMLInputElement;
const pdf = (name = "invoice.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });
const attach = (f: File) =>
  userEvent.upload(within(dialog()).getByLabelText("Choose files to attach"), f);
/** There is no "Read invoice" button any more (the user, 2026-11-26): attaching reads. */
const readButton = () => within(dialog()).queryByRole("button", { name: /Read invoice/ });
const attachAndRead = attach;
const shown = (iso: string) => formatIsoDateAsDdMmmYyyy(iso);
// A failed read says why (the user, 2026-11-26; before, one quiet line for every case).
const FAILED = "Minty couldn't read this invoice. Please try again or fill in the details.";
const NO_TRIES_LEFT = "Minty couldn't read this invoice. Please fill in the details.";
const tryAgain = () => within(dialog()).queryByRole("button", { name: "Try again" });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  setAuth(unsignedToken({ role: "admin", system_role: "normal" }), ENTITY_ID, "Olive & Vine");
  INVOICE_LATCH.reset();
  vi.mocked(photoQuality).mockResolvedValue(null); // a sharp photo, unless a test says otherwise
});
afterEach(() => {
  vi.unstubAllGlobals();
  INVOICE_LATCH.reset();
});

describe("the invoice reader", () => {
  it("reads an attached invoice and fills the empty fields, marked as suggestions", async () => {
    const seen = serve();
    show();
    await waitFor(() => expect(byId("pr-invoice-date").value).toBe(todayLocalISODate()));

    await attachAndRead(pdf());

    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect((seen.extracts[0].get("invoice") as File).name).toBe("invoice.pdf");
    expect(byId("pr-due-date").value).toBe("2026-11-19");
    // today's date was the form's untouched default: it counts as empty
    expect(byId("pr-invoice-date").value).toBe("2026-10-20");
    expect(byId("pr-description")).toHaveValue("Office chairs");
    expect(byId("pr-contact")).toHaveValue("ABC Furniture");
    expect(byId("pr-account")).toHaveValue("429 - General Expenses");
    expect(byId("pr-amount")).toHaveAccessibleDescription("Suggested from the invoice.");
    expect(byId("pr-amount")).toHaveClass(...SUGGESTED_RING.split(" "));
    expect(
      within(dialog()).getAllByText("Suggested from the invoice. Check it before you submit."),
    ).toHaveLength(1); // the medium-band account
    expect(screen.getByText(/Minty read the invoice and filled 6 fields/)).toBeInTheDocument();
  });

  it("names what the invoice printed beside a supplier picked as similar, and only then", async () => {
    // the user, 2026-11-23: "滬江 -> Wu Kong" - a wrong "similar" pick is easy to spot
    const pick = (read_name: string) => ({
      ...READ,
      suggestions: {
        ...READ.suggestions,
        supplier: field("ABC Furniture", "high", { contact_id: "XERO-2", read_name }),
      },
    });
    serve({ extract: () => json(200, pick("ABC 家具 Kowloon")) });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-contact")).toHaveValue("ABC Furniture"));
    expect(
      within(dialog()).getByText(
        'Suggested from the invoice. The invoice reads "ABC 家具 Kowloon".',
      ),
    ).toBeInTheDocument();
  });

  it("says nothing more when the invoice prints the supplier's own name", async () => {
    serve({
      extract: () =>
        json(200, {
          ...READ,
          suggestions: {
            ...READ.suggestions,
            supplier: field("ABC Furniture", "high", {
              contact_id: "XERO-2",
              read_name: " abc furniture ",
            }),
          },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-contact")).toHaveValue("ABC Furniture"));
    expect(within(dialog()).queryByText(/The invoice reads/)).toBeNull();
  });

  it("never overwrites what the person set - a touched default included - but offers it", async () => {
    serve();
    show();
    await waitFor(() => expect(byId("pr-invoice-date").value).toBe(todayLocalISODate()));
    // picking a date and then today's again makes it the person's, though it ends where it began
    fireEvent.change(byId("pr-invoice-date"), { target: { value: "2026-10-01" } });
    fireEvent.change(byId("pr-invoice-date"), { target: { value: todayLocalISODate() } });
    await userEvent.type(byId("pr-amount"), "99");

    await attachAndRead(pdf());

    const note = await screen.findByText(
      `The invoice reads ${shown("2026-10-20")}, not ${shown(todayLocalISODate())}.`,
    );
    expect(byId("pr-invoice-date").value).toBe(todayLocalISODate());
    expect(byId("pr-amount")).toHaveValue("99.00");
    expect(screen.getByText("The invoice reads 1,200.50, not 99.00.")).toBeInTheDocument();
    const box = note.parentElement as HTMLElement;
    await userEvent.click(
      within(box).getByRole("button", { name: "Use the value from the invoice" }),
    );
    expect(byId("pr-invoice-date").value).toBe("2026-10-20");
  });

  it("the account starts empty (no default code), the invoice fills it, and Clear empties it", async () => {
    serve({
      accounts: [
        entityBillAccount({ code: "200", name: "Sales", active: true }, 0),
        entityBillAccount({ code: "429", name: "General Expenses", active: true }, 1),
      ],
    });
    show();
    expect(byId("pr-account")).toHaveValue("");

    await attachAndRead(pdf());

    await waitFor(() => expect(byId("pr-account")).toHaveValue("429 - General Expenses"));
    const line = screen.getByText("Suggested from the invoice. Check it before you submit.");
    await userEvent.click(
      within(line.parentElement as HTMLElement).getByRole("button", {
        name: "Clear the suggested value for this field",
      }),
    );
    expect(byId("pr-account")).toHaveValue("");
  });

  it("Confirm sends what the form shows, the suggested supplier by its Xero id", async () => {
    const seen = serve();
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));

    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));

    await waitFor(() => expect(seen.submits).toHaveLength(1));
    expect(seen.submits[0]).toMatchObject({
      contact: "ABC Furniture",
      xero_contact_id: "XERO-2",
      amount: "1200.50",
      invoice_date: "2026-10-20",
      due_date: "2026-11-19",
      xero_account_code: "429",
    });
  });

  it("a supplier the company lacks is a new supplier: ringed, said, and Confirm sends its token (2026-11-23)", async () => {
    const seen = serve({
      extract: () =>
        json(200, {
          ...READ,
          suggestions: {
            ...READ.suggestions,
            supplier: field("", "medium", {
              contact_id: "",
              detected_name: "Corner Bakery",
              new_supplier_token: "signed",
              applied: false,
            }),
          },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-contact")).toHaveValue("Corner Bakery"));
    // the user, 2026-11-25: a supplier not on the list is outlined orange, "Please check"
    expect(byId("pr-contact")).toHaveClass("ring-status-warning-ink");
    expect(
      within(dialog()).getByText(
        "Please check. It isn't in your suppliers yet, so it's added when you save this payment.",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));

    await waitFor(() => expect(seen.submits).toHaveLength(1));
    expect(seen.submits[0]).toMatchObject({
      contact: "Corner Bakery",
      new_contact_token: "signed",
    });
    expect(seen.submits[0]).not.toHaveProperty("xero_contact_id");
  });

  it("typing over the read supplier drops it: Confirm then asks for a supplier", async () => {
    const seen = serve({
      extract: () =>
        json(200, {
          ...READ,
          suggestions: {
            ...READ.suggestions,
            supplier: field("", "medium", {
              contact_id: "",
              detected_name: "Corner Bakery",
              new_supplier_token: "signed",
              applied: false,
            }),
          },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-contact")).toHaveValue("Corner Bakery"));
    await userEvent.type(byId("pr-contact"), "s");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));

    expect(seen.submits).toHaveLength(0);
    expect(byId("pr-contact")).toHaveAttribute("aria-invalid", "true");
  });

  it("a failed read says why in a polite status; the form is untouched", async () => {
    serve({ extract: () => json(200, { suggestions: null, reason: "timeout" }) });
    show();
    await attachAndRead(pdf());

    expect((await screen.findByText(FAILED)).closest('[role="status"]')).not.toBeNull();
    expect(byId("pr-amount")).toHaveValue("");
  });

  it("switched off, it says it isn't available and is not asked again this session", async () => {
    // the user, 2026-11-26: it used to say nothing
    const seen = serve({ extract: () => json(200, { suggestions: null, reason: "disabled" }) });
    show();
    await attachAndRead(pdf("one.pdf"));
    expect(
      await screen.findByText("Minty isn't available for this company yet."),
    ).toBeInTheDocument();
    expect(tryAgain()).toBeNull();
    await attach(pdf("two.pdf"));
    await screen.findByRole("button", { name: "Remove two.pdf" });

    expect(readButton()).toBeNull();
    expect(seen.extracts).toHaveLength(1);
    expect(screen.queryByText("Minty is reading your invoice…")).toBeNull();
  });

  it("shows the large reading cat while it reads, gone the moment the answer arrives", async () => {
    // the user, 2026-11-26: large in a person's first day of reading (no read yet here)
    let answer: (r: Response) => void = () => undefined;
    serve({ extract: () => new Promise<Response>((resolve) => (answer = resolve)) });
    show();
    await attachAndRead(pdf());
    expect(await screen.findByText("Minty is reading your invoice…")).toBeInTheDocument();
    expect(dialog().querySelector("video")).not.toBeNull();
    // the cat takes the drop zone's place while it reads, and the zone takes no file meanwhile
    expect(within(dialog()).queryByText("Click or drag files here to upload")).toBeNull();
    expect(within(dialog()).getByLabelText("Choose files to attach")).toBeDisabled();
    answer(json(200, READ));
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(screen.queryByText("Minty is reading your invoice…")).toBeNull();
    expect(dialog().querySelector("video")).toBeNull();
    expect(within(dialog()).getByText("Click or drag files here to upload")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Choose files to attach")).toBeEnabled();
  });

  it("says only Reading… a day after the person's first read, the cat the same", async () => {
    const longAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    serve({
      status: { enabled: true, percent_left: 80, blocked: false, first_read_at: longAgo },
      extract: () => new Promise<Response>(() => undefined),
    });
    show();
    await attachAndRead(pdf());
    expect(await within(dialog()).findByText("Reading…")).toBeInTheDocument();
    expect(screen.queryByText("Minty is reading your invoice…")).toBeNull();
    // the same cat takes the drop zone's place (the user, 2026-11-26)
    expect(within(dialog()).queryByText("Click or drag files here to upload")).toBeNull();
    expect(within(dialog()).getByLabelText("Choose files to attach")).toBeDisabled();
  });

  it("allows two tries, then only Fill in manually (the user, 2026-11-26)", async () => {
    const seen = serve({
      extract: () => json(200, { suggestions: null, reason: "provider_error" }),
    });
    show();
    await attachAndRead(pdf());
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(readButton()).toBeNull(); // the message carries the tries
    await userEvent.click(tryAgain()!);
    await waitFor(() => expect(seen.extracts).toHaveLength(2));
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Try again" }));
    expect(await screen.findByText(NO_TRIES_LEFT)).toBeInTheDocument();
    expect(seen.extracts).toHaveLength(3);
    expect(tryAgain()).toBeNull();
    expect(readButton()).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Fill in manually" }));
    expect(screen.queryByText(NO_TRIES_LEFT)).toBeNull();
    expect(byId("pr-bill-no")).toHaveFocus();
  });

  it.each([
    [{ reason: "rate_limited" }, "Minty is busy. Please try again in a minute.", true],
    [{ reason: "file_too_large", max_file_mb: 10 }, "This file is too large (max 10 MB).", false],
    [{ reason: "no_context" }, "Minty isn't available for this company yet.", false],
  ])("says why by reason: %o", async (answer, text, retryable) => {
    serve({ extract: () => json(200, { suggestions: null, ...answer }) });
    show();
    await attachAndRead(pdf());
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(tryAgain() !== null).toBe(retryable);
    expect(within(dialog()).getByRole("button", { name: "Fill in manually" })).toBeInTheDocument();
  });

  it("an HTML attachment is not read", async () => {
    const seen = serve();
    show();
    await attach(new File(["<html>"], "invoice.html", { type: "text/html" }));
    await screen.findByRole("button", { name: "Remove invoice.html" });
    expect(readButton()).toBeNull();
    expect(seen.extracts).toHaveLength(0);
  });

  // the user, 2026-11-24: an iPhone photo kept as HEIC is read like any photo (the API makes the
  // model's copy a JPEG)
  it("an iPhone HEIC is read like any photo", async () => {
    const seen = serve();
    show();
    await attach(new File(["heic"], "IMG_1.HEIC", { type: "image/heic" }));

    await waitFor(() => expect(seen.extracts).toHaveLength(1));
  });

  // The user, 2026-11-26: an invoice is read as soon as it is attached - no "Read invoice" button.
  it("attaching an invoice reads it once, with no button to press", async () => {
    const seen = serve();
    show();
    await attach(pdf());

    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(seen.extracts).toHaveLength(1);
    expect(readButton()).toBeNull();
  });

  it("the same invoice is not read again; a new one is", async () => {
    const seen = serve();
    show();
    await attach(pdf("one.pdf"));
    await waitFor(() => expect(seen.extracts).toHaveLength(1));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Preview one.pdf" }));
    expect(seen.extracts).toHaveLength(1); // selecting a file reads nothing
    await attach(pdf("two.pdf"));
    await waitFor(() => expect(seen.extracts).toHaveLength(2));
    expect((seen.extracts[1].get("invoice") as File).name).toBe("two.pdf");
  });

  it("the reader switched off on the API reads nothing", async () => {
    const seen = serve({ enabled: false });
    show();
    await attach(pdf());
    await screen.findByRole("button", { name: "Remove invoice.pdf" });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/bills/extract/status/"))).toBe(
        true,
      ),
    );
    expect(readButton()).toBeNull();
    expect(seen.extracts).toHaveLength(0);
  });

  it("a failed read offers Try again in its message, and a try that reads fills the fields", async () => {
    let calls = 0;
    const seen = serve({
      extract: () =>
        ++calls === 1 ? json(200, { suggestions: null, reason: "timeout" }) : json(200, READ),
    });
    show();
    await attachAndRead(pdf());
    expect(await screen.findByText(FAILED)).toBeInTheDocument();

    await userEvent.click(tryAgain()!);

    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(seen.extracts).toHaveLength(2);
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("removing the file that was read takes its suggestions with it", async () => {
    serve();
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));

    await userEvent.click(within(dialog()).getByRole("button", { name: /Remove invoice\.pdf/ }));

    expect(byId("pr-amount")).toHaveValue("");
    expect(byId("pr-invoice-date").value).toBe(todayLocalISODate());
    expect(byId("pr-contact")).toHaveValue("");
  });
});

// The company's AI allowance (shared with Petty Cash) and which file is read (the user, 2026-11-26:
// the newest one attached, at once).
describe("reading on attach: the file and the company's AI allowance", () => {
  const OPEN = {
    enabled: true,
    reads_used: null,
    reads_limit: null,
    reads_left: null,
    percent_left: 80,
    blocked: false,
    resumes_at: null,
  };

  it("says nothing about how much is left while there is room (the user, 2026-11-26)", async () => {
    serve({ status: OPEN });
    show();
    await attach(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(within(dialog()).queryByText(/allowance/)).toBeNull();
  });

  it("used up: the invoice is still attached, nothing is read, and the reason shows", async () => {
    const seen = serve({ status: { ...OPEN, percent_left: 0, blocked: true } });
    show();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/bills/extract/status/"))).toBe(
        true,
      ),
    );
    await attach(pdf());
    await screen.findByRole("button", { name: "Remove invoice.pdf" });
    expect(
      await within(dialog()).findByText(
        "Your company has used its AI allowance. Fill in the details yourself.",
      ),
    ).toBeInTheDocument();
    expect(seen.extracts).toHaveLength(0);
    expect(dialog().querySelector("video")).toBeNull();
  });

  it("an invoice attached before the reader's status arrives is read once it does", async () => {
    let answer: (r: Response) => void = () => undefined;
    const seen = serve({ status: OPEN });
    const reply = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      String(input).includes("/bills/extract/status/")
        ? new Promise<Response>((resolve) => (answer = resolve))
        : reply(input, init),
    );
    show();
    await attach(pdf());
    expect(seen.extracts).toHaveLength(0);
    answer(json(200, OPEN));
    await waitFor(() => expect(seen.extracts).toHaveLength(1));
  });

  it("a read that uses the allowance up says so at once", async () => {
    serve({
      status: OPEN,
      extract: () => json(200, { ...READ, reader: { ...OPEN, percent_left: 0, blocked: true } }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(
      within(dialog()).getByText(
        "Your company has used its AI allowance. Fill in the details yourself.",
      ),
    ).toBeInTheDocument();
  });

  it("with several files chosen at once, it reads the last readable one", async () => {
    const seen = serve({ status: OPEN });
    show();
    await userEvent.upload(within(dialog()).getByLabelText("Choose files to attach"), [
      pdf("invoice.pdf"),
      pdf("statement.pdf"),
    ]);
    await waitFor(() => expect(seen.extracts).toHaveLength(1));
    expect((seen.extracts[0].get("invoice") as File).name).toBe("statement.pdf");
    expect(within(dialog()).queryByText(/To read another file/)).toBeNull();
  });
});

// Owner, 2026-11-19: once a read has filled a field, the caution sits under the fields until the
// bill is saved. One sentence since 2026-11-23 (owner).
const CAUTION = "AI suggestions may be inaccurate.";

describe("the caution under AI-filled fields", () => {
  it("shows under the fields once a read fills them, read with Confirm and Save as Draft", async () => {
    serve();
    show();
    expect(within(dialog()).queryByText(CAUTION)).toBeNull(); // nothing read yet
    await attach(pdf()); // attaching reads it (the user, 2026-11-26)
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    const caution = within(dialog()).getByText(CAUTION);
    // under the last field, above the buttons
    expect(
      byId("pr-account").compareDocumentPosition(caution) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const name of ["Confirm", "Save as Draft"]) {
      const button = within(dialog()).getByRole("button", { name });
      expect(
        caution.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(button).toHaveAccessibleDescription(CAUTION);
    }
    await userEvent.clear(byId("pr-description"));
    await userEvent.type(byId("pr-description"), "Chairs");
    expect(within(dialog()).getByText(CAUTION)).toBeInTheDocument();
  });

  it("a read that filled nothing shows no caution", async () => {
    serve({ extract: () => json(200, { suggestions: null, reason: "timeout" }) });
    show();
    await attachAndRead(pdf());
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(within(dialog()).queryByText(CAUTION)).toBeNull();
  });

  it("removing the file that was read takes it away with its suggestions", async () => {
    serve();
    show();
    await attachAndRead(pdf());
    expect(await within(dialog()).findByText(CAUTION)).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole("button", { name: /Remove invoice\.pdf/ }));
    expect(within(dialog()).queryByText(CAUTION)).toBeNull();
  });
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

describe("an invoice in another currency", () => {
  it("fills the converted amount, says how, and Confirm keeps the six details", async () => {
    const seen = serve({ extract: () => json(200, CONVERTED) });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("96.82"));
    // owner, 2026-11-23: the original amount and the rate follow the description
    expect(byId("pr-description")).toHaveValue("Office chairs (USD 12.34 @ 1 USD = 7.85 HKD)");
    expect(byId("pr-amount")).toHaveAccessibleDescription(
      "Suggested from the invoice. Converted from USD\u00a012.34 at 1 USD = 7.85 HKD (13 Nov 2026 rate).",
    );
    // owner, 2026-11-23: the caution stays one sentence, no exchange-rate sentence
    expect(document.getElementById("pr-ai-caution")?.textContent).toBe(CAUTION);

    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    await waitFor(() => expect(seen.submits).toHaveLength(1));
    expect(seen.submits[0]).toMatchObject({
      amount: "96.82",
      exchange: {
        original_currency: "USD",
        original_amount: "12.34",
        exchange_rate: "7.846",
        exchange_rate_date: "2026-11-13",
        exchange_rate_basis: "receipt",
        exchange_rate_source: "Frankfurter",
      },
    });
  });

  it("with no description read, the description is the conversion alone", async () => {
    serve({
      extract: () =>
        json(200, {
          ...CONVERTED,
          suggestions: { ...CONVERTED.suggestions, description: { ...field(""), applied: false } },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("96.82"));
    expect(byId("pr-description")).toHaveValue("(USD 12.34 @ 1 USD = 7.85 HKD)");
  });

  it("a currency weaker than the company's writes 1 HKD = n of it (owner, 2026-11-24)", async () => {
    serve({
      extract: () =>
        json(200, {
          ...CONVERTED,
          suggestions: {
            ...CONVERTED.suggestions,
            amount: field("1345.60"),
            currency: "PHP",
            exchange: {
              ...CONVERTED.suggestions.exchange,
              original_currency: "PHP",
              original_amount: "10000.00",
              rate: "0.13456",
            },
          },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,345.60"));
    expect(byId("pr-description")).toHaveValue("Office chairs (PHP 10,000.00 @ 1 HKD = 7.43 PHP)");
    expect(byId("pr-amount")).toHaveAccessibleDescription(
      "Suggested from the invoice. Converted from PHP 10,000.00 at 1 HKD = 7.43 PHP (13 Nov 2026 rate).",
    );
  });

  it("a person's own amount drops the conversion", async () => {
    const seen = serve({ extract: () => json(200, CONVERTED) });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("96.82"));
    await userEvent.clear(byId("pr-amount"));
    await userEvent.type(byId("pr-amount"), "100");
    expect(document.getElementById("pr-ai-caution")).toHaveTextContent(CAUTION);
    expect(document.getElementById("pr-ai-caution")).not.toHaveTextContent(/Frankfurter/);

    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    await waitFor(() => expect(seen.submits).toHaveLength(1));
    expect((seen.submits[0] as { exchange?: unknown }).exchange ?? null).toBeNull();
  });

  it("no rate: the amount stays empty and one line says to type it in the company's currency", async () => {
    serve({
      extract: () =>
        json(200, {
          suggestions: {
            ...READ.suggestions,
            amount: { ...field(""), applied: false },
            currency: "TWD",
            exchange_failed: { currency: "TWD" },
          },
          reason: null,
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-description")).toHaveValue("Office chairs"));
    expect(byId("pr-amount")).toHaveValue("");
    expect(
      within(dialog()).getByText(
        "I couldn't get an exchange rate for TWD. Enter the amount in HKD.",
      ),
    ).toBeInTheDocument();
  });
});

// The only refusal, in the user's words (2026-11-25).
const SEVERAL =
  "This file seems to contain more than one invoice. Please upload one invoice per entry.";

describe("the outlines after a read (the user, 2026-11-25)", () => {
  const EMPTY_DESCRIPTION = field("", "medium");

  it("an empty description is outlined red, a warning only: Confirm sends the bill", async () => {
    const seen = serve({
      extract: () =>
        json(200, {
          ...READ,
          suggestions: { ...READ.suggestions, description: EMPTY_DESCRIPTION },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(byId("pr-description")).toHaveValue("");
    expect(byId("pr-description")).toHaveClass("ring-action-danger");
    expect(byId("pr-amount")).toHaveClass("ring-border-selected");
    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    await waitFor(() => expect(seen.submits).toHaveLength(1));
  });

  it("typing takes the red away", async () => {
    serve({
      extract: () =>
        json(200, {
          ...READ,
          suggestions: { ...READ.suggestions, description: EMPTY_DESCRIPTION },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-description")).toHaveClass("ring-action-danger"));
    await userEvent.type(byId("pr-description"), "Chairs");
    expect(byId("pr-description")).not.toHaveClass("ring-action-danger");
  });

  it("an inferred description and its account are outlined orange, Please check", async () => {
    serve({
      extract: () =>
        json(200, {
          ...READ,
          suggestions: {
            ...READ.suggestions,
            description: field("Office chairs", "medium", { inferred: true }),
          },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-description")).toHaveValue("Office chairs"));
    expect(byId("pr-description")).toHaveClass("ring-status-warning-ink");
    expect(
      within(dialog()).getByText("Please check. Compare the description with the invoice."),
    ).toBeInTheDocument();
    expect(byId("pr-account").closest(".ring-status-warning-ink")).not.toBeNull(); // its box
    expect(
      within(dialog()).getByText("Please check. Chosen to match the description."),
    ).toBeInTheDocument();
    expect(byId("pr-amount")).toHaveClass("ring-border-selected");
  });

  it("a due date that fell back to the invoice date is outlined orange, Please check", async () => {
    // the user's bill-date rules, 2026-11-27
    serve({
      extract: () =>
        json(200, {
          ...READ,
          suggestions: {
            ...READ.suggestions,
            due_date: field("2026-10-20", "medium", { fallback: true }),
          },
        }),
    });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-due-date")).toHaveValue("2026-10-20"));
    expect(byId("pr-due-date").closest(".ring-status-warning-ink")).not.toBeNull();
    expect(within(dialog()).getByText(`Please check. ${DUE_FALLBACK_DETAIL}`)).toBeInTheDocument();
  });

  it("a printed or terms due date keeps the suggested teal", async () => {
    serve({ extract: () => json(200, READ) });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveClass("ring-border-selected"));
    expect(byId("pr-due-date").closest(".ring-status-warning-ink")).toBeNull();
    expect(within(dialog()).queryByText(`Please check. ${DUE_FALLBACK_DETAIL}`)).toBeNull();
  });
});

describe("several invoices in one file - the only refusal", () => {
  it("several in one file ask for one at a time in an OK-only question", async () => {
    serve({ extract: () => json(200, { suggestions: null, reason: "several_documents" }) });
    show();
    await attachAndRead(pdf("two.pdf"));

    const question = await screen.findByRole("alertdialog", { name: "More than one invoice" });
    expect(question).toHaveTextContent(SEVERAL);
    expect(within(question).getAllByRole("button")).toHaveLength(1);
    expect(byId("pr-amount")).toHaveValue("");
    await userEvent.click(within(question).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(dialog()).getAllByText("two.pdf").length).toBeGreaterThan(0);
  });
});

describe("required fields the read left empty", () => {
  it("turn red at once with their sentence - no summary, no focus move", async () => {
    const rest = { ...READ.suggestions, supplier: undefined, account: undefined };
    serve({ extract: () => json(200, { suggestions: rest, reason: null }) });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));

    const supplierLine = "The supplier is still empty. Choose a supplier to continue.";
    expect(within(dialog()).getByText(supplierLine)).toBeInTheDocument();
    expect(
      within(dialog()).getByText("The account is still empty. Choose an account to continue."),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByText("The amount is still empty. Add the amount to continue."),
    ).toBeNull();
    expect(byId("pr-contact")).not.toHaveFocus();
    expect(screen.queryByText(/details need a look/)).toBeNull(); // the summary is a refused Confirm's
  });

  it("a read that fills every required field marks nothing", async () => {
    serve();
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(within(dialog()).queryByText(/is still empty/)).toBeNull();
  });
});

describe("a wrong or poor invoice is warned about, never refused (the user, 2026-11-24)", () => {
  const png = (name: string) =>
    new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
  const BANK =
    "This looks like a bank payment confirmation, not an invoice. Check that you've attached the receipt or invoice before you save.";

  it("a blurry photo is named the moment it is attached (the free check, not the AI)", async () => {
    serve();
    vi.mocked(photoQuality).mockImplementation(async (f) =>
      f.name === "soft.png" ? "blurry" : null,
    );
    show();
    await attach(png("soft.png"));
    expect(
      await within(dialog()).findByText(
        "soft.png looks blurry. Check that it can be read, or take a clearer one.",
      ),
    ).toHaveAttribute("role", "status");
  });

  it("a read that finds a bank payment confirmation still fills, and says what it looks like", async () => {
    serve({ extract: () => json(200, { ...READ, document_warning: "bank_payment_confirmation" }) });
    show();
    await attachAndRead(pdf());
    await waitFor(() => expect(byId("pr-amount")).toHaveValue("1,200.50"));
    expect(within(dialog()).getByText(BANK)).toHaveAttribute("role", "status");
  });

  it("a refused read that looks like a bank confirmation says that, not the general line", async () => {
    serve({
      extract: () =>
        json(200, {
          suggestions: null,
          reason: "several_documents",
          document_warning: "bank_payment_confirmation",
        }),
    });
    show();
    await attachAndRead(pdf());
    expect(await within(dialog()).findByText(BANK)).toBeInTheDocument();
    expect(within(dialog()).queryByText(FAILED)).toBeNull();
  });
});
