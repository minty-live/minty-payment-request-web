"use client";

import { createPortal } from "react-dom";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/features/subscription/components/ConfirmDialog";
import { pushAppScrollLock } from "@/lib/appScrollRoot";
import type { PaymentItem } from "@/lib/api";
import { formatDateInTimeZoneForDisplay, formatIsoDateForDisplay } from "@/lib/dateDisplayFormat";
import { formatMoney } from "@minty/shared/money";
import { useCompanyPages } from "@/lib/useCompanyPages";

export type OverpaymentWarningModalProps = {
  open: boolean;
  billId: string;
  payments: PaymentItem[];
  totalPaid: number;
  currencyLabel: string;
  onCancel: () => void;
  onOpenPaymentHistory?: () => void;
};

function formatPaymentDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const head = dateStr.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) {
    return formatIsoDateForDisplay(head) || dateStr;
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return formatDateInTimeZoneForDisplay(d, "Asia/Hong_Kong") || dateStr;
}

function formatCreatedAt(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = formatDateInTimeZoneForDisplay(d, "Asia/Hong_Kong");
  const timePart = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Hong_Kong",
  });
  return datePart ? `${datePart}, ${timePart}` : "";
}

export function OverpaymentWarningModal({
  open,
  billId,
  payments,
  totalPaid,
  currencyLabel,
  onCancel,
  onOpenPaymentHistory,
}: OverpaymentWarningModalProps) {
  const router = useRouter();
  const pages = useCompanyPages();

  useEffect(() => {
    if (!open) return;
    return pushAppScrollLock();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const paymentHistoryHref = `${pages.request(billId)}#payment-history`;

  const goToPaymentHistory = () => {
    onCancel();
    router.push(paymentHistoryHref);
    window.requestAnimationFrame(() => {
      document.getElementById("payment-history")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  return createPortal(
    <div className="relative z-[440]">
      <ConfirmDialog
        role="alertdialog"
        title="Overpayment"
        image="dont"
        busy={false}
        backLabel="Cancel"
        confirmLabel="Payment history"
        onBack={onCancel}
        onConfirm={() => {
          if (onOpenPaymentHistory) {
            onCancel();
            onOpenPaymentHistory();
          } else {
            goToPaymentHistory();
          }
        }}
      >
        <p>
          The bill already has {payments.length === 1 ? "a payment" : "payments"} recorded totalling{" "}
          <span className="font-semibold text-primary">
            {formatMoney(totalPaid, currencyLabel)}
          </span>
          . Bill amount cannot be lower than recorded payments.
        </p>
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {payments.map((p) => {
            const amt = parseFloat(p.amount || "0");
            const createdAtFormatted = formatCreatedAt(p.created_at);
            const paymentDateFormatted = formatPaymentDateTime(p.payment_date);
            const payerName = p.created_by_name?.trim() || p.created_by?.trim() || "Unknown";
            return (
              <li
                key={p.id}
                className="flex items-start gap-3 rounded-xl bg-secondary/8 px-3 py-3 ring-1 ring-secondary/20"
              >
                <span
                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary"
                  aria-hidden
                >
                  <span className="material-symbols-outlined text-[18px] leading-none">
                    payments
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary">{payerName}</p>
                  <p className="mt-0.5 text-xs text-primary/70">
                    Payment date: {paymentDateFormatted}
                    {createdAtFormatted ? (
                      <span className="ml-2 text-primary/50">· Recorded {createdAtFormatted}</span>
                    ) : null}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold text-primary tabular-nums">
                  ({formatMoney(amt, currencyLabel)})
                </span>
              </li>
            );
          })}
        </ul>
        <p>
          To edit this payment, you&apos;ll need to clear its payment history first. If it&apos;s
          been overpaid, your accountant can help sort it out.
        </p>
      </ConfirmDialog>
    </div>,
    document.body,
  );
}
