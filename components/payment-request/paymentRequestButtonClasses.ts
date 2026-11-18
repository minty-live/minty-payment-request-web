/** List row — primary Record payment (solid secondary). */
export const recordPaymentButtonClass =
  "box-border inline-flex h-10 min-h-10 w-max max-w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-action-primary px-3 text-xs font-semibold text-action-on-primary shadow-sm transition-colors hover:bg-action-primary-hover active:bg-action-primary-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:bg-action-disabled disabled:text-text-disabled disabled:shadow-none disabled:hover:opacity-100 sm:h-[42px] sm:min-h-[42px] sm:px-4 sm:text-sm";

/** Bill detail footer — same visual as list Record payment, slightly taller for touch. */
export const recordPaymentDetailButtonClass =
  "box-border inline-flex h-12 min-h-12 w-fit max-w-full min-w-0 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-action-primary px-3 text-base font-semibold text-action-on-primary shadow-sm transition-colors hover:bg-action-primary-hover active:bg-action-primary-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:bg-action-disabled disabled:text-text-disabled disabled:shadow-none disabled:hover:opacity-100 sm:h-[46px] sm:min-h-[46px] sm:px-3.5 sm:text-sm";

/** Return — matches the Returned status tag (the warning tone, lib/billStatusDisplay.ts). */
export const returnPaymentRequestButtonClass =
  "box-border inline-flex h-12 w-fit min-w-0 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-status-warning-bg px-3 text-base font-semibold text-status-warning-ink transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning-ink/30 disabled:cursor-not-allowed disabled:opacity-50 sm:h-[46px] sm:px-3.5 sm:text-sm";
