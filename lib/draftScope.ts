"use client";

/**
 * Auto-saved drafts (`@minty/shared/drafts`, the owner's decisions doc L1, 2026-11-20): what the
 * person types in Add Payment, a request's Edit and Easy View's draft edit is kept in THIS
 * browser 2 seconds after their last change - never the real bill, which only their own Save
 * writes. Kept per person and company, from the token this app holds.
 */

import { draftScopeFromToken, type DraftScope } from "@minty/shared/drafts";

import { getAuth } from "@/lib/auth";
import { formatIsoDateForDisplay } from "@/lib/dateDisplayFormat";
import type { PaymentRequestDetailedInfoData } from "@/components/payment-request/PaymentRequestDetailedInfo";

/** The signed-in person and company (the token's `user_id`, `entity_id`), or null: no drafts. */
export function currentDraftScope(): DraftScope | null {
  return draftScopeFromToken(getAuth()?.token);
}

/** A bill edit's draft is kept against its `updated_at`; a bill this person can no longer edit
 * gets a marker that never matches, so its draft is only shown, never put back. */
export function billDraftBasis(updatedAt: string | null | undefined, editable: boolean): string {
  return editable ? (updatedAt ?? "") : `locked:${updatedAt ?? ""}`;
}

/** What a kept bill edit holds, for the notice's Show what I typed (a stale draft). */
export function describeBillFields(
  d: Pick<
    PaymentRequestDetailedInfoData,
    "billNo" | "invoiceDate" | "dueDate" | "amount" | "description" | "contact" | "accountCode"
  >,
  files: readonly string[] = [],
): { label: string; value: string }[] {
  const rows = [
    { label: "Payment No.", value: d.billNo },
    { label: "Invoice Date", value: d.invoiceDate ? formatIsoDateForDisplay(d.invoiceDate) : "" },
    { label: "Due Date", value: d.dueDate ? formatIsoDateForDisplay(d.dueDate) : "" },
    { label: "Amount", value: d.amount },
    { label: "Description", value: d.description },
    { label: "Supplier", value: d.contact },
    { label: "Account Code", value: d.accountCode },
  ];
  if (files.length) rows.push({ label: "Files", value: files.join(", ") });
  return rows;
}
