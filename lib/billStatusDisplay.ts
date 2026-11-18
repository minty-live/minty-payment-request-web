import { TONE_CLASS, type StatusTone } from "@minty/shared/ui";

/** Maps API bill `status` (lowercase) to list/detail display labels. */
export function billStatusToDisplayLabel(status: string): string {
  const k = status.trim().toLowerCase().replace(/-/g, "_");
  const map: Record<string, string> = {
    draft: "Draft",
    submitted: "Payment Requested",
    paid: "Paid",
    partially_paid: "Partially Paid",
    void: "Voided",
    returned: "Returned",
  };
  if (map[k]) return map[k];
  if (!k) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * THE bill-status colour map (owner, 2026-11-18: one palette for every Minty app): each display
 * label's Part 13 tone. The list's table and cards, the easy view and the details header all read
 * it, so a status can never be one colour in one place and another elsewhere. Submitted (Payment
 * Requested) is Info in every module; Voided is Neutral; only a failure is Danger.
 */
export const BILL_STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  Draft: "neutral",
  "Payment Requested": "info",
  Paid: "success",
  "Partially Paid": "warning",
  Returned: "warning",
  Voided: "neutral",
  "Payment failed": "danger",
  "Upload failed": "danger",
};

/** A display label's tone; a label the map does not know is Neutral. */
export function billStatusTone(displayLabel: string): StatusTone {
  return BILL_STATUS_TONE[displayLabel] ?? "neutral";
}

/** The pill colours (soft background + deep ink) for a display label: @minty/shared's TONE_CLASS. */
export function billStatusToneClass(displayLabel: string): string {
  return TONE_CLASS[billStatusTone(displayLabel)];
}

const TONE_GRADIENT_FROM: Record<StatusTone, string> = {
  success: "from-status-success-bg",
  warning: "from-status-warning-bg",
  danger: "from-status-danger-bg",
  info: "from-status-info-bg",
  neutral: "from-status-neutral-bg",
};

/** The gradient start for a surface tinted by a status (the easy view's top edge). */
export function billStatusGradientFromClass(displayLabel: string): string {
  return TONE_GRADIENT_FROM[billStatusTone(displayLabel)];
}

/** Header badge on payment request details, and the easy view's status cells. */
export function statusDisplayBadgeClass(displayLabel: string): string {
  const base =
    "inline-flex max-w-full items-center justify-center rounded-lg px-2.5 py-1 text-center text-sm font-semibold sm:px-3 sm:py-0 sm:text-sm lg:h-[42px] lg:min-h-[42px]";
  return `${base} ${billStatusToneClass(displayLabel)}`;
}
