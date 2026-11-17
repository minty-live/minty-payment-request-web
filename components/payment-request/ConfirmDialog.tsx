"use client";

import { createPortal } from "react-dom";
import { useEffect, type ReactNode } from "react";
import { ConfirmDialog as MintyConfirmDialog } from "@/features/subscription/components/ConfirmDialog";
import { pushAppScrollLock } from "@/lib/appScrollRoot";

/**
 * Shared scaffold for the payment-request confirm dialogs (delete / void / warning), drawn on
 * minty-web's `ConfirmDialog` (owner, 2026-11-17: every question in every app uses minty-web's
 * design - this replaces the Part 14 card for questions). Owns the portal, the stacking, the scroll
 * lock and the accessible `alertdialog` (named by its title, described by its body); minty-web's
 * frame owns the blurred backdrop, Escape and the buttons. Each concrete modal stays a thin wrapper
 * that supplies its own title, body, labels, z-index and confirm tone - so user-facing strings and
 * public props are unchanged.
 */

export type ConfirmDialogProps = {
  open: boolean;
  /** Stacking context; each modal keeps its historical z-index. */
  zIndex: number;
  title: ReactNode;
  /** Dialog body, rendered inside the described-by paragraph. */
  children: ReactNode;
  pending?: boolean;
  onClose: () => void;
  /**
   * Confirm handler. Omit together with `hideConfirm` for an acknowledge-only
   * dialog (single OK button that calls `onClose`).
   */
  onConfirm?: () => void;
  confirmLabel?: ReactNode;
  confirmVariant?: "danger" | "primary";
  /** When true, render only a single primary button (no Cancel / Confirm pair). */
  acknowledgeOnly?: boolean;
  /** Label of the single button in acknowledge-only mode. */
  acknowledgeLabel?: ReactNode;
};

export function ConfirmDialog({
  open,
  zIndex,
  title,
  children,
  pending = false,
  onClose,
  onConfirm,
  confirmLabel,
  confirmVariant = "danger",
  acknowledgeOnly = false,
  acknowledgeLabel = "OK",
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    return pushAppScrollLock();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  // The stacking is an inline style, not a `z-[${zIndex}]` class: Tailwind only generates
  // arbitrary values it can see as literal text at build time.
  return createPortal(
    <div className="relative" style={{ zIndex }}>
      <MintyConfirmDialog
        role="alertdialog"
        title={title}
        image="dont"
        busy={pending}
        hideBack={acknowledgeOnly}
        backLabel="Cancel"
        confirmLabel={acknowledgeOnly ? acknowledgeLabel : confirmLabel}
        confirmTone={acknowledgeOnly || confirmVariant === "primary" ? "teal" : "red"}
        onConfirm={acknowledgeOnly ? onClose : () => onConfirm?.()}
        onBack={onClose}
      >
        <p>{children}</p>
      </MintyConfirmDialog>
    </div>,
    document.body,
  );
}
