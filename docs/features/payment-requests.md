# Payment requests — the list, the dialog, the detail page

The screens of the bills module. Every write goes to minty-payment-request-api (`lib/api.ts`), and
that service's rules are the ones that hold (`minty-payment-request-api/docs/features/payment-requests.md`);
this page is what the person sees and where each piece of the screen lives.

## The list (`/entity/<shortid>/<name>/payment-request`, `components/payment-request/PaymentRequestView.tsx`)

- **Tabs** are the bill statuses (`PaymentRequestToolbar.PAYMENT_REQUEST_STATUS_FILTERS`):
  All, Payment Requested, Partially Paid, Returned, Paid, Draft, Voided — the display
  labels for `submitted`, `partially_paid`, `returned`, `paid`, `draft`, `void`
  (`lib/billStatusDisplay.ts`). On desktop several can be stacked; on mobile it is a
  single-select menu.
- **Filters**: search (supplier, reference, description), amount range, a date range on
  invoice or due date, Xero publish state (`lib/paymentRequestSearch.ts`, sorting in
  `lib/paymentRequestRowSort.ts`). A range the wrong way round says so under its pair as it is
  typed - "The first amount is more than the second. Make the first amount the smaller one."
  (compared with `parseAmount`, only once both are filled) and "The start date is after the end
  date. Choose a start on or before the end." - and Apply is disabled with its reason beside it
  until the range is in order.
- Two renderings of the same rows: the **table** (`PaymentRequestTable.tsx`) and the
  **easy view** (`PaymentRequestEasyView.tsx`, cards with a row-actions menu —
  `role="menu"`, "More options for <supplier>"), toggled in the header
  (`components/layout/EasyViewToggle.tsx`); `PaymentRequestTotalsBanner` sums what is
  shown; pagination in `PaymentRequestPagination`. Bulk delete of drafts from the table.
- **Download CSV** (owner, 2026-11-13; `components/payment-request/BillCsvDownload.tsx`), beside
  Bulk Actions and shown at every width, with no dialog: the list's own ticks and filters choose.
  With bills ticked it downloads those ("Download CSV (N)"); with none ticked, every bill the
  filters leave - status, search, amount, dates, Xero - as shown. The file is `bills_` (or
  `bills_selected_`) plus a range, `<start>_to_<end>`: the list's date filter, and for an end it leaves
  open the downloaded bills' own earliest or latest date (invoice date, or Submitted Date when the
  filter's type says so) - so with no filter, the bills' whole span (`billsCsvRange`,
  `billsCsvFileName`; today's day only when no bill has a date). It sends their ids to `POST /api/v1/bills/export.csv` (`downloadBillsCsv`
  in `lib/api.ts`, on `apiFetch`'s own auth and errors) and saves the file through
  `lib/saveExport.ts` - the one place excused from the "no download" lock in
  `__tests__/no_new_tab_file_links.test.ts`, because it saves an export the person asked for,
  never an uploaded file. "Your CSV is downloading."; a refusal's sentence is a toast. Held only
  when the list is empty. One line per bill (the API's `docs/features/payment-requests.md`).
- Every amount is shown in the **entity's currency** (`lib/entityCurrency.ts` from
  `GET /api/auth/entity-currency`), never the bill's stored code.
- Every amount **input** (Add Payment, the detail and Easy View edits, Record Payment, the
  amount filter) is `@minty/shared/amountInput` (owner, 2026-10-26): commas as it is typed, the
  caret kept on its digit, the places padded on blur; a 12th whole digit, a place beyond the
  currency's or a letter is refused. The places are the company currency's
  (`decimal_places` from the same endpoint - `useEntityCurrencyDecimals()` /
  `useEntityCurrencyState().decimals`, 2 when absent): a JPY company's fields take no point and
  send `"1234"`, an HKD one's `"1234.50"` (`toAmountString(amount, decimals)` in the create
  dialog, `buildBillUpdatePayload` and Record Payment).
- The Add Payment Request dialog uses `useEntityCurrencyState()`: with no currency set it says
  so under Amount (linking to the hub's General tab, "Settings, under General") and disables Confirm and Save as
  Draft; a failed read says so with **Try again**. Neither shows as an empty box.
- **Bank slip counts** load per visible row (`lib/bankSlipEnrichment.ts`). An unknown count is
  never shown as zero: while loading the row shows "…", and a failed lookup is logged and shows
  **Retry** (`BankSlipLoadState.tsx`, re-reads the rows on screen) — never **Upload**, which
  could hide slips that already exist. Easy view shows nothing while loading, Retry on failure.

## Colours (owner, 2026-11-18)

Colours: @minty/shared colors.css roles only (owner 2026-11-18); one bill-status map in lib/billStatusDisplay.ts; no raw hex — **tests**/no_raw_colours.test.ts. Tones: Draft and Voided Neutral, Payment Requested Info, Paid Success, Partially Paid and Returned Warning, Payment failed and Upload failed Danger. Amounts are plain text, never coloured by status. Kept on purpose (allow-listed in the test): `app/landing` (its Minty Action hexes), ConfirmDialog's orange `#ea9713` (waits for the owner), the full-screen viewer's dark chrome (`bg-black/90` and white on it).

## Question dialogs (owner, 2026-11-17)

Every yes/no question - the four delete/void confirms (`AttachmentDeleteConfirmModal`, `BulkDeleteConfirmModal`, `PaymentDeleteConfirmModal`, `RowDeleteConfirmModal`, through `components/payment-request/ConfirmDialog.tsx`), `OverpaymentWarningModal` and `SubscriptionNoticeModal` - draws minty-web's `ConfirmDialog` (the copy at `features/subscription/components/`, with three local options: `role`, so they stay `alertdialog`s named by their title and described by their body; node labels; `confirmHref` for the notice's link). This replaces 2026-10-13's "Part 14 wins here" for questions (Figma comparison: Independent Minty, node 505:589). Titles, sentences and labels are unchanged; destructive confirms take minty-web's red tone, the rest teal; Escape and the blurred backdrop ("Go back") close. Forms and details (Add Payment, Record payment, Upload, Bank slip details) and the full-screen viewer keep their Part 14 frames for now.

## Add Payment (`components/PaymentRequestModal.tsx`)

The dialog (`role="dialog"`, _Add Payment Request_): amount, description, the **supplier**
(a searchable input over the entity's synced contacts — `BillContactPicker.tsx`; it opens with the note "Type a supplier name to add a new supplier" on top, even with no supplier yet (owner, 2026-11-12); "create
new" makes the contact in Xero; if that fails — e.g. the entity has no Xero connection —
the menu closes, the field turns red and the API's message shows under it until the name
is edited; a new supplier's name over 100 characters says "Keep the supplier's name to 100
characters or fewer." under the field as it is typed, and the create option is held until it
is shorter - the API refuses the same, since `Bill.contact_name` holds 100), the **account code** (a combobox over
`entity_bill_account_xero`), bill number (with a suggested reference from
`GET /api/bills/suggested-reference/`), invoice date and due date (`#pr-invoice-date`,
`#pr-due-date`, native date inputs behind a formatted overlay — `DateTextField.tsx`), and
the attachments drop zone (`input[aria-label="Choose files to attach"]`; pdf, jpg, png,
html — **no spreadsheets since 2026-10-09**, so every accepted type is one the browser can
draw; every file is uploaded exactly as chosen - no shrinking here (`lib/compressImage.ts` is gone);
the API stores a photo as a 2048 px JPEG and any other file as uploaded (the user, 2026-11-26)). The allowlist is the shared
`ATTACHMENT_ACCEPT` / `isAllowedAttachment` from `lib/fileAttachmentPreview.ts`, so this
modal, the upload-invoice modal and the bank-slip modal agree by construction.

**Phone camera and iPhone HEIC (the user, 2026-11-24).** No "Take photo" button: the `accept`
list mixes images and PDF, so iOS's sheet offers Take Photo / Photo Library / Choose File and
Android's chooser offers its camera; there is no `capture` (it would skip Files and PDFs). JPEG
is listed first, so iOS hands a HEIC photo over as JPEG; a real HEIC (Files, a Mac, Android
"high-efficiency" photos) is taken and stored as it is, and `application/octet-stream` counts as
no type (the extension decides, as the API does). `PreviewBlock` draws a HEIC as it is where the
browser can (Safari 17+); where the `<img>` fails, a saved one is fetched through the API's
`/preview/?as=jpeg` (`lib/previewProxy.ts`), a JPEG made on the fly, and a staged one says "This
photo can be viewed once it's saved." Saved invoice attachments carry the proxy path for HEIC
as for PDF; a saved HEIC bank slip goes through the fetched preview, not its presigned URL. The
reader offers "Read invoice" for a HEIC too. The server
(`attachment_service.py`) still accepts Excel — it is shared with bank slips and with Xero
re-publish of bills that already hold one — so narrowing it is a separate decision.

**Refusals (2026-11-04).** Messages follow Part 11 (the issue, then the action), one wording for
the new-bill dialog, the bill and draft edit forms and the upload dialogs (`lib/formMessages.ts`),
e.g. "The amount is still empty. Add the amount to continue.", "scan.pdf is over 10 MB. Choose a
file up to 10 MB.". A refused Confirm with two or more problems shows `@minty/shared/ui`'s
`ErrorSummary` (`look="classic"`) at the top of the form: it takes focus and links to each field,
in the form's order. One problem moves focus to its field. A required field's label carries a
screen-reader-only "(required)" beside the red `*` (`components/RequiredMark.tsx`). Save as Draft
is never blocked.

**The invoice reader** (owner, 2026-11-04; `lib/invoiceReader.ts` on `@minty/shared/reader`,
the rules shared with Petty Cash's receipt reader; the API side is minty-payment-request-api's
`docs/features/invoice-reader.md`). **Read only on a press** (owner, 2026-11-18): staging a
PDF, JPEG or PNG reads nothing; **Read invoice** (`ReadButton` from `@minty/shared/reader`) shows
under the drop zone only when `GET /bills/extract/status/` (fetched as the dialog opens) says the
reader is on. **One file per read, the person's choice:** it reads the file selected in the list
(the preview), else the newest readable one; with two or more readable files a line says which
("Reads invoice.pdf. To read another file, select it above."). The press sends that file to
`POST /bills/extract/` (an HTML file is never offered). The button goes after the press and comes
back after a failed read or when another file is selected; a new file offers it again.
**The company's AI allowance** (its grants, shared with Petty Cash): "80% of your AI allowance
left" beside the button (its description; it stays after the read), updated from each read's
answer (`onStatus`); used up, the button is disabled with the reason beside it, and
`limit_reached` is not the failure line. A failed read uses none of it. While it reads, "Minty is reading the
invoice details." shows in its place and the form stays usable. **The caution** (owner,
2026-11-19): once a read has filled, noted or offered anything, `AiCaution` sits under the fields,
above the buttons - "AI suggestions may be inaccurate." (one sentence since 2026-11-23, owner;
the same in Petty Cash) - and is Confirm's and Save as Draft's
description. It stays while the person edits and goes when the bill is saved, the dialog is
reopened, or the read file's suggestions go (another file read, or that file removed).
**An invoice in another currency** (owner, 2026-11-19): the API converts the amount at Frankfurter's
rate (minty-payment-request-api `docs/features/invoice-reader.md`), so it fills like any amount
(an older API's unconverted foreign amount is still only offered in a note). Its line reads
"Suggested from the invoice. Converted from USD 12.34 at 1 USD = 7.85 HKD (13 Nov 2026 rate)." (the rate as `rateText` writes it, owner 2026-11-24: "1 {stronger} = n {weaker}", 2 decimals rounded - "1 HKD = 7.43 PHP" for a peso invoice; plus
", the last business day before ..." when a weekend or holiday moved the rate's day); the caution
stays the one sentence. Draft and Confirm send `exchange` (`exchangeFields`) only while the amount
still holds the converted figure; another amount drops it. The description gets the original amount and the rate after what was read (owner, 2026-11-23): "Office chairs (PHP 10,000.00 @ 1 HKD = 7.43 PHP)" (`@minty/shared`'s `exchangeNote`, owner's launch decisions), or that alone - only when this read's converted amount filled the Amount box, never over a typed description. No rate: the amount stays empty with "I
couldn't get an exchange rate for TWD. Enter the amount in HKD." under it.
**Several invoices in one file - the only refusal** (the user, 2026-11-25; `no_description` is
gone, the description is not mandatory): the API answers `{suggestions: null, reason:
"several_documents"}`, through `useDocumentReader`'s `onRefused`, and an OK-only question opens
(`ConfirmDialog`, `acknowledgeOnly`): "More than one invoice" - "This file seems to contain more
than one invoice. Please upload one invoice per entry." (`SEVERAL_INVOICES`). Nothing is filled,
the file stays, and nothing is blocked; another read or file takes it away. **The outlines after a
read** (the user, 2026-11-25; `@minty/shared` v0.38 `outlined`/`outlineRing`, set at the end of
`withInvoiceSuggestions`): a field the read left empty is outlined red (`EMPTY_RING`) - a warning
only (the Description included, never mandatory); a required field keeps its own red border and
sentence instead. Orange (`CHECK_RING`), the line "Please check." in the warning ink: an inferred
description ("Please check. Compare the description with the invoice." - it may be a summary of listed items) and its
account ("Please check. Chosen to match the description."), and a supplier not on the list
("Please check. It isn't in your suppliers yet, ..."). Other filled fields keep the teal ring.
Typing takes a field's outline away; Clear its orange; another file all of them. **Required fields a read left
empty** (owner, 2026-11-23): after a read that filled anything, the supplier, account, amount and
the two dates still empty turn red at once with their own sentences (`lib/formMessages.ts`) - with
no error summary and no focus move, which stay a refused Confirm's (`ErrorSummary` shows only once
Confirm has been refused).
**A wrong or poor invoice is warned about, never refused** (the user, 2026-11-24): every photo
attached (picked or restored) gets the free photo check (`photoQuality`, no AI), and a finding is
said under the upload by file name - "receipt.jpg looks blurry. Check that it can be read, or take
a clearer one." (also "looks too dark" / "is very small"; PDFs are not checked). After a read,
the API's `document_warning` says what the file may be instead ("This looks like a bank payment
confirmation, not an invoice. ...", "This doesn't look like a receipt or invoice. ...", "This
document is hard to read. ...") beside whatever filled; on a refused read it replaces the general
no-evidence line. Nothing is blocked.

- **Filling:** a suggestion fills the supplier (by its Xero id from the company's list), the
  invoice and due dates, the amount (in the company currency's places), the description and the
  account (by code, from the select's options) - only an **empty** field, or one still at its
  **untouched default** (today's invoice date, the company's default account). Re-picking a
  default counts as touching it. A filled field gets the teal ring and "Suggested from the
  invoice." ("... Check it before you submit." for the medium band) with Clear; Clear puts a
  default back. Editing a field makes it the person's. A field holding the person's value keeps
  it, and the invoice's different reading is offered in a grey note with "Use the value from the
  invoice"; the low band only offers. An amount in another currency than the company's is only
  offered. When the invoice prints another name than the picked supplier's (the API picks the same or
  a similar one, the user 2026-11-23), the supplier's line adds it - "Suggested from the invoice.
  The invoice reads "滬江"." (`readNameDetail`, from `read_name`) - so a wrong "similar" pick is
  easy to spot. A supplier name that matches nobody goes into the supplier box. With the API's signed
  `new_supplier_token` (the user, 2026-11-23) it is a new supplier:
  - the box is ringed, and the line under it adds "It isn't in your suppliers yet, so it's added
    when you save this payment.";
  - it counts as the supplier for Confirm;
  - Save as Draft and Confirm send `new_contact_token` with its name, and the API adds the
    supplier with the bill (for anyone who may add a bill);
  - typing over the name or picking another supplier drops it. The read creates nothing;
  - the local draft (L1, shape 2) keeps it.

  Without a token (an older API) the name is only typed text, and the picker's "+ Add ... as a new
  supplier" offers it. The account is always the closest one the reader finds (minty-shared-py
  v0.13). The bill number is never read. A filled field
  is never left red. One polite live region says what was filled or offered.

- **Cancelled by:** another readable file added, or another file read (its predecessor's
  suggestions go; typed values stay),
  removing the file that was read, closing or reopening the dialog, Save as Draft and Confirm.
- **When it can't read:** one quiet line, "I couldn't read this invoice. Enter the details
  yourself." (`role="status"`). Switched off (`disabled`/`not_configured`) is silent and the
  reader stays off for the tab's session (`sessionStorage` `minty.prw.invoice-reader`).
- Tests: `components/__tests__/PaymentRequestModal.reader.test.tsx`.

A staged file previews in place, and its top-right **View full** control opens the
full-screen viewer over the dialog.

### Required fields

**A mandatory field says so before anything is attempted**: a red `*` on its label from the
moment the dialog opens, and the control turns red only once Confirm has actually been refused.
An untouched form is never shown as an error.

- The mark is `components/RequiredMark.tsx`. It is **`aria-hidden`**, because an asterisk read
  aloud is "star"; requiredness is announced on the CONTROL instead, via `aria-required`
  (`DateTextField`, `ThemedSelect` and `BillContactPicker` each take a `required` prop for
  this) or the native attribute. Both halves are needed - the mark for the eye, the attribute
  for everyone else.
- `FieldLabel`'s `required` prop renders it, so Amount, Supplier, Account Code, Invoice Date
  and Due Date get it for free. Payment No. and Description are optional and stay unmarked.
- **The attachments group was the gap (fixed 2026-10-09):** it is a `<p>`, not a `FieldLabel`,
  so it had no `required` prop to set, and its drop zone was hard-coded `border-gray-300` and
  never reddened - unlike every other control here. It now carries the mark, and the drop zone
  red-lines off `fieldErrors.attachments`, which `clearFieldError` already resets when a file
  arrives, so no new state was needed.
- The same treatment is on `UploadInvoiceAttachmentModal` and `BankSlipDetailsModal`. Two
  cautions there: the bank slip only shows the mark when `showInlineUpload` is set, because
  that dialog also just _lists_ saved slips; and both red-line off
  `uploadError && <staged> === 0`, never `uploadError` alone, since that also carries **API
  failures** - a failed POST leaves its files staged, a refused file does not, so blaming the
  drop zone for a server fault is avoided.
- In the bank-slip dialog, pressing Upload with nothing staged is **not reachable** - the
  button is disabled until a file is staged - so the red there comes from a _refused_ file
  (wrong type or too big), which is the path a test covers.

Two buttons: **Save as draft** (`POST /api/bills/draft/`, nothing validated) and
**Confirm** (`POST /api/bills/submit/`): the form validates the amount, supplier, account,
both dates and _at least one attachment_ before sending, shows each field's error inline
(`role="alert"`), uploads the files right after the bill exists, then opens the new
request's detail page. A file that fails to upload is named in a warning toast and the
request stays submitted without it; the API then refuses to **publish** a request with no
attachment ("Add the invoice attachment to publish this payment request.", owner 2026-10-27),
which every publish path shows as an error toast in those words.

The files go up **one per call** (`lib/uploadAttachments.ts` `uploadEachAttachment`), so one
refused file does not take the others with it. The request exists by then, so a failed file is
never "didn't save": Confirm shows a warning toast - "Payment request for {supplier} sent, but
{files} didn't upload. Edit the request and add it again." - and still opens the request; Save
as draft says "Draft saved, but {files} didn't upload. Edit the draft and add it again." and
opens the draft (only a clean draft just closes the dialog). Until 2026-10-20 both were only
logged. The detail page's Save and a draft's Submit do the same: the save finishes (the bill is
re-read, edit mode closes) and a warning names the files to add again.

## The detail page (`/entity/<shortid>/<name>/payment-request/<Payment No.>`)

- **Unsaved changes in edit mode (owner, 2026-11-17):** while a field differs from where editing began, a file is staged, or one of the request's files was taken off, a link out (the sidebar, the list, "‹ Back"), the browser's Back and **Cancel** ask "Leave without saving?" in the page - minty-web's `LeaveDialog` (`features/subscription/components/InterruptedDialogs.tsx`, portalled above the sidebar drawer) over `@minty/shared/leaveGuard`. Go Back stays with the changes; Discard changes puts the saved request back (`handleCancel`) and goes on. Nothing changed: Cancel and every link leave at once. A reload or a closed tab leaves without asking (no native browser dialog) - what was typed is kept as an auto-saved draft (below). The other forms (Add Payment, Record payment, Upload) don't ask: Add Payment's X, Escape and backdrop close it at once and **keep** what was typed as its auto-saved draft (the safety net), while its **Cancel** throws it away; Record payment and Upload keep nothing (owner chose the detail page only for the question).

Addressed by the Payment No. (the bill's `reference`) since 2026-10-05, the id when there is none
(`lib/companyPages.ts` `pages.request(id, reference)`). `lib/useRequestId.ts` turns the address
into the bill id: an id as it is, a Payment No. through `GET /bills/by-reference/...` (case-
insensitive; once, shared by the body and the header badge). Once the request has loaded, an id
address (Flask's `?request=<id>` hand-off, an old link) is replaced by the Payment No. one, and an
edit that changes the Payment No. moves the address with it (`router.replace`, so Back is
unchanged). A Payment No. the company does not have shows "I couldn't find that payment request".

**"‹ Back"** in the header (`components/layout/Header.tsx`, "‹ Payments" until 2026-11-13) goes
back to the page the person came from - the list, or another request whose payment history linked
here (`@minty/shared/backLink` v0.20). With nothing in this app before it (a link, a new tab, the
hand-off), it goes to the list, which is also its `href` for a middle-click. The list's tabs and
filters live in the page, not the address, so the list comes back at its default view.

A **voided** request is always addressed by its id (`pages.request(id, reference, status)` with
`void` / `Voided`; every list link, row click and payment-history link passes the status): void
bills are left out of the Payment No. uniqueness check, so a live request may reuse it, and the
by-reference lookup prefers the live one. The detail page keeps a voided request on its id
address (moving it there from the Payment No. one, e.g. right after Void) and drops the
remembered Payment No.
(`forgetRequest`), so a reload opens the voided request and the next lookup of that Payment No.
is fresh.

`PaymentRequestDetailBody.tsx` for a submitted-or-later request,
`EasyViewDraftDetailBody.tsx` for a draft. What it holds:

- the header with the status badge (`PaymentRequestDetailStatusBadge`) and the **action
  bar** (`BillActionBar.tsx`): Edit / Save / Cancel, the draft's Submit button, and the
  _payment actions_ menu (`aria-label="More payment actions"` → `role="menu"` "Payment
  actions") with **Publish** (or **Republish** once `bill.published === "published"`) and
  **Void** / Delete; while a publish runs, a `role="status"` "Publishing…" is shown and
  the trigger is disabled; a failure is an error toast (`components/Toast.tsx`,
  `role="alert"`). Elevated roles only for publish, void, return and payments
  (`useUserRole`). While the request is being edited, **Publish** / **Republish** is greyed
  with "Save your changes first, then publish." under it in the menu (`publishDisabledReason`,
  the item's `aria-describedby`; 2026-11-20): a publish sends what is saved, not what is being
  typed. Void / Delete stay offered behind their question.
- the attachment preview (`InvoiceAttachmentPreview.tsx`, PDFs rendered with pdf.js from
  `/public/pdfjs` — `@minty/shared/pdfPreview`'s `PdfJsCanvasPreview`; images inline) with upload / delete
  (`UploadInvoiceAttachmentModal`, `AttachmentDeleteConfirmModal`) — the bytes are fetched
  through the backend's `…/preview/` proxy;
- the details card (`PaymentRequestDetailedInfo.tsx`, editable in place). Editing the
  supplier (here and in Easy View's draft edit) needs a pick from the list, or a new supplier,
  only when its text changed from the saved one (owner's decision): a changed name with no
  `xero_contact_id` is refused with "Pick the supplier from the list, or add them as a new
  supplier." where the supplier error shows (`supplierNeedsPick`,
  `lib/paymentRequestBillMap.ts`), while an untouched older request with no Xero contact still
  saves;
- **payments** (`PaymentHistoryCard.tsx`, `RecordPaymentModal.tsx` — date, amount, method,
  reference; the date defaults to today on the person's own clock (`todayLocalISODate`,
  `lib/dateDisplayFormat.ts`, shared with the Add Payment dialog), never UTC's day; `OverpaymentWarningModal` when the sum would exceed the bill;
  `BankSlipDetailsModal.tsx` uploads the slip onto the bill's payment (the newest pending,
  else the newest settled, never an old 0.00 slip holder beside a real one) and can push it to
  the Xero invoice, then closes once the caller has refreshed (a failed refresh is logged,
  never rolled back). **It never creates a payment** (2026-11-03; it used to make a 0.00 one
  with no date to hold a slip): with no payment yet, inside Record Payment the slips wait
  ("Bank slip ready: …") and go onto the payment Add Payment creates; from a list row it says
  "This request has no payment yet. Record the payment first, then attach its bank slip.";
  `PaymentDeleteConfirmModal`);
- the **Activity history** (`ActivityHistoryAccordion.tsx`) rendering the backend's audit
  rows — "submitted", "published to Xero", "uploaded receipt.pdf", "recorded a payment of
  HKD 1,200.00". It sits on the request's own page, so an entry never repeats the request's
  name. It starts collapsed; opening it scrolls the section into view, closing it scrolls
  back to where the page was. A failed read says so ("I couldn't load the history…") with
  Try again, never "No activity yet". The header's status badge sits after the title, and
  on its own line under the header below 640 px.

Return / un-return / void go through the same action bar with the backend's transitions;
`lib/billStatusRollback.ts` keeps the optimistic status honest when a call fails.

**A contact archived in Xero** (owner's decisions C4, 2026-11-19). A contact Xero merged is
followed by the API to the contact Xero kept, with no question. One Xero archived without a merge
refuses the publish (409 with `archived_contacts`; nothing was sent; `ApiError.body` carries the
answer, `archivedContactsOf` in `lib/api.ts` reads it). On a single request (the detail page and
Easy View's settled request) a form dialog opens instead of the toast
(`components/payment-request/ArchivedContactsDialog.tsx`, Upload Attachment's frame: a full-width
sheet on a phone, a 520px card from 640px; Escape and the backdrop close it): "A contact is
archived in Xero" ("Some contacts..." for several), per contact the doc's sentence "<Name> is
archived in Xero. Restore it in Xero, or map it to another contact now." and a searchable "Map
<Name> to" picker (`ThemedSelect`) of the company's active Xero contacts
(`GET /entity-bill-contacts/xero/`, read once on open), then "Or restore it in Xero, then publish
again.". **Go back** changes nothing; **Map and publish** stays greyed, its reason beside it,
until every contact has a pick, then sends `POST /entity-bill-contacts/<id>/xero-link/` for each,
toasts each answer's sentence and publishes again. A refused mapping shows its sentence in the
dialog, which stays open; a contact already mapped is not sent twice. **The list** (Bulk Actions'
Publish, a row's Publish and Republish; 2026-11-19) goes through `PaymentRequestView`'s
`publishBills` and `lib/bulkPublish.ts`'s `publishEach`: every bill is sent and every answer waited
for (one refusal no longer hides what the others did), then the list is read again. Bills held back
over archived contacts open the same dialog, each contact once however many bills share it, and
once mapped only those bills are published again; any other refusal is one error toast
(`failedSummary`: "2 payment requests weren't published." and each distinct sentence once; a single
row's own sentence; a Xero sign-in refusal reads as the reconnect sentence). After a bulk publish the
bills that went leave the selection and the ones that did not stay picked. Rows are picked at every
width (2026-11-19, the owner's mobile-first rule): the card list below 1024px has each card's
checkbox in a 44px tap target, and on a phone the toolbar puts search on its own line with Filter,
Download CSV and Bulk Actions on the next (one line from 640px). Minty never restores anything in the customer's Xero.

## Auto-saved drafts (owner's decisions doc L1, 2026-11-20)

What the person types is kept **in this browser only**, 2 seconds after their last change, as a
separate copy - never the real request, which only their own Save writes (`@minty/shared/drafts`
`useAutoSaveDraft` and `ui`'s `DraftRestore`, v0.33; the package README's "Auto-saved drafts" has
the storage, limits and expiry). Kept per person and company (`lib/draftScope.ts`
`currentDraftScope()`, the token's `user_id` and `entity_id`); card details are never kept.
When the form opens again the draft is **put back at once, with no notice and nothing to pick**
(the user, 2026-11-24; v0.28's Restore / Discard question is gone). Files too large to keep are
simply not among the restored ones.

| Form                                                   | Key (`form`, `record`)      | What is kept                                                                                                                                                                                                                                                                         | Removed by                                                                                                                                       |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add Payment (`PaymentRequestModal.tsx`)                | `pr.add-payment`, `new`     | due date, amount, description, supplier (id, name and the typed text), account; the Payment No. and invoice date only when the person changed them (otherwise the fresh suggestion and today stand); the picked files (IndexedDB). Never the invoice reader's marks or exchange rate | Save as Draft and Confirm succeeding, **Cancel**. The **X, Escape and the backdrop keep it** (a pending save is written as the dialog closes)    |
| A request's Edit (`PaymentRequestDetailBody.tsx`)      | `pr.bill-edit`, the bill id | the edit's fields and the request's files taken off; the staged files                                                                                                                                                                                                                | Save Changes (and a draft's Submit) succeeding, Cancel or the leave dialog's Discard changes (`handleCancel`), deleting the draft request, stale |
| Easy View's draft edit (`EasyViewDraftDetailBody.tsx`) | `pr.easy-view`, the bill id | the inline fields                                                                                                                                                                                                                                                                    | Save Changes succeeding, Cancel, stale                                                                                                           |

- Add Payment's draft is read only once the suggested Payment No. has come back, so the restore
  is never overwritten by it. It puts the values back as the person's own (a later read only
  offers the invoice's reading beside them) and adds the files to the list.
- A request's (and Easy View's) restore enters edit mode from the request **as it is now**, with
  the draft's fields over it, its staged files back in the preview and its taken-off files taken
  off again - only those the request still has.
- **Stale:** an edit is kept against the request's `updated_at`. If the request was saved again
  since, or this person can no longer edit it (view-only, voided, or locked for their role -
  `billDraftBasis`), the draft is **dropped silently** - removed, never put back, nothing shown.
- An explicit sign-out (the sidebar's Logout, My Profile's Log Out: `components/ui/sidebarHost.ts`
  `endSession`) removes this person's drafts in this app within 500 ms, before the cookies go. A
  session that expires on its own (a 401, "Your session has expired") keeps them - that is one
  of the things they exist to survive.
- Tests: the "auto-saved draft" cases in `PaymentRequestModal.test.tsx`,
  `PaymentRequestDetailBody.test.tsx` and `EasyViewDraftDetailBody.test.tsx`, the sign-out cases
  in `sidebarHost.test.ts` (files in `test/draftFiles.ts`'s in-memory store), and
  `e2e/18_auto_save_drafts.spec.ts` (stubbed; 360 and 1440: type and attach, reload, the fields
  and the file are back with no notice, Save as Draft clears it).

## The duplicate reminder before a save (owner's decisions doc DUP1, 2026-11-19)

Just before a bill is saved, the API warns when another bill (not voided, not this one) has the
same date, supplier and amount - only once all three are filled in. Add Payment's Save as Draft
and Confirm (`POST /bills/draft/`, `POST /bills/submit/`) and the detail page's and Easy View's
Save Changes / Submit (`PUT /bills/{id}`) may answer 409 `{detail, duplicates: [{id, reference,
contact, amount, invoice_date}]}` with nothing saved (`duplicateBillsOf` in `lib/api.ts` reads
it from `ApiError.body`). The form asks with
`components/payment-request/DuplicateBillDialog.tsx` (minty-web's `ConfirmDialog`, z 440, above
Add Payment): "Save it anyway?", the API's sentence and each matching bill as reference ·
supplier · amount · date (`PR-0002 · ABC Furniture · HKD 6,000.00 · 03 Mar 2026`). **Go back**
(also Escape and the backdrop; Add Payment leaves that Escape to the question) closes it with the
form exactly as typed; **Save anyway** sends the same body again with `confirm_duplicate: true`
and carries on as a normal save (attachments, toasts, navigation). It never blocks. Any other 409
keeps its old handling. The two status roll-backs the app makes after a payment is deleted
(`PUT /bills/{id}` with only `status: "submitted"`, in the detail page and Record payment) send
`confirm_duplicate: true`: they save none of the bill's details, so DUP1 never asks there. Tests:
`lib/__tests__/duplicateBills.test.ts`, and a DUP1 block in `PaymentRequestModal.test.tsx`,
`PaymentRequestDetailBody.test.tsx` and `EasyViewDraftDetailBody.test.tsx`.

## No Publish for a company keeping its books in Minty (Xero optional, 2026-11-10)

`lib/useMintyOnly.ts` asks `GET /api/auth/xero-status` once per company (`minty_only`). For such a
company `BillActionBar` draws no Publish to Xero (neither the button nor the overflow menu's Publish /
Republish), the list toolbar offers none (`canPublish`), and (2026-11-18) the table's row menu has
no Publish / Republish, its rows no Xero mark (the actions header spans one column), and the filter
panel no Xero Status (`mintyOnly` on `PaymentRequestTable` and `PaymentRequestToolbar`); the API
refuses one anyway (422 with its sentence). For a Xero company the row mark's text is the bill's
state, "Published to Xero" / "Not published to Xero". A new supplier toasts "Supplier added." when
the API answers it with no `xero_org_id` (kept in Minty), "Supplier added to Xero." otherwise; an
empty account says "Choose an account to continue." for every company. Its suppliers may be Minty's own, named by their row id - the picker, the bill and its edit
take that id as they take a Xero one. Tested in
`components/payment-request/__tests__/BillActionBarMintyOnly.test.tsx`; checked in a browser at
360/768/1440 against the local stack (a bill with a Minty supplier and code, no Publish anywhere).

## Previewing a file: full screen, never a new tab

**The rule (the user's, 2026-10-09): a file always opens a full-screen preview in-app. It
never opens a new tab and it never downloads.** Every preview surface used to be wrapped in
an `<a target="_blank">` (`FullFilePreviewLink`), so clicking a staged receipt left the app;
that component is gone, along with the unused `FileAttachmentPreviewLayer` and the
"Open PDF in new tab" link in `PdfJsCanvasPreview`'s error state.

- **One component, shared since `@minty/shared` v0.37** (2026-11-24, so Petty Cash's receipts
  preview the same way): `@minty/shared/filePreview`, imported through `lib/filePreview.ts`,
  which registers this app's outlined icon font and `fetchProxyBlob`; the pdf.js renderer is
  `@minty/shared/pdfPreview` and `next.config.ts` copies its assets with the preset's
  `copyPdfjsAssets`. Add Payment's inline pane is the package's `FilePreviewPane`. It owns
  `PreviewBlock` (image / pdf.js canvas / sandboxed iframe / "Preview is not available for
  this file type."), `usePinchZoom`, the `ViewFullButton` every inline pane puts in its
  top-right corner, and the overlay itself — a portal at `z-[340]`, above the modals'
  `z-[300]`, `role="dialog" aria-modal`, with Reset zoom and a 44px Close.
- **Escape unwinds one layer at a time.** The viewer listens on `window` in the **capture
  phase** and calls `stopImmediatePropagation()`. The three modals it opens over each keep a
  bubble-phase `window` listener registered earlier, and a window capture listener runs
  before every window bubble listener whatever the order — so one Escape closes the viewer
  and leaves the modal open. Those modals deliberately have **no** `viewerOpen` branch.
- **Focus** starts on Close, is trapped, and returns to the opener on unmount (with a
  fallback: the opener may have been removed, e.g. the file was deleted).
- **The scroll lock is reference counted** (`lib/appScrollRoot.ts`, which re-exports
  `@minty/shared/scrollLock` since v0.37, so this app's modals and the packaged viewer share one
  count). Save-and-restore was
  only safe if cleanups ran strictly LIFO, which React does not guarantee when a parent and
  child unmount in one commit; the out-of-order case left `overflow: hidden` on for good.
- **The viewer creates no object URL.** The caller owns the URL's lifetime and renders the
  viewer only while `previewFile && previewObjectUrl` hold, so removing a file mid-view
  unmounts it in the same commit as the revoke.
- **A reported mime is not trusted** (`resolvePreviewMime` / `nameToPreviewMime`): drag-drop
  can leave `File.type` empty and B2 calls a PDF `application/octet-stream`. Either would
  send a perfectly drawable file to the "cannot preview" card, so the extension decides.
- Surfaces: the Add Payment Request modal, `UploadInvoiceAttachmentModal` (which had no
  enlarge control at all), `BankSlipDetailsModal` (staged, saved and auth-proxy-fetched), and
  `InvoiceAttachmentPreview` on the detail page and easy view.

## Tests

`__tests__/no_new_tab_file_links.test.ts` is the regression lock: it reads `components/`,
`lib/`, `features/` and `app/` and fails on any `target="_blank"`, `window.open` or
`download=` outside a short, self-checking list of genuine external links, and holds that this
app draws no full-screen viewer of its own. The viewer's own tests (the dialog contract, the
capture-phase Escape, focus return, mime resolution) live with it in `@minty/shared`
(`src/filePreview/__tests__/FilePreview.test.tsx`), plus and the preview cases in `PaymentRequestModal.test.tsx`,
`BankSlipDetailsModal.test.tsx` and `InvoiceAttachmentPreview.test.tsx`.

`e2e/02_bill_lifecycle.spec.ts` (draft → listed under Draft; the amount is required;
Confirm without attachment/due date shows both alerts; the draft's detail page) and
`e2e/04_xero_publish.spec.ts` with `E2E_XERO=1` (a complete request confirmed → Payment
Requested → Publish → Republish offered, also after a reload). `e2e/16_back.spec.ts` (stubbed):
the detail page's Back from the list, from another request, and with nothing before it.
`e2e/18_auto_save_drafts.spec.ts` (stubbed): Add Payment's auto-saved draft across a reload.
