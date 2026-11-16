import type { PaymentItem } from "@/lib/api";
import { shouldShowPaymentInHistory } from "@/lib/paymentHistoryDisplay";

export function normalizeBillStatusKey(status: string): string {
  return (status ?? "").trim().toLowerCase().replace(/-/g, "_");
}
export function billStatusShouldRollbackWhenNoPayments(status: string): boolean {
  const k = normalizeBillStatusKey(status);
  return k === "paid" || k === "partially_paid";
}

/**
 * Whether this role is kept out of editing the bill and its attachments: paid and partially paid
 * bills are Accountant / Admin / Super Admin only, as the API rules (`core/permissions.py`
 * `PAID_LIKE_STATUSES`), and the web also keeps `authorised` bills to them.
 */
export function billLockedForRole(status: string, isElevated: boolean): boolean {
  const k = normalizeBillStatusKey(status);
  return !isElevated && (k === "paid" || k === "partially_paid" || k === "authorised");
}

/** True if this bill still has at least one payment that counts toward balance / history (positive amount). */
export function billHasRemainingCountablePayments(
  billId: string,
  payments: PaymentItem[],
): boolean {
  return payments.some((p) => p.bill_id === billId && shouldShowPaymentInHistory(p));
}
