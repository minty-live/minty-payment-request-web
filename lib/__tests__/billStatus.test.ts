// What a bill's status is called on screen, and when paying it back out rolls it back
// (lib/billStatusDisplay.ts + lib/billStatusRollback.ts).
//
// The six display labels here are the same seven words (with "All") that e2e/01_handoff.spec.ts
// asserts as the list's status tabs, pinned one layer down: the API's vocabulary is
// draft / submitted / paid / partially_paid / void / returned, and `submitted` is the one that
// reads "Payment Requested".

import { describe, expect, it } from "vitest";

import { payment } from "@/lib/__fixtures__/bills";
import { TONE_CLASS } from "@minty/shared/ui";

import {
  BILL_STATUS_TONE,
  billStatusGradientFromClass,
  billStatusToDisplayLabel,
  billStatusTone,
  billStatusToneClass,
  statusDisplayBadgeClass,
} from "@/lib/billStatusDisplay";
import {
  billHasRemainingCountablePayments,
  billLockedForRole,
  billStatusShouldRollbackWhenNoPayments,
  normalizeBillStatusKey,
} from "@/lib/billStatusRollback";
import { shouldShowPaymentInHistory } from "@/lib/paymentHistoryDisplay";

describe("billStatusToDisplayLabel", () => {
  it.each([
    ["draft", "Draft"],
    ["submitted", "Payment Requested"],
    ["paid", "Paid"],
    ["partially_paid", "Partially Paid"],
    ["void", "Voided"],
    ["returned", "Returned"],
  ])("shows %s as %s", (status, label) => {
    expect(billStatusToDisplayLabel(status)).toBe(label);
  });

  it("is forgiving about case, padding and hyphens", () => {
    expect(billStatusToDisplayLabel("  PARTIALLY-PAID ")).toBe("Partially Paid");
    expect(billStatusToDisplayLabel("Submitted")).toBe("Payment Requested");
  });

  it("shows an em dash when there is no status at all", () => {
    expect(billStatusToDisplayLabel("")).toBe("—");
    expect(billStatusToDisplayLabel("   ")).toBe("—");
  });

  it("capitalises a status it does not know rather than hiding it", () => {
    expect(billStatusToDisplayLabel("awaiting_approval")).toBe("Awaiting_approval");
  });

  // `payment_requested` is the argument returnBill() takes, NOT a status the API stores, so it
  // deliberately falls through to the unknown branch. A future rename would land here first.
  it("does not know 'payment_requested' - that is a transition name, not a status", () => {
    expect(billStatusToDisplayLabel("payment_requested")).toBe("Payment_requested");
  });
});

describe("the one bill-status colour map (owner, 2026-11-18)", () => {
  it.each([
    ["Draft", "neutral"],
    ["Payment Requested", "info"],
    ["Paid", "success"],
    ["Partially Paid", "warning"],
    ["Returned", "warning"],
    ["Voided", "neutral"],
    ["Payment failed", "danger"],
    ["Upload failed", "danger"],
  ] as const)("gives %s the %s tone", (label, tone) => {
    expect(billStatusTone(label)).toBe(tone);
    expect(billStatusToneClass(label)).toBe(TONE_CLASS[tone]);
    expect(statusDisplayBadgeClass(label)).toContain(`bg-status-${tone}-bg`);
    expect(statusDisplayBadgeClass(label)).toContain(`text-status-${tone}-ink`);
    expect(billStatusGradientFromClass(label)).toBe(`from-status-${tone}-bg`);
  });

  it("covers every status the API sends", () => {
    for (const status of ["draft", "submitted", "paid", "partially_paid", "void", "returned"]) {
      expect(Object.keys(BILL_STATUS_TONE)).toContain(billStatusToDisplayLabel(status));
    }
  });

  it("keeps one badge geometry for every label", () => {
    expect(statusDisplayBadgeClass("Paid")).toContain("inline-flex");
    expect(statusDisplayBadgeClass("Paid").replace(TONE_CLASS.success, "")).toBe(
      statusDisplayBadgeClass("Draft").replace(TONE_CLASS.neutral, ""),
    );
  });

  it("falls back to Neutral for a label it does not know", () => {
    expect(billStatusTone("Something New")).toBe("neutral");
    expect(statusDisplayBadgeClass("Something New")).toBe(statusDisplayBadgeClass("Draft"));
  });
});

describe("normalizeBillStatusKey", () => {
  it("lowercases, trims and turns hyphens into underscores", () => {
    expect(normalizeBillStatusKey("  Partially-Paid ")).toBe("partially_paid");
    expect(normalizeBillStatusKey("")).toBe("");
  });
});

describe("billStatusShouldRollbackWhenNoPayments", () => {
  it("is true only for the two statuses a payment put the bill into", () => {
    expect(billStatusShouldRollbackWhenNoPayments("paid")).toBe(true);
    expect(billStatusShouldRollbackWhenNoPayments("partially_paid")).toBe(true);
    expect(billStatusShouldRollbackWhenNoPayments("Partially-Paid")).toBe(true);
  });

  it.each(["draft", "submitted", "returned", "void", ""])("is false for %s", (status) => {
    expect(billStatusShouldRollbackWhenNoPayments(status)).toBe(false);
  });
});

describe("shouldShowPaymentInHistory", () => {
  it("counts a positive amount only", () => {
    expect(shouldShowPaymentInHistory({ amount: "1500.00" })).toBe(true);
    expect(shouldShowPaymentInHistory({ amount: "0.01" })).toBe(true);
  });

  it("does not count zero, a negative amount, a blank or nonsense", () => {
    expect(shouldShowPaymentInHistory({ amount: "0.00" })).toBe(false);
    expect(shouldShowPaymentInHistory({ amount: "-100.00" })).toBe(false);
    expect(shouldShowPaymentInHistory({ amount: "" })).toBe(false);
    expect(shouldShowPaymentInHistory({ amount: "abc" })).toBe(false);
  });
});

describe("billHasRemainingCountablePayments", () => {
  it("only counts payments of the bill it was asked about", () => {
    const payments = [payment({ id: "p1", bill_id: "other-bill", amount: "1500.00" })];
    expect(billHasRemainingCountablePayments("bill-requested", payments)).toBe(false);
    expect(billHasRemainingCountablePayments("other-bill", payments)).toBe(true);
  });

  it("ignores a zero or negative payment of the right bill", () => {
    const payments = [
      payment({ id: "p1", bill_id: "bill-requested", amount: "0.00" }),
      payment({ id: "p2", bill_id: "bill-requested", amount: "-50.00" }),
    ];
    expect(billHasRemainingCountablePayments("bill-requested", payments)).toBe(false);
  });

  it("is true as soon as one payment counts", () => {
    const payments = [
      payment({ id: "p1", bill_id: "bill-requested", amount: "0.00" }),
      payment({ id: "p2", bill_id: "bill-requested", amount: "10.00" }),
    ];
    expect(billHasRemainingCountablePayments("bill-requested", payments)).toBe(true);
  });

  it("is false for no payments at all", () => {
    expect(billHasRemainingCountablePayments("bill-requested", [])).toBe(false);
  });
});

describe("billLockedForRole (who may edit a bill and its attachments)", () => {
  it("locks paid, partially paid and authorised bills for a non-elevated role, as the API does for paid-like ones", () => {
    for (const status of ["paid", "partially_paid", "Partially-Paid", "authorised"])
      expect(billLockedForRole(status, false)).toBe(true);
  });
  it("leaves them open to Accountant, Admin and Super Admin", () => {
    for (const status of ["paid", "partially_paid", "authorised"])
      expect(billLockedForRole(status, true)).toBe(false);
  });
  it("leaves every other status open to anyone", () => {
    for (const status of ["draft", "submitted", "returned"])
      expect(billLockedForRole(status, false)).toBe(false);
  });
});
