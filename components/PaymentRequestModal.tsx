"use client";

import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useAutoSaveDraft, type DraftOffer } from "@minty/shared/drafts";
import { DraftNotice } from "@minty/shared/ui";
import { pushAppScrollLock } from "@/lib/appScrollRoot";
import { getEntityIdSnapshot } from "@/lib/auth";
import { currentDraftScope } from "@/lib/draftScope";
import { useEntityCurrencyState } from "@/lib/entityCurrency";
import { hubSettingsUrl } from "@/lib/mintyUrls";
import { useClientValue } from "@/lib/useClientValue";
import {
  formatFileSize,
  isAllowedAttachment,
  ATTACHMENT_ACCEPT,
} from "@/lib/fileAttachmentPreview";
import {
  AttachmentFullScreenViewer,
  fileToPreviewItem,
  PreviewBlock,
  ViewFullButton,
} from "@/components/payment-request/AttachmentFullScreenViewer";
import { saveAttachmentBlobs } from "@/lib/paymentRequestAttachmentStore";
import { parseAccountField } from "@/lib/paymentRequestBillMap";
import { ThemedSelect, type ThemedSelectOption } from "@/components/ThemedSelect";
import { RequiredMark } from "@/components/RequiredMark";

import { BillContactPicker } from "@/components/BillContactPicker";
import {
  ApiError,
  dedupeEntityBillContactsForPicker,
  extractInvoice,
  fetchEntityBillAccounts,
  fetchEntityBillContacts,
  fetchInvoiceReaderStatus,
  fetchSuggestedBillReference,
  isDuplicateBillReferenceError,
  saveBillDraft,
  submitBill,
} from "@/lib/api";
import type { EntityBillContact } from "@/lib/api";
import { DateTextField } from "@/components/DateTextField";
import {
  DuplicateBillQuestion,
  useDuplicateBillQuestion,
} from "@/components/payment-request/DuplicateBillDialog";
import { todayLocalISODate } from "@/lib/dateDisplayFormat";
import {
  MAX_AMOUNT_INT_DIGITS,
  amountIntegerDigits,
  cleanAmountString,
  toAmountString,
} from "@minty/shared/money";
import { useAmountInput } from "@minty/shared/amountInput";
import { ErrorSummary } from "@minty/shared/ui";
import {
  cleared,
  AiCaution,
  convertedText,
  exchangeFailedOf,
  exchangeFields,
  exchangeKept,
  exchangeOf,
  type Exchange,
  AllowanceNote,
  ReadButton,
  ReaderNote,
  ReadFailedLine,
  ReadingNotice,
  SuggestedLine,
  SUGGESTED_RING,
  useDocumentReader,
  type ReaderStatus,
  usedNote,
  withoutSuggestions,
} from "@minty/shared/reader";
import {
  CLEAR_LABEL,
  edited,
  INVOICE_LATCH,
  invoiceSpec,
  invoiceState,
  READ_FAILED,
  READ_LABEL,
  READING_DETAIL,
  READING_TITLE,
  showedAnything,
  rateMissingText,
  suggestedText,
  USE_LABEL,
  withInvoiceSuggestions,
  type InvoiceField,
  type InvoiceState,
  type InvoiceSuggestions,
  type InvoiceValues,
} from "@/lib/invoiceReader";
import { useCompanyPages } from "@/lib/useCompanyPages";
import { joinNames, uploadEachAttachment } from "@/lib/uploadAttachments";
import { useToast } from "@/components/Toast";
import {
  ACCOUNT_EMPTY,
  AMOUNT_EMPTY,
  AMOUNT_TOO_LONG,
  AMOUNT_ZERO,
  ATTACHMENT_MISSING,
  DUE_DATE_EMPTY,
  INVOICE_DATE_EMPTY,
  SUPPLIER_EMPTY,
  filesNotOpenable,
  filesTooBig,
} from "@/lib/formMessages";

export type PaymentRequestModalProps = {
  open: boolean;
  onClose: () => void;
  onSaveDraft?: () => void;
  onCancel?: () => void;
  onConfirm?: () => void;
};

type UploadedEntry = { id: string; file: File };

const stagedEntry = (file: File): UploadedEntry => ({
  id:
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
  file,
});

/** The lines beside "Read invoice": which file it reads, and the company's AI allowance left. */
const READ_TARGET_ID = "pr-ai-read-target";
const ALLOWANCE_ID = "pr-ai-allowance";
const AI_CAUTION_ID = "pr-ai-caution";

/** What the invoice reader can read: the model takes PDF, JPEG and PNG (the form takes HTML too). */
const READABLE = /\.(pdf|jpe?g|png)$/i;
const isReadable = (file: File) =>
  /^(application\/pdf|image\/jpe?g|image\/png)$/i.test(file.type) || READABLE.test(file.name);

/** Material Symbols icon + color for uploaded file row (Google Material Icons naming). */
function getUploadedFileIconInfo(filename: string): { icon: string; iconClass: string } {
  const ext = filename.trim().split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") {
    return { icon: "picture_as_pdf", iconClass: "text-status-danger-ink" };
  }
  if (
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "png" ||
    ext === "heic" ||
    ext === "heif" ||
    ext === "webp" ||
    ext === "gif"
  ) {
    return { icon: "image", iconClass: "text-status-info-ink" };
  }
  if (ext === "html" || ext === "htm") {
    return { icon: "html", iconClass: "text-status-warning-ink" };
  }
  return { icon: "draft", iconClass: "text-text-secondary" };
}

type ValidatedField =
  "billNo" | "amount" | "contact" | "accountCode" | "invoiceDate" | "dueDate" | "attachments";

/** Each validated field's control, in the order the form shows them (the summary's order). */
const FIELD_ID: Record<ValidatedField, string> = {
  attachments: "pr-attachments",
  billNo: "pr-bill-no",
  invoiceDate: "pr-invoice-date",
  dueDate: "pr-due-date",
  amount: "pr-amount",
  contact: "pr-contact",
  accountCode: "pr-account",
};
const SUMMARY_ORDER = Object.keys(FIELD_ID) as ValidatedField[];

/** A reader field's validation key, so a field the reader fills is never left red. */
const ERROR_KEY: Record<InvoiceField, ValidatedField | null> = {
  supplier: "contact",
  invoiceDate: "invoiceDate",
  dueDate: "dueDate",
  amount: "amount",
  description: null,
  account: "accountCode",
};

/**
 * Live validation error for the amount field, or null when it's acceptable.
 * Tied to the current value so the message clears itself as soon as the amount
 * is valid again (12 or fewer digits before the decimal point).
 */
function amountLimitError(raw: string): string | null {
  if (amountIntegerDigits(cleanAmountString(raw)) > MAX_AMOUNT_INT_DIGITS) {
    return AMOUNT_TOO_LONG;
  }
  return null;
}

/** True when the field is empty (no digits entered). */
function isBlankAmount(raw: string): boolean {
  return cleanAmountString(raw) === "";
}

/** True when the amount has at least one non-zero digit (i.e. > 0). */
function isPositiveAmount(raw: string): boolean {
  const cleaned = cleanAmountString(raw);
  if (!cleaned || cleaned === ".") return false;
  return /[1-9]/.test(cleaned);
}

function validatePaymentRequestForm(values: {
  amount: string;
  contact: string;
  accountCode: string;
  invoiceDate: string;
  dueDate: string;
  attachmentCount: number;
}): Partial<Record<ValidatedField, string>> {
  const e: Partial<Record<ValidatedField, string>> = {};
  if (isBlankAmount(values.amount)) {
    e.amount = AMOUNT_EMPTY;
  } else if (amountIntegerDigits(cleanAmountString(values.amount)) > MAX_AMOUNT_INT_DIGITS) {
    e.amount = AMOUNT_TOO_LONG;
  } else if (!isPositiveAmount(values.amount)) {
    e.amount = AMOUNT_ZERO;
  }
  if (!values.contact.trim()) {
    e.contact = SUPPLIER_EMPTY;
  }
  if (!values.accountCode.trim()) {
    e.accountCode = ACCOUNT_EMPTY;
  }
  if (!values.invoiceDate.trim()) {
    e.invoiceDate = INVOICE_DATE_EMPTY;
  }
  if (!values.dueDate.trim()) {
    e.dueDate = DUE_DATE_EMPTY;
  }
  if (values.attachmentCount < 1) {
    e.attachments = ATTACHMENT_MISSING;
  }
  return e;
}

/**
 * What Add Payment keeps as an auto-saved draft (owner's decisions doc L1, 2026-11-20; bump
 * `ADD_PAYMENT_DRAFT_SHAPE` when it changes). The Payment No. and the invoice date only when the
 * person changed them - otherwise the dialog's fresh suggestion and today's date stand. The
 * invoice reader's state (its marks and exchange rate) is never kept.
 */
type AddPaymentDraft = {
  billNo: string | null;
  invoiceDate: string | null;
  dueDate: string;
  amount: string;
  description: string;
  contact: { id: string; name: string };
  contactInput: string;
  accountCode: string;
};
const ADD_PAYMENT_DRAFT_SHAPE = 1;

/**
 * The draft keeper, drawn only while the dialog is open: each opening reads the draft afresh
 * and asks first ("You have unsaved changes from 10:42." - Restore / Discard). Closing with the
 * X, Escape or the backdrop keeps what was typed (a pending save is written as it unmounts);
 * the dialog calls `clearRef` after its own save and on Cancel.
 */
function AddPaymentDraftKeeper({
  ready,
  value,
  dirty,
  files,
  onRestore,
  clearRef,
}: {
  ready: boolean;
  value: AddPaymentDraft;
  dirty: boolean;
  files: readonly File[];
  onRestore: (offer: DraftOffer<AddPaymentDraft>) => void;
  clearRef: RefObject<(() => void) | null>;
}) {
  const [scope] = useState(currentDraftScope);
  const { offer, restore, discard, clear } = useAutoSaveDraft<AddPaymentDraft>({
    scope,
    form: "pr.add-payment",
    record: "new",
    shape: ADD_PAYMENT_DRAFT_SHAPE,
    ready,
    basedOn: null,
    value,
    dirty,
    files,
  });
  useEffect(() => {
    clearRef.current = clear;
    return () => {
      clearRef.current = null;
    };
  }, [clear, clearRef]);
  if (!offer) return null;
  return (
    <DraftNotice
      savedAt={offer.savedAt}
      stale={offer.stale}
      missing={offer.missing}
      onRestore={() => {
        const taken = restore();
        if (taken) onRestore(taken);
      }}
      onDiscard={discard}
    />
  );
}

function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary sm:text-xs"
    >
      {children}
      {required ? <RequiredMark /> : null}
    </label>
  );
}

export function PaymentRequestModal({
  open,
  onClose,
  onSaveDraft,
  onCancel,
  onConfirm,
}: PaymentRequestModalProps) {
  const router = useRouter();
  const pages = useCompanyPages();
  const { showToast } = useToast();
  // The bill's currency is the company's; with none set (or unreadable) the form can't be sent.
  const currency = useEntityCurrencyState();
  const entityCurrency = currency.code;
  // DUP1: a save that looks like another bill asks first (Save anyway resends with the flag)
  const duplicates = useDuplicateBillQuestion<"draft" | "confirm">();
  const currencyBlocked = currency.status !== "ready";
  const entityId = useClientValue(getEntityIdSnapshot, "");
  const titleId = useId();
  const previewSubtitleId = useId();
  const attachmentsErrorId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadedFiles, setUploadedFiles] = useState<UploadedEntry[]>([]);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const previewFile = previewFileId
    ? (uploadedFiles.find((x) => x.id === previewFileId)?.file ?? null)
    : null;
  const [billNo, setBillNo] = useState("");
  /** The person typed a Payment No. of their own (not the suggested one): the draft keeps it. */
  const [billNoTouched, setBillNoTouched] = useState(false);
  /** The suggested Payment No. has come back (or failed): only then is a draft offered. */
  const [referenceSettled, setReferenceSettled] = useState(false);
  const draftClearRef = useRef<(() => void) | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  /** Xero ContactID (empty while user is typing a new name). */
  const [contact, setContact] = useState("");
  const [contactInput, setContactInput] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  // The invoice reader (lib/invoiceReader.ts): its marks, notes and touched fields. The values stay
  // in their own states above; the reader's rules run on a snapshot of them.
  const [readerAux, setReaderAux] = useState<InvoiceState>(() => invoiceState());
  const [openedOn, setOpenedOn] = useState("");
  // The file whose read the form holds (its suggestions, or the read in flight).
  const [readFileId, setReadFileId] = useState<string | null>(null);
  // "Read invoice" (owner, 2026-11-18): offered only when the API says the reader is on, with the
  // company's AI allowance left (shared with Petty Cash); pressed for a file, the button goes, and comes
  // back after a failed read or when another file is selected
  const [readerStatus, setReaderStatus] = useState<ReaderStatus | null>(null);
  const [readAsked, setReadAsked] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ValidatedField, string>>>({});
  /** Bumped on each refused Confirm, so the summary takes focus again (@minty/shared/ui ErrorSummary). */
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const summaryItems = SUMMARY_ORDER.filter((key) => fieldErrors[key]).map((key) => ({
    fieldId: FIELD_ID[key],
    message: fieldErrors[key] as string,
  }));
  /** Non-field server message (e.g. other 422 validation). */
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [draftSubmitting, setDraftSubmitting] = useState(false);

  const [accountOptions, setAccountOptions] = useState<ThemedSelectOption[]>([]);

  const [contactsList, setContactsList] = useState<EntityBillContact[]>([]);
  const [contactsMap, setContactsMap] = useState<Map<string, EntityBillContact>>(new Map());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    fetchEntityBillAccounts({ billDropdown: true })
      .then((accounts) => {
        if (cancelled) return;
        const opts: ThemedSelectOption[] = accounts
          .filter((a) => a.is_active)
          .map((a) => ({
            value: `${a.account_code} - ${a.account_name}`,
            label: `${a.account_code} - ${a.account_name}`,
          }));
        // No default account code (owner, 2026-11-18): the account starts empty.
        setAccountOptions(opts);
      })
      .catch(() => {});

    fetchEntityBillContacts()
      .then((contacts) => {
        if (cancelled) return;
        const deduped = dedupeEntityBillContactsForPicker(contacts);
        const map = new Map<string, EntityBillContact>();
        for (const c of deduped) {
          map.set(c.xero_contact_id, c);
        }
        setContactsMap(map);
        setContactsList(deduped);
      })
      .catch(() => {});

    fetchInvoiceReaderStatus()
      .then((status) => {
        if (!cancelled) setReaderStatus(status);
      })
      // the status unknown: no button (the form works without the reader; the API logs its failure)
      .catch(() => {
        if (!cancelled) setReaderStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const clearFieldError = (key: ValidatedField) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const readerValues: InvoiceValues = {
    contact,
    contactInput,
    invoiceDate,
    dueDate,
    amount,
    description,
    accountCode,
  };
  const readerDefaults = { invoiceDate: openedOn, accountCode: "" };

  // The form's latest state, for the answer that arrives seconds after the read started.
  const latest = useRef({
    aux: readerAux,
    values: readerValues,
    defaults: readerDefaults,
    contactsMap,
    accountOptions,
    decimals: currency.decimals,
  });
  useEffect(() => {
    latest.current = {
      aux: readerAux,
      values: readerValues,
      defaults: readerDefaults,
      contactsMap,
      accountOptions,
      decimals: currency.decimals,
    };
  });

  /** The reader's next state: its values go into the fields, the rest into `readerAux`. */
  const applyReader = (next: InvoiceState) => {
    const v = next.values;
    setContact(v.contact);
    setContactInput(v.contactInput);
    setInvoiceDate(v.invoiceDate);
    setDueDate(v.dueDate);
    setAmount(v.amount);
    setDescription(v.description);
    setAccountCode(v.accountCode);
    setReaderAux(next);
    latest.current = { ...latest.current, aux: next, values: v };
    // A field holding a suggestion is never red.
    for (const field of Object.keys(next.marks) as InvoiceField[]) {
      const key = ERROR_KEY[field];
      if (key) clearFieldError(key);
    }
  };
  const readerNow = (): InvoiceState => ({ ...latest.current.aux, values: latest.current.values });

  // a read filled the form: the owner's caution stays under the fields until the bill is saved
  // (2026-11-19); dropping the read's suggestions (another or a removed file) takes it away
  const [aiFilled, setAiFilled] = useState(false);
  // an invoice in another currency (owner, 2026-11-19): the read's conversion and the figure it
  // gave - kept with the bill only while the amount still holds it - or the currency no rate was
  // found for
  const [exchange, setExchange] = useState<{ how: Exchange; converted: string } | null>(null);
  const [rateMissing, setRateMissing] = useState<string | null>(null);
  const reader = useDocumentReader<InvoiceSuggestions>({
    field: "invoice",
    latch: INVOICE_LATCH,
    post: extractInvoice,
    onSuggestions: (suggestions) => {
      const l = latest.current;
      const next = withInvoiceSuggestions(readerNow(), suggestions, {
        contacts: l.contactsMap,
        accountOptions: l.accountOptions.map((o) => o.value),
        decimals: l.decimals,
        defaults: l.defaults,
      });
      applyReader(next);
      const how = exchangeOf(suggestions);
      setExchange(
        how && suggestions.amount?.value ? { how, converted: suggestions.amount.value } : null,
      );
      const missing = exchangeFailedOf(suggestions);
      setRateMissing(missing);
      const showed = showedAnything(next) || missing !== null;
      if (showed) setAiFilled(true);
      return showed;
    },
    onStatus: setReaderStatus,
  });
  const { cancel: cancelRead } = reader;
  // One file per read (owner, 2026-11-18): the person chooses it by selecting it in the list (the
  // preview); with none selected that can be read, the newest file that can.
  const readable = uploadedFiles.filter((x) => isReadable(x.file));
  const fileToRead =
    readable.find((x) => x.id === previewFileId) ?? readable[readable.length - 1] ?? null;
  // (and never once a `disabled` answer has switched the reader off for the session)
  const offerRead =
    readerStatus?.enabled === true &&
    fileToRead !== null &&
    !reader.reading &&
    (!readAsked || reader.failed || fileToRead.id !== readFileId) &&
    !INVOICE_LATCH.readerOff();

  /** The person changed a reader field: it is theirs now (the field's own setter still runs). */
  const readerEdit = (field: InvoiceField, patch: Partial<InvoiceValues>) => {
    const next = edited(readerNow(), field, patch, latest.current.defaults);
    setReaderAux(next);
    latest.current = { ...latest.current, aux: next, values: next.values };
  };
  const dropSuggestions = () => {
    setAiFilled(false);
    setExchange(null);
    setRateMissing(null);
    applyReader(withoutSuggestions(readerNow(), invoiceSpec(latest.current.defaults)));
  };
  const clearSuggestion = (field: InvoiceField) =>
    applyReader(cleared(readerNow(), field, invoiceSpec(latest.current.defaults)));
  const takeSuggestion = (field: InvoiceField) => applyReader(usedNote(readerNow(), field));

  // the conversion holds while the amount is still the converted figure
  const converted =
    exchange && exchangeKept(amount ?? "", exchange.converted) ? exchange.how : null;

  /** Under a reader field: the suggested line with Clear, or the note offering the invoice's reading. */
  const readerExtras = (field: InvoiceField) => {
    const band = readerAux.marks[field];
    if (band)
      return (
        <SuggestedLine
          id={`pr-${field}-suggested`}
          text={
            field === "amount" && converted
              ? `${suggestedText(band)} ${convertedText(converted, entityCurrency).replace(/^c/, "C")}.`
              : suggestedText(band)
          }
          clearLabel={CLEAR_LABEL}
          onClear={() => clearSuggestion(field)}
        />
      );
    const note = readerAux.notes[field];
    return note ? (
      <ReaderNote text={note.text} action={USE_LABEL} onAction={() => takeSuggestion(field)} />
    ) : null;
  };
  const ring = (field: InvoiceField) => (readerAux.marks[field] ? ` ${SUGGESTED_RING}` : "");
  const describedBy = (field: InvoiceField) =>
    readerAux.marks[field] ? `pr-${field}-suggested` : undefined;

  // Commas as the person types, places padded on blur (@minty/shared/amountInput). The 12-digit
  // error shows only while it applies and clears the moment the amount is valid again.
  const amountInput = useAmountInput({
    value: amount ?? "",
    decimals: currency.decimals,
    onValue: (value) => {
      setAmount(value);
      readerEdit("amount", { amount: value });
      const err = amountLimitError(value);
      if (err) {
        setFieldErrors((prev) => ({ ...prev, amount: err }));
      } else {
        clearFieldError("amount");
      }
    },
  });

  useEffect(() => {
    if (!open) return;
    return pushAppScrollLock();
  }, [open]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreviewObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  useEffect(() => {
    if (previewFileId && !uploadedFiles.some((x) => x.id === previewFileId)) {
      setPreviewFileId(null);
    }
  }, [uploadedFiles, previewFileId]);

  useEffect(() => {
    if (!open) {
      setPreviewFileId(null);
      setViewerOpen(false);
      // The modal returns null when closed but stays mounted: a read in flight goes here.
      cancelRead();
    }
  }, [open, cancelRead]);

  // Two levels, not three: when the full-screen viewer is up it swallows Escape itself in the
  // capture phase (AttachmentFullScreenViewer), so this handler never sees the keystroke that
  // closes it. Do not add a `viewerOpen` branch here.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // the duplicate question is open: Escape is its Go back, and the form stays as typed
      if (duplicates.asking) return;
      if (previewFileId) {
        setPreviewFileId(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, previewFileId, duplicates.asking]);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    setAmount("");
    setContact("");
    setContactInput("");
    setAccountCode("");
    const today = todayLocalISODate();
    setInvoiceDate(today);
    setOpenedOn(today);
    setDueDate("");
    setReaderAux(invoiceState());
    setReadFileId(null);
    setReadAsked(false);
    setAiFilled(false);
    setExchange(null);
    setRateMissing(null);
    setBillNo("");
    setBillNoTouched(false);
    setDescription("");
    setUploadedFiles([]);
    setPreviewFileId(null);
    let cancelled = false;
    fetchSuggestedBillReference()
      .then((r) => {
        if (!cancelled) setBillNo(r.reference);
      })
      .catch(() => {
        if (!cancelled) setBillNo("");
      })
      .finally(() => {
        if (!cancelled) setReferenceSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setConfirmSubmitting(false);
      setDraftSubmitting(false);
      setReferenceSettled(false);
    }
  }, [open]);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    const oversized = Array.from(list).filter((file) => file.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setFieldErrors((prev) => ({
        ...prev,
        attachments: filesTooBig(oversized.map((f) => f.name)),
      }));
      e.target.value = "";
      return;
    }
    const disallowed = Array.from(list).filter((file) => !isAllowedAttachment(file));
    if (disallowed.length > 0) {
      setFieldErrors((prev) => ({
        ...prev,
        attachments: filesNotOpenable(disallowed.map((f) => f.name)),
      }));
      e.target.value = "";
      return;
    }
    // Staged and uploaded exactly as chosen: no shrinking, no conversion (owner, 2026-11-04).
    const added = Array.from(list).map(stagedEntry);

    setUploadedFiles((prev) => [...prev, ...added]);
    setPreviewFileId(added[added.length - 1]?.id ?? null);
    clearFieldError("attachments");
    e.target.value = "";
    // A new readable file (selected for preview above) is what "Read invoice" offers - read only on
    // that press (owner, 2026-11-18); the previous read's suggestions go (what was typed stays).
    if (added.some((x) => isReadable(x.file))) {
      cancelRead();
      dropSuggestions();
      setReadFileId(null);
      setReadAsked(false);
    }
  };

  const removeFile = (entryId: string) => {
    setUploadedFiles((prev) => prev.filter((x) => x.id !== entryId));
    if (entryId === readFileId) {
      cancelRead();
      dropSuggestions();
      setReadFileId(null);
    }
  };

  const refetchEntityBillContacts = async (ensureMerged?: EntityBillContact) => {
    const list = await fetchEntityBillContacts();
    const mergedId = (ensureMerged?.xero_contact_id || "").trim().toUpperCase();
    let merged =
      ensureMerged &&
      mergedId &&
      !list.some((c) => (c.xero_contact_id || "").trim().toUpperCase() === mergedId)
        ? [...list, ensureMerged]
        : list;
    merged = dedupeEntityBillContactsForPicker(
      [...merged].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    );
    const map = new Map<string, EntityBillContact>();
    for (const c of merged) {
      map.set(c.xero_contact_id, c);
    }
    setContactsMap(map);
    setContactsList(merged);
  };

  // The auto-saved draft (owner's decisions doc L1, 2026-11-20): kept while anything differs from
  // how the dialog opened (the suggested Payment No. and today's invoice date are not changes).
  const draftValue: AddPaymentDraft = {
    billNo: billNoTouched ? billNo : null,
    invoiceDate: invoiceDate !== openedOn ? invoiceDate : null,
    dueDate,
    amount: amount ?? "",
    description,
    contact: { id: contact, name: contactsMap.get(contact)?.name ?? contactInput },
    contactInput,
    accountCode,
  };
  const draftDirty =
    billNoTouched ||
    invoiceDate !== openedOn ||
    dueDate !== "" ||
    (amount ?? "") !== "" ||
    description.trim() !== "" ||
    contact !== "" ||
    contactInput.trim() !== "" ||
    accountCode !== "" ||
    uploadedFiles.length > 0;

  /** Restore: the draft's values go back in, as the person's own; its files join the list. */
  const restoreDraft = ({ value: v, files }: DraftOffer<AddPaymentDraft>) => {
    if (v.billNo !== null) {
      setBillNo(v.billNo);
      setBillNoTouched(true);
    }
    const values: Partial<InvoiceValues> = {
      dueDate: v.dueDate,
      amount: v.amount,
      description: v.description,
      contact: v.contact.id,
      contactInput: v.contactInput,
      accountCode: v.accountCode,
      ...(v.invoiceDate !== null ? { invoiceDate: v.invoiceDate } : {}),
    };
    if (values.invoiceDate !== undefined) setInvoiceDate(values.invoiceDate);
    setDueDate(v.dueDate);
    setAmount(v.amount);
    setDescription(v.description);
    setContact(v.contact.id);
    setContactInput(v.contactInput);
    setAccountCode(v.accountCode);
    // the reader treats them as typed: a later read only offers its own reading beside them
    const fields: [InvoiceField, keyof InvoiceValues][] = [
      ["invoiceDate", "invoiceDate"],
      ["dueDate", "dueDate"],
      ["amount", "amount"],
      ["description", "description"],
      ["supplier", "contactInput"],
      ["account", "accountCode"],
    ];
    for (const [field, key] of fields) {
      if (values[key]) readerEdit(field, values);
    }
    const sig = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const have = new Set(uploadedFiles.map((x) => sig(x.file)));
    const added = files.filter((f) => !have.has(sig(f))).map(stagedEntry);
    if (added.length > 0) {
      setUploadedFiles((prev) => [...prev, ...added]);
      setPreviewFileId(added[added.length - 1].id);
      clearFieldError("attachments");
    }
  };

  const handleSaveDraft = async () => {
    const confirmDuplicate = duplicates.confirmed();
    if (draftSubmitting || currencyBlocked) return;
    cancelRead();
    setFieldErrors({});
    setFormError(null);
    setDraftSubmitting(true);
    try {
      const amountStr = toAmountString(amount, currency.decimals);
      const { account_code: acctCode, account_name: acctName } = parseAccountField(accountCode);

      const selectedContact = contactsMap.get(contact);
      const contactName = selectedContact?.name ?? contact;
      const bill = await saveBillDraft({
        contact: contactName || undefined,
        xero_contact_id: selectedContact?.xero_contact_id || undefined,
        description: description || undefined,
        amount: amountStr,
        currency_code: entityCurrency,
        exchange: converted ? exchangeFields(converted) : undefined,
        invoice_date: invoiceDate || undefined,
        due_date: dueDate || undefined,
        reference: billNo || undefined,
        confirm_duplicate: confirmDuplicate || undefined,
        xero_account_code: acctCode || undefined,
        line_items:
          acctCode || description || isPositiveAmount(amount)
            ? [
                {
                  description: description || undefined,
                  quantity: 1,
                  unit_amount: amountStr,
                  line_amount: amountStr,
                  account_code: acctCode || undefined,
                  account_name: acctName || undefined,
                },
              ]
            : undefined,
      });

      const notUploaded = await uploadEachAttachment(
        bill.id,
        uploadedFiles.map((x) => x.file),
      );

      try {
        await saveAttachmentBlobs(
          bill.id,
          uploadedFiles.map((x) => x.file),
        );
      } catch (e) {
        console.error("Could not store attachments for preview:", e);
      }

      // saved for real: the browser's copy goes
      draftClearRef.current?.();
      onSaveDraft?.();
      onClose();
      if (notUploaded.length > 0) {
        // The draft exists; only the file is missing - open it, so it can be added there.
        showToast(
          `Draft saved, but ${joinNames(notUploaded)} didn't upload. Edit the draft and add ${notUploaded.length > 1 ? "them" : "it"} again.`,
          "warning",
        );
        router.push(pages.request(bill.id, bill.reference));
      }
    } catch (err) {
      if (duplicates.ask(err, "draft")) return;
      console.error("Failed to save draft:", err);
      if (isDuplicateBillReferenceError(err)) {
        setFieldErrors({ billNo: err.message });
      } else if (err instanceof ApiError && err.status === 422) {
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof ApiError
            ? err.message
            : "That draft didn't quite save. Mind trying again?",
        );
      }
    } finally {
      setDraftSubmitting(false);
    }
  };

  // Cancel throws what was typed away, the draft too; the X, Escape and the backdrop keep it.
  const handleCancel = () => {
    draftClearRef.current?.();
    onCancel?.();
    onClose();
  };

  const handleConfirm = async () => {
    const confirmDuplicate = duplicates.confirmed();
    if (currencyBlocked) return;
    cancelRead();
    const next = validatePaymentRequestForm({
      amount,
      contact,
      accountCode,
      invoiceDate,
      dueDate,
      attachmentCount: uploadedFiles.length,
    });
    if (Object.keys(next).length > 0) {
      setFieldErrors(next);
      // Two or more: the summary takes focus. One: its field does.
      setSummaryAttempt((n) => n + 1);
      const refused = SUMMARY_ORDER.filter((key) => next[key]);
      if (refused.length === 1)
        setTimeout(() => document.getElementById(FIELD_ID[refused[0]])?.focus(), 0);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    if (confirmSubmitting) return;
    setConfirmSubmitting(true);
    try {
      const amountStr = toAmountString(amount, currency.decimals) ?? "0";
      const { account_code: acctCode, account_name: acctName } = parseAccountField(accountCode);

      const selectedContact = contactsMap.get(contact);
      const contactName = selectedContact?.name ?? contact;
      const bill = await submitBill({
        contact: contactName,
        xero_contact_id: selectedContact?.xero_contact_id || undefined,
        description,
        amount: amountStr,
        currency_code: entityCurrency,
        exchange: converted ? exchangeFields(converted) : undefined,
        invoice_date: invoiceDate || null,
        due_date: dueDate || null,
        reference: billNo,
        confirm_duplicate: confirmDuplicate || undefined,
        xero_account_code: acctCode || undefined,
        line_items: [
          {
            description,
            quantity: 1,
            unit_amount: amountStr,
            line_amount: amountStr,
            account_code: acctCode,
            account_name: acctName,
          },
        ],
      });

      const notUploaded = await uploadEachAttachment(
        bill.id,
        uploadedFiles.map((x) => x.file),
      );

      try {
        await saveAttachmentBlobs(
          bill.id,
          uploadedFiles.map((x) => x.file),
        );
      } catch (e) {
        console.error("Could not store attachments for preview:", e);
      }

      draftClearRef.current?.();
      onConfirm?.();
      onClose();
      if (notUploaded.length > 0) {
        showToast(
          `Payment request for ${contactName} sent, but ${joinNames(notUploaded)} didn't upload. Edit the request and add ${notUploaded.length > 1 ? "them" : "it"} again.`,
          "warning",
        );
      }
      router.push(pages.request(bill.id, bill.reference));
    } catch (err) {
      if (duplicates.ask(err, "confirm")) return;
      console.error("Failed to create bill:", err);
      if (isDuplicateBillReferenceError(err)) {
        setFieldErrors({ billNo: err.message });
      } else if (err instanceof ApiError && err.status === 422) {
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof ApiError
            ? err.message
            : "That payment didn't quite go through. Mind trying again?",
        );
      }
    } finally {
      setConfirmSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-clip overscroll-none p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] sm:p-4 md:p-6"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-overlay-scrim backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={previewFile ? previewSubtitleId : undefined}
        className="relative z-[1] flex max-h-[min(100dvh-1rem,880px)] w-full min-w-0 max-w-[520px] flex-col rounded-xl bg-surface-card shadow-xl ring-1 ring-border-subtle sm:max-h-[min(92dvh,880px)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-4 pb-3 pt-4 sm:gap-4 sm:px-6 sm:pb-4 sm:pt-6">
          <h2
            id={titleId}
            className="min-w-0 pr-2 text-lg font-bold leading-snug text-text-primary sm:text-xl md:text-2xl"
          >
            Add Payment Request
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[22px] leading-none" aria-hidden>
              close
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-6">
            <AddPaymentDraftKeeper
              ready={referenceSettled}
              value={draftValue}
              dirty={draftDirty}
              files={uploadedFiles.map((x) => x.file)}
              onRestore={restoreDraft}
              clearRef={draftClearRef}
            />
            <ErrorSummary look="classic" items={summaryItems} attempt={summaryAttempt} />
            <div className="min-w-0">
              {previewFile && previewObjectUrl ? (
                <PaymentRequestInlinePreview
                  file={previewFile}
                  objectUrl={previewObjectUrl}
                  previewSubtitleId={previewSubtitleId}
                  getUploadedFileIconInfo={getUploadedFileIconInfo}
                  onViewFull={() => setViewerOpen(true)}
                />
              ) : previewFile && !previewObjectUrl ? (
                <div className="flex min-h-[156px] items-center justify-center rounded-lg border-2 border-dashed border-border-input bg-surface-sunk px-4 text-center text-sm text-text-muted sm:min-h-[176px]">
                  Loading preview…
                </div>
              ) : (
                <div className="flex min-h-[156px] items-center justify-center rounded-lg border-2 border-dashed border-border-input bg-surface-sunk px-4 text-center text-sm text-text-muted sm:min-h-[176px]">
                  Pick a file and I&apos;ll show it here.
                </div>
              )}
            </div>

            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                Uploaded files ({uploadedFiles.length})
                <RequiredMark />
              </p>
              {uploadedFiles.length > 0 ? (
                <span className="shrink-0 text-[10px] font-medium text-text-muted sm:text-[11px]">
                  Click the file to preview
                </span>
              ) : null}
            </div>
            <ul className="flex flex-col gap-2">
              {uploadedFiles.map(({ id, file }) => {
                const { icon, iconClass } = getUploadedFileIconInfo(file.name);
                const selected = previewFileId === id;
                return (
                  <li
                    key={id}
                    className={
                      "relative flex items-center justify-start rounded-lg border bg-surface-card px-3 py-2.5 pr-11 sm:gap-2 sm:pr-3 " +
                      (selected
                        ? "border-border-selected ring-2 ring-border-selected/20"
                        : "border-border-input")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewFileId(id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center justify-start gap-2 rounded-md text-left"
                      aria-pressed={selected}
                      aria-label={`Preview ${file.name}`}
                    >
                      <span
                        className={`material-symbols-outlined shrink-0 text-[22px] leading-none sm:text-[26px] ${iconClass}`}
                        aria-hidden
                      >
                        {icon}
                      </span>
                      <span className="min-w-0 break-words text-left text-sm leading-snug text-text-primary sm:flex-1 sm:truncate sm:leading-normal">
                        {file.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile(id)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 shrink-0 -translate-y-1/2 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-state-hover hover:text-text-secondary sm:static sm:translate-y-0"
                      aria-label={`Remove ${file.name}`}
                    >
                      <span
                        className="material-symbols-outlined text-[20px] leading-none"
                        aria-hidden
                      >
                        close
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="relative">
              <input
                ref={fileInputRef}
                id="pr-attachments"
                type="file"
                className="absolute inset-0 z-20 h-full min-h-[156px] w-full cursor-pointer opacity-0 sm:min-h-[176px]"
                multiple
                accept={ATTACHMENT_ACCEPT}
                onChange={handleFilesSelected}
                aria-label="Choose files to attach"
                aria-required="true"
                aria-invalid={fieldErrors.attachments ? true : undefined}
                aria-describedby={fieldErrors.attachments ? attachmentsErrorId : undefined}
              />
              <div className="pointer-events-none">
                <div
                  className={`flex min-h-[156px] flex-col items-center justify-center gap-3 overflow-visible rounded-lg border-2 border-dashed px-4 py-5 sm:min-h-[176px] sm:gap-4 sm:py-6 ${fieldErrors.attachments ? "border-action-danger bg-status-danger-bg" : "border-border-input bg-surface-sunk"}`}
                >
                  <span
                    className="material-symbols-outlined inline-block origin-center text-[48px] leading-none text-text-disabled [font-variation-settings:'FILL'_0,'wght'_400,'GRAD'_0,'opsz'_48] scale-[1.78] sm:text-[48px] sm:scale-[2.02]"
                    aria-hidden
                  >
                    cloud_upload
                  </span>
                  <div className="flex flex-col items-center">
                    <p className="px-2 text-center text-[14px] font-medium leading-tight text-text-secondary">
                      Click or drag files here to upload
                    </p>
                    <p className="mt-1 px-2 text-center text-[12px] leading-tight text-text-disabled">
                      PDF, JPEG, PNG, HTML (Max 10MB)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {fieldErrors.attachments ? (
              <p
                id={attachmentsErrorId}
                className="mt-2 text-xs text-status-danger-ink"
                role="alert"
              >
                {fieldErrors.attachments}
              </p>
            ) : null}

            {reader.reading ? (
              <ReadingNotice title={READING_TITLE} detail={READING_DETAIL} />
            ) : reader.failed ? (
              <ReadFailedLine text={READ_FAILED} />
            ) : null}
            {readerStatus?.enabled && fileToRead && !INVOICE_LATCH.readerOff() ? (
              <div>
                {offerRead ? (
                  <ReadButton
                    label={READ_LABEL}
                    disabled={!!readerStatus?.blocked}
                    describedBy={`${READ_TARGET_ID} ${ALLOWANCE_ID}`}
                    onClick={() => {
                      if (fileToRead.id !== readFileId) {
                        // another file: the last one's suggestions go before this one is read
                        cancelRead();
                        dropSuggestions();
                        setReadFileId(fileToRead.id);
                      }
                      setReadAsked(true);
                      void reader.read(fileToRead.file);
                    }}
                  />
                ) : null}
                {offerRead && readable.length > 1 ? (
                  <p id={READ_TARGET_ID} className="mt-1 break-words text-sm text-text-muted">
                    Reads {fileToRead.file.name}. To read another file, select it above.
                  </p>
                ) : null}
                <AllowanceNote id={ALLOWANCE_ID} status={readerStatus} />
              </div>
            ) : null}
            <div role="status" aria-live="polite" className="sr-only">
              {readerAux.announcement}
            </div>

            {formError ? (
              <div
                className="mt-4 rounded-lg border border-status-warning-bg bg-status-warning-bg px-3 py-2 text-sm text-status-warning-ink"
                role="alert"
              >
                {formError}
              </div>
            ) : null}

            <div className="flex flex-col gap-5">
              <div>
                <FieldLabel htmlFor="pr-bill-no">Payment No.</FieldLabel>
                <input
                  id="pr-bill-no"
                  type="text"
                  value={billNo ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    clearFieldError("billNo");
                    setFormError(null);
                    if (v.trim() === "") {
                      setBillNo("");
                      setBillNoTouched(false);
                      void fetchSuggestedBillReference()
                        .then((r) => setBillNo(r.reference))
                        .catch(() => {});
                      return;
                    }
                    setBillNo(v);
                    setBillNoTouched(true);
                  }}
                  aria-invalid={!!fieldErrors.billNo}
                  aria-describedby={fieldErrors.billNo ? "pr-bill-no-error" : undefined}
                  className={
                    "box-border h-11 min-h-[44px] w-full rounded-2xl border bg-surface-card px-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 sm:min-h-11 sm:text-sm " +
                    (fieldErrors.billNo
                      ? "border-action-danger focus:border-action-danger focus:ring-action-danger/20"
                      : "border-border-input focus:border-border-focus focus:ring-border-focus/25")
                  }
                  placeholder="MBIOVI-115803031626"
                />
                {fieldErrors.billNo ? (
                  <p
                    id="pr-bill-no-error"
                    className="mt-1 text-xs text-status-danger-ink"
                    role="alert"
                  >
                    {fieldErrors.billNo}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
                <div>
                  <FieldLabel htmlFor="pr-invoice-date" required>
                    Invoice Date
                  </FieldLabel>
                  <DateTextField
                    id="pr-invoice-date"
                    required
                    value={invoiceDate ?? ""}
                    onChange={(iso) => {
                      setInvoiceDate(iso);
                      readerEdit("invoiceDate", { invoiceDate: iso });
                      clearFieldError("invoiceDate");
                    }}
                    invalid={!!fieldErrors.invoiceDate}
                    calendarAriaLabel="Open calendar for invoice date"
                    textInputClassName={
                      "relative z-[1] box-border h-11 min-h-[44px] w-full rounded-2xl border bg-surface-card py-0 pl-3 pr-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 [color-scheme:light] sm:min-h-11 sm:text-sm " +
                      (fieldErrors.invoiceDate
                        ? "border-action-danger focus:border-action-danger focus:ring-action-danger/20"
                        : "border-border-input focus:border-border-focus focus:ring-border-focus/25") +
                      ring("invoiceDate")
                    }
                    calendarButtonClassName="hidden"
                  />
                  {fieldErrors.invoiceDate ? (
                    <p className="mt-1 text-xs text-status-danger-ink" role="alert">
                      {fieldErrors.invoiceDate}
                    </p>
                  ) : null}
                  {readerExtras("invoiceDate")}
                </div>
                <div>
                  <FieldLabel htmlFor="pr-due-date" required>
                    Due Date
                  </FieldLabel>
                  <DateTextField
                    id="pr-due-date"
                    required
                    value={dueDate ?? ""}
                    onChange={(iso) => {
                      setDueDate(iso);
                      readerEdit("dueDate", { dueDate: iso });
                      clearFieldError("dueDate");
                    }}
                    invalid={!!fieldErrors.dueDate}
                    calendarAriaLabel="Open calendar for due date"
                    textInputClassName={
                      "relative z-[1] box-border h-11 min-h-[44px] w-full rounded-2xl border bg-surface-card py-0 pl-3 pr-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 [color-scheme:light] sm:min-h-11 sm:text-sm " +
                      (fieldErrors.dueDate
                        ? "border-action-danger focus:border-action-danger focus:ring-action-danger/20"
                        : "border-border-input focus:border-border-focus focus:ring-border-focus/25") +
                      ring("dueDate")
                    }
                    calendarButtonClassName="hidden"
                  />
                  {fieldErrors.dueDate ? (
                    <p className="mt-1 text-xs text-status-danger-ink" role="alert">
                      {fieldErrors.dueDate}
                    </p>
                  ) : null}
                  {readerExtras("dueDate")}
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="pr-amount" required>
                  Amount
                </FieldLabel>
                <div className="flex min-w-0 flex-row gap-0">
                  <div
                    aria-label="Currency"
                    className={
                      "box-border flex h-11 min-h-[44px] w-24 shrink-0 items-center justify-center rounded-l-2xl rounded-r-none border border-r-0 bg-surface-card px-2 text-base text-text-primary sm:min-h-11 sm:px-3 sm:text-sm " +
                      (fieldErrors.amount ||
                      currency.status === "unset" ||
                      currency.status === "error"
                        ? "border-action-danger"
                        : "border-border-input")
                    }
                  >
                    {currency.status === "ready"
                      ? entityCurrency
                      : currency.status === "loading"
                        ? "…"
                        : "—"}
                  </div>
                  <input
                    id="pr-amount"
                    required
                    {...amountInput}
                    placeholder="0.00"
                    aria-invalid={!!fieldErrors.amount}
                    aria-describedby={describedBy("amount")}
                    className={
                      "box-border h-11 min-h-[44px] min-w-0 flex-1 rounded-l-none rounded-r-2xl border border-l-0 bg-surface-card px-3 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 sm:min-h-11 sm:text-sm " +
                      (fieldErrors.amount
                        ? "border-action-danger focus:border-action-danger focus:ring-action-danger/20"
                        : "border-border-input focus:border-border-focus focus:ring-border-focus/25") +
                      ring("amount")
                    }
                  />
                </div>
                {readerExtras("amount")}
                {rateMissing && !(amount ?? "").trim() ? (
                  <p role="status" className="mt-1 break-words text-sm text-text-secondary">
                    {rateMissingText(rateMissing, entityCurrency)}
                  </p>
                ) : null}
                {fieldErrors.amount ? (
                  <p className="mt-1 text-xs text-status-danger-ink" role="alert">
                    {fieldErrors.amount}
                  </p>
                ) : null}
                {currency.status === "unset" ? (
                  <p className="mt-1 text-xs text-status-danger-ink" role="alert">
                    Your company has no currency set. Choose one in{" "}
                    <a
                      href={hubSettingsUrl(entityId, "general")}
                      className="font-medium underline underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      Settings, under General
                    </a>
                    .
                  </p>
                ) : currency.status === "error" ? (
                  <p className="mt-1 text-xs text-status-danger-ink" role="alert">
                    We couldn&apos;t load your company&apos;s currency.{" "}
                    <button
                      type="button"
                      onClick={currency.retry}
                      className="inline-flex min-h-[44px] cursor-pointer items-center font-medium underline underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      Try again
                    </button>
                  </p>
                ) : null}
              </div>

              <div>
                <FieldLabel htmlFor="pr-description">Description</FieldLabel>
                <input
                  id="pr-description"
                  type="text"
                  value={description ?? ""}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    readerEdit("description", { description: e.target.value });
                  }}
                  placeholder="Description (optional)"
                  aria-describedby={describedBy("description")}
                  className={
                    "box-border h-11 min-h-[44px] w-full rounded-2xl border border-border-input bg-surface-card px-3 text-base text-text-primary placeholder:text-text-secondary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/25 sm:min-h-11 sm:text-sm" +
                    ring("description")
                  }
                />
                {readerExtras("description")}
              </div>

              <div>
                <FieldLabel htmlFor="pr-contact" required>
                  Supplier
                </FieldLabel>
                <BillContactPicker
                  id="pr-contact"
                  required
                  contacts={contactsList}
                  xeroContactId={contact}
                  contactName={contactInput}
                  onChange={({ xero_contact_id, contact: nm }) => {
                    setContact(xero_contact_id);
                    setContactInput(nm);
                    readerEdit("supplier", { contact: xero_contact_id, contactInput: nm });
                    clearFieldError("contact");
                  }}
                  refetchContacts={refetchEntityBillContacts}
                  error={!!fieldErrors.contact}
                />
                {fieldErrors.contact ? (
                  <p className="mt-1 text-xs text-status-danger-ink" role="alert">
                    {fieldErrors.contact}
                  </p>
                ) : null}
                {readerExtras("supplier")}
              </div>

              <div>
                <FieldLabel htmlFor="pr-account" required>
                  Account Code
                </FieldLabel>
                <ThemedSelect
                  id="pr-account"
                  required
                  value={accountCode ?? ""}
                  onChange={(v) => {
                    setAccountCode(v);
                    readerEdit("account", { accountCode: v });
                    clearFieldError("accountCode");
                  }}
                  options={accountOptions}
                  placeholder="Select an account code"
                  error={!!fieldErrors.accountCode}
                  triggerClassName={"!rounded-2xl" + ring("account")}
                  plainChevron
                  searchable
                />
                {fieldErrors.accountCode ? (
                  <p className="mt-1 text-xs text-status-danger-ink" role="alert">
                    {fieldErrors.accountCode}
                  </p>
                ) : null}
                {readerExtras("account")}
              </div>
            </div>
            {aiFilled ? <AiCaution id={AI_CAUTION_ID} /> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border-subtle px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5 sm:pb-5">
          <div className="order-1 flex w-full min-w-0 gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="box-border h-12 min-h-[48px] min-w-0 flex-1 cursor-pointer rounded-lg border-2 border-action-secondary-border bg-surface-card px-3 text-sm font-semibold text-action-secondary-text transition-colors hover:bg-state-selected"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirmSubmitting || currencyBlocked}
              aria-describedby={aiFilled ? AI_CAUTION_ID : undefined}
              className="box-border h-12 min-h-[48px] min-w-0 flex-1 rounded-lg border border-transparent bg-action-primary px-4 text-sm font-bold text-action-on-primary shadow-sm transition-colors hover:bg-action-primary-hover active:bg-action-primary-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmSubmitting ? "Confirming…" : "Confirm"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            disabled={draftSubmitting || currencyBlocked}
            aria-describedby={aiFilled ? AI_CAUTION_ID : undefined}
            className="order-2 box-border h-12 min-h-[48px] w-full rounded-lg border border-border-default bg-surface-card px-4 text-sm font-semibold text-text-secondary transition-colors hover:bg-state-hover enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            {draftSubmitting ? "Saving…" : "Save as Draft"}
          </button>
        </div>
      </div>
      {/* Guarded on the live object URL: removing the file being viewed revokes it, and this
          unmounts the viewer in the same commit rather than drawing a dead blob. */}
      {viewerOpen && previewFile && previewObjectUrl ? (
        <AttachmentFullScreenViewer
          item={fileToPreviewItem(previewFile, previewObjectUrl)}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
      <DuplicateBillQuestion
        question={duplicates.question}
        currencyCode={entityCurrency}
        saves={{ draft: () => void handleSaveDraft(), confirm: () => void handleConfirm() }}
      />
    </div>,
    document.body,
  );
}

function PaymentRequestInlinePreview({
  file,
  objectUrl,
  previewSubtitleId,
  getUploadedFileIconInfo,
  onViewFull,
}: {
  file: File;
  objectUrl: string;
  previewSubtitleId: string;
  getUploadedFileIconInfo: (filename: string) => { icon: string; iconClass: string };
  onViewFull: () => void;
}) {
  const { icon, iconClass } = getUploadedFileIconInfo(file.name);
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-3 pb-2">
        <span
          className={`material-symbols-outlined mt-0.5 shrink-0 text-[28px] leading-none sm:text-[32px] ${iconClass}`}
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary sm:text-base">{file.name}</p>
          <p
            id={previewSubtitleId}
            className="mt-1 text-[11px] font-medium tracking-wide text-text-muted sm:text-xs"
          >
            Document preview<span className="text-text-disabled"> • </span>
            {formatFileSize(file.size)}
          </p>
        </div>
      </div>
      <div className="relative mt-3 min-h-[min(60dvh,420px)] overflow-auto rounded-lg bg-state-hover p-2 sm:p-3">
        <ViewFullButton name={file.name} onClick={onViewFull} />
        <PreviewBlock {...fileToPreviewItem(file, objectUrl)} />
      </div>
    </div>
  );
}
