"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAutoSaveDraft, type DraftOffer } from "@minty/shared/drafts";
import { DraftNotice } from "@minty/shared/ui";
import type { ThemedSelectOption } from "@/components/ThemedSelect";
import {
  ApiError,
  archivedContactsOf,
  dedupeEntityBillContactsForPicker,
  fetchBill,
  fetchEntityBillAccounts,
  fetchEntityBillContacts,
  isDuplicateBillReferenceError,
  isXeroAuthError,
  publishBill,
  updateBill,
  XERO_RECONNECT_MESSAGE,
  type ArchivedContact,
  type BillDetail,
  type EntityBillContact,
} from "@/lib/api";
import { enrichAccountCodeWithOptions } from "@/lib/billFormSelectOptions";
import { billDraftBasis, currentDraftScope, describeBillFields } from "@/lib/draftScope";
import { useEntityCurrencyDecimals } from "@/lib/entityCurrency";
import { DuplicateBillQuestion, useDuplicateBillQuestion } from "./DuplicateBillDialog";
import {
  billToDetailedInfo,
  buildBillUpdatePayload,
  PICK_SUPPLIER_MESSAGE,
  supplierNeedsPick,
} from "@/lib/paymentRequestBillMap";
import { ArchivedContactsDialog } from "./ArchivedContactsDialog";
import { BillActionBar } from "./BillActionBar";
import { useToast } from "@/components/Toast";
import {
  EasyViewDetailedInformationSkeleton,
  EasyViewDraftBillActionsRow,
  EasyViewDraftDetailedInformation,
  EasyViewDraftDetailedInformationEdit,
  type EasyViewDraftDetailActions,
} from "./EasyViewDraftDetailedInformation";
import type { PaymentRequestDetailedInfoData } from "./PaymentRequestDetailedInfo";
import type { PaymentRequestRow } from "./PaymentRequestTable";
import {
  ACCOUNT_EMPTY,
  AMOUNT_EMPTY,
  AMOUNT_ZERO,
  DUE_DATE_EMPTY,
  INVOICE_DATE_EMPTY,
  SUPPLIER_EMPTY,
} from "@/lib/formMessages";

type FieldErrors = Partial<
  Record<"invoiceDate" | "dueDate" | "amount" | "contact" | "accountCode", string>
>;

/** The inline edit's auto-saved draft (owner's decisions doc L1, 2026-11-20): its fields. */
const EASY_VIEW_DRAFT_SHAPE = 1;

function validateDraftDetail(
  d: PaymentRequestDetailedInfoData,
  savedContact: string,
): FieldErrors | null {
  const errors: FieldErrors = {};
  if (!d.accountCode.trim()) errors.accountCode = ACCOUNT_EMPTY;
  if (!d.contact.trim()) errors.contact = SUPPLIER_EMPTY;
  else if (supplierNeedsPick(d, savedContact)) errors.contact = PICK_SUPPLIER_MESSAGE;
  if (!d.invoiceDate.trim()) errors.invoiceDate = INVOICE_DATE_EMPTY;
  if (!d.dueDate.trim()) errors.dueDate = DUE_DATE_EMPTY;
  const amt = Number.parseFloat((d.amount ?? "").replace(/,/g, ""));
  if (!(d.amount ?? "").trim()) {
    errors.amount = AMOUNT_EMPTY;
  } else if (!Number.isFinite(amt) || amt <= 0) {
    errors.amount = AMOUNT_ZERO;
  }
  return Object.keys(errors).length ? errors : null;
}

export function EasyViewDraftDetailBody({
  billId,
  actions,
  isElevated,
  isViewOnly,
  onBillSaved,
}: {
  billId: string;
  actions: EasyViewDraftDetailActions;
  isElevated: boolean;
  isViewOnly: boolean;
  onBillSaved?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [detail, setDetail] = useState<PaymentRequestDetailedInfoData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [accountOptions, setAccountOptions] = useState<ThemedSelectOption[]>([]);
  const [entityBillContacts, setEntityBillContacts] = useState<EntityBillContact[]>([]);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<PaymentRequestDetailedInfoData | null>(null);
  /** The draft as editing began: anything else is a change not saved yet. */
  const [editBaseline, setEditBaseline] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [billNoError, setBillNoError] = useState<string | null>(null);
  const [accountCodeError, setAccountCodeError] = useState<string | null>(null);
  const [submitAttemptFieldErrors, setSubmitAttemptFieldErrors] = useState<FieldErrors | null>(
    null,
  );
  const { showToast } = useToast();
  const decimals = useEntityCurrencyDecimals();
  // DUP1: a save that looks like another bill asks first (Save anyway resends with the flag)
  const {
    ask: askDuplicate,
    confirmed: duplicateConfirmed,
    question: duplicateQuestion,
  } = useDuplicateBillQuestion<"save">();

  const applyEntityBillContacts = useCallback((contacts: EntityBillContact[]) => {
    setEntityBillContacts(dedupeEntityBillContactsForPicker(contacts));
  }, []);

  const refetchEntityBillContacts = useCallback(
    async (ensureMerged?: EntityBillContact) => {
      const list = await fetchEntityBillContacts();
      const mergedId = (ensureMerged?.xero_contact_id || "").trim().toUpperCase();
      let merged =
        ensureMerged &&
        mergedId &&
        !list.some((c) => (c.xero_contact_id || "").trim().toUpperCase() === mergedId)
          ? [...list, ensureMerged]
          : list;
      merged = [...merged].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
      applyEntityBillContacts(merged);
    },
    [applyEntityBillContacts],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBill(null);
    setDetail(null);
    setLoadErr(null);
    setIsEditing(false);
    setDraft(null);
    setBillNoError(null);
    setAccountCodeError(null);
    setSubmitAttemptFieldErrors(null);

    Promise.all([
      fetchBill(billId),
      fetchEntityBillAccounts({ billDropdown: true }),
      fetchEntityBillContacts(),
    ])
      .then(([b, accounts, contactList]) => {
        if (cancelled) return;
        const opts: ThemedSelectOption[] = accounts
          .filter((a) => a.is_active)
          .map((a) => ({
            value: `${a.account_code} - ${a.account_name}`,
            label: `${a.account_code} - ${a.account_name}`,
          }));
        setAccountOptions(opts);
        applyEntityBillContacts(contactList);
        const d = billToDetailedInfo(b);
        setBill(b);
        setDetail({
          ...d,
          accountCode: enrichAccountCodeWithOptions(d.accountCode, opts),
        });
      })
      .catch((e) => {
        if (!cancelled)
          setLoadErr(
            e instanceof ApiError
              ? e.message
              : "This payment didn't come through. Mind trying again?",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [billId, applyEntityBillContacts]);

  // What is typed is kept in this browser as an auto-saved draft (owner's decisions doc L1,
  // 2026-11-20), against the request's version: saved again since, or no longer editable by this
  // person, it is only shown.
  const [draftScope] = useState(currentDraftScope);
  const editable =
    !!bill &&
    !isViewOnly &&
    isElevated &&
    (bill.status ?? "").trim().toLowerCase().replace(/-/g, "_") !== "void";
  const inlineDraft = useAutoSaveDraft<PaymentRequestDetailedInfoData | null>({
    scope: draftScope,
    form: "pr.easy-view",
    record: billId,
    shape: EASY_VIEW_DRAFT_SHAPE,
    ready: !loading && bill?.id === billId,
    basedOn: billDraftBasis(bill?.updated_at, editable),
    value: isEditing ? draft : null,
    dirty: isEditing && draft !== null && JSON.stringify(draft) !== editBaseline,
  });
  const { clear: clearInlineDraft } = inlineDraft;

  /** Restore: into edit mode from the request as it is now, with what was typed over it. */
  const restoreInlineDraft = useCallback(
    (offer: DraftOffer<PaymentRequestDetailedInfoData | null>) => {
      if (!bill || !offer.value) return;
      const base = billToDetailedInfo(bill, decimals);
      const started = {
        ...base,
        accountCode: enrichAccountCodeWithOptions(base.accountCode, accountOptions),
      };
      setEditBaseline(JSON.stringify(started));
      setDraft({ ...started, ...offer.value });
      setIsEditing(true);
      setBillNoError(null);
      setAccountCodeError(null);
      setSubmitAttemptFieldErrors(null);
    },
    [bill, decimals, accountOptions],
  );

  const handlePatch = useCallback((patch: Partial<PaymentRequestDetailedInfoData>) => {
    if (Object.prototype.hasOwnProperty.call(patch, "billNo")) setBillNoError(null);
    if (Object.prototype.hasOwnProperty.call(patch, "accountCode")) setAccountCodeError(null);
    setSubmitAttemptFieldErrors((prev) => {
      if (!prev) return null;
      const next = { ...prev };
      if (Object.prototype.hasOwnProperty.call(patch, "invoiceDate")) delete next.invoiceDate;
      if (Object.prototype.hasOwnProperty.call(patch, "dueDate")) delete next.dueDate;
      if (Object.prototype.hasOwnProperty.call(patch, "amount")) delete next.amount;
      if (Object.prototype.hasOwnProperty.call(patch, "currencyCode")) delete next.amount;
      if (
        Object.prototype.hasOwnProperty.call(patch, "contact") ||
        Object.prototype.hasOwnProperty.call(patch, "xero_contact_id")
      ) {
        delete next.contact;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "accountCode")) delete next.accountCode;
      return Object.keys(next).length ? next : null;
    });
    setDraft((d) => (d ? { ...d, ...patch } : null));
  }, []);

  const handleEdit = useCallback(() => {
    if (!bill) return;
    const base = billToDetailedInfo(bill, decimals);
    const started = {
      ...base,
      accountCode: enrichAccountCodeWithOptions(base.accountCode, accountOptions),
    };
    setDraft(started);
    setEditBaseline(JSON.stringify(started));
    setIsEditing(true);
    setBillNoError(null);
    setAccountCodeError(null);
    setSubmitAttemptFieldErrors(null);
  }, [bill, accountOptions, decimals]);

  const handleCancel = useCallback(async () => {
    // Cancel throws what was typed away, the browser's copy too
    clearInlineDraft();
    setBillNoError(null);
    setAccountCodeError(null);
    setSubmitAttemptFieldErrors(null);
    try {
      const fresh = await fetchBill(billId);
      const d = billToDetailedInfo(fresh);
      setBill(fresh);
      setDetail({
        ...d,
        accountCode: enrichAccountCodeWithOptions(d.accountCode, accountOptions),
      });
      setDraft(null);
      setIsEditing(false);
    } catch {
      setDraft(null);
      setIsEditing(false);
    }
  }, [billId, accountOptions, clearInlineDraft]);

  const handleSave = useCallback(async () => {
    const confirmDuplicate = duplicateConfirmed();
    if (!bill || !draft) return;
    setBillNoError(null);
    setAccountCodeError(null);
    const fieldErr = validateDraftDetail(draft, bill.contact);
    if (fieldErr) {
      setSubmitAttemptFieldErrors(fieldErr);
      return;
    }
    setSubmitAttemptFieldErrors(null);
    setIsSaving(true);
    try {
      const payload = buildBillUpdatePayload(bill, draft, decimals);
      const updated = await updateBill(
        billId,
        confirmDuplicate ? { ...payload, confirm_duplicate: true } : payload,
      );
      const d = billToDetailedInfo(updated, decimals);
      setBill(updated);
      setDetail({
        ...d,
        accountCode: enrichAccountCodeWithOptions(d.accountCode, accountOptions),
      });
      clearInlineDraft();
      setDraft(null);
      setIsEditing(false);
      onBillSaved?.();
    } catch (e) {
      if (askDuplicate(e, "save")) return;
      if (isDuplicateBillReferenceError(e)) {
        setBillNoError(e.message);
      } else {
        showToast(
          e instanceof ApiError ? e.message : "That didn't quite save. Mind trying again?",
          "error",
        );
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    bill,
    draft,
    billId,
    accountOptions,
    onBillSaved,
    decimals,
    askDuplicate,
    duplicateConfirmed,
    clearInlineDraft,
  ]);

  const inlineOffer = inlineDraft.offer;
  const offeredFields = inlineOffer?.value ?? null;
  const draftNotice =
    inlineOffer && offeredFields ? (
      <DraftNotice
        savedAt={inlineOffer.savedAt}
        stale={inlineOffer.stale && !editable ? "locked" : inlineOffer.stale}
        missing={inlineOffer.missing}
        onRestore={() => {
          const taken = inlineDraft.restore();
          if (taken) restoreInlineDraft(taken);
        }}
        onDiscard={inlineDraft.discard}
        describe={() => describeBillFields(offeredFields)}
      />
    ) : null;

  if (loading) {
    return <EasyViewDetailedInformationSkeleton mode="draftCard" />;
  }
  if (loadErr) {
    return (
      <div className="text-sm text-status-danger-ink" role="alert">
        {loadErr}
      </div>
    );
  }
  if (!bill || !detail) return null;

  const detailDisabled =
    isViewOnly ||
    !isElevated ||
    (bill.status ?? "").trim().toLowerCase().replace(/-/g, "_") === "void";

  if (isEditing && draft) {
    return (
      <div className="w-full min-w-0 max-w-full space-y-4">
        {draftNotice}
        <EasyViewDraftDetailedInformationEdit
          actions={actions}
          data={draft}
          isSaving={isSaving}
          disabled={detailDisabled}
          billNoError={billNoError}
          accountCodeError={accountCodeError ?? submitAttemptFieldErrors?.accountCode ?? null}
          invoiceDateError={submitAttemptFieldErrors?.invoiceDate ?? null}
          dueDateError={submitAttemptFieldErrors?.dueDate ?? null}
          amountError={submitAttemptFieldErrors?.amount ?? null}
          contactError={submitAttemptFieldErrors?.contact ?? null}
          accountOptions={accountOptions}
          entityBillContacts={entityBillContacts}
          onRefetchEntityBillContacts={refetchEntityBillContacts}
          onPatchChange={handlePatch}
          onCancel={() => {
            void handleCancel();
          }}
          onSave={() => {
            void handleSave();
          }}
        />
        <DuplicateBillQuestion
          question={duplicateQuestion}
          currencyCode={bill.currency_code}
          saves={{ save: () => void handleSave() }}
        />
      </div>
    );
  }

  const readView = (
    <EasyViewDraftDetailedInformation
      data={detail}
      actions={actions}
      onEdit={handleEdit}
      editDisabled={detailDisabled}
    />
  );
  return draftNotice ? (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {draftNotice}
      {readView}
    </div>
  ) : (
    readView
  );
}

/** Easy-view inline panel: fetch bill and show the same detailed information layout read-only (paid / voided / returned). */
export function EasyViewReadonlyBillDetailBody({
  billId,
  listStatus,
  isElevated,
  isViewOnly,
  onRequestVoidBill,
  onBillUpdated,
  voidBillPending = false,
}: {
  billId: string;
  listStatus: PaymentRequestRow["status"];
  isElevated: boolean;
  isViewOnly: boolean;
  onRequestVoidBill: () => void;
  onBillUpdated?: () => void;
  voidBillPending?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PaymentRequestDetailedInfoData | null>(null);
  const [fullBill, setFullBill] = useState<BillDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  /** A publish refused over contacts Xero archived (C4): map them, then publish again. */
  const [archivedContacts, setArchivedContacts] = useState<ArchivedContact[] | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setFullBill(null);
    setLoadErr(null);
    void fetchBill(billId)
      .then((b) => {
        if (cancelled) return;
        const d = billToDetailedInfo(b);
        setDetail({ ...d, accountCode: enrichAccountCodeWithOptions(d.accountCode, []) });
        setFullBill(b);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadErr(
          e instanceof ApiError
            ? e.message
            : "This payment didn't come through. Mind trying again?",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [billId]);

  const showPaidReturnedBar = listStatus === "Paid" || listStatus === "Returned";

  const billStatusNorm = useMemo(
    () => (fullBill?.status ?? "").trim().toLowerCase().replace(/-/g, "_"),
    [fullBill?.status],
  );

  const publishStatus = useMemo((): "draft" | "published" | "failed" => {
    const pub = (fullBill?.published ?? "").trim();
    if (pub === "published" || billStatusNorm === "authorised" || billStatusNorm === "authorized") {
      return "published";
    }
    if (pub === "failed") return "failed";
    return "draft";
  }, [fullBill?.published, billStatusNorm]);

  const voidDisabled = useMemo(() => {
    if (!fullBill || isPublishing || voidBillPending) return true;
    if (isViewOnly) return true;
    if (billStatusNorm === "void") return true;
    if ((billStatusNorm === "paid" || billStatusNorm === "authorised") && !isElevated) return true;
    if (billStatusNorm === "returned" && !isElevated) return true;
    return false;
  }, [fullBill, isPublishing, voidBillPending, isViewOnly, billStatusNorm, isElevated]);

  const publishDisabled = useMemo(() => {
    if (!fullBill || isPublishing || voidBillPending) return true;
    if (isViewOnly) return true;
    if (billStatusNorm === "void") return true;
    if (!isElevated) return true;
    return false;
  }, [fullBill, isPublishing, voidBillPending, isViewOnly, billStatusNorm, isElevated]);

  const handlePublishToXero = useCallback(async () => {
    setIsPublishing(true);
    try {
      const updated = await publishBill(billId);
      setFullBill(updated);
      const d = billToDetailedInfo(updated);
      setDetail({ ...d, accountCode: enrichAccountCodeWithOptions(d.accountCode, []) });
      onBillUpdated?.();
    } catch (e) {
      const archived = archivedContactsOf(e);
      if (archived) {
        setArchivedContacts(archived);
        return;
      }
      showToast(
        isXeroAuthError(e)
          ? XERO_RECONNECT_MESSAGE
          : e instanceof ApiError
            ? e.message
            : "This payment didn't quite make it over to Xero. Mind trying again?",
        "error",
      );
    } finally {
      setIsPublishing(false);
    }
  }, [billId, onBillUpdated]);

  if (loading) {
    return (
      <EasyViewDetailedInformationSkeleton
        mode="readOnly"
        showFooterActionsSkeleton={showPaidReturnedBar}
      />
    );
  }
  if (loadErr) {
    return (
      <div className="text-sm text-status-danger-ink" role="alert">
        {loadErr}
      </div>
    );
  }
  if (!detail) return null;

  return (
    <EasyViewDraftDetailedInformation
      readOnly
      data={detail}
      readOnlyFooter={
        showPaidReturnedBar && fullBill ? (
          <>
            <BillActionBar
              onDeleteBill={onRequestVoidBill}
              onPublishToXero={() => {
                void handlePublishToXero();
              }}
              deleteDisabled={voidDisabled}
              publishDisabled={publishDisabled}
              publishStatus={publishStatus}
              publishPending={isPublishing}
              isDraftBill={false}
              voidButtonTrailing
            />
            {archivedContacts ? (
              <ArchivedContactsDialog
                contacts={archivedContacts}
                onCancel={() => setArchivedContacts(null)}
                onMapped={() => {
                  setArchivedContacts(null);
                  void handlePublishToXero();
                }}
              />
            ) : null}
          </>
        ) : null
      }
    />
  );
}
