"use client";

// COPY of minty-web/features/subscription/components/InterruptedDialogs.tsx (2026-10-01) - lifted into @minty/shared at Part 3 step 4;
// change all three (minty-web, here, Flask's port: Minty static/js/minty_dialog.js + static/css/minty_dialog.css).
// Only `LeaveDialog` is copied - the detail page's edit mode since 2026-11-17 (Payment Settings moved to the hub).
// Local change: it portals itself to <body> in a `relative z-[250]` layer above the sidebar drawer, marked
// `data-leave-dialog` so `@minty/shared/leaveGuard` never holds a click inside it.

/**
 * When it gets interrupted (Figma section 06·B), on the `ConfirmDialog` shell:
 *
 * - `LeaveDialog` (A-11, "Leaving with changes not confirmed"): "Leave without saving?" when
 *   the open row has ticks pending and the person closes it, opens another company, or goes
 *   back - "Discard changes" drops the ticks and goes, "Go Back" stays.
 */

import { createPortal } from "react-dom";

import { ConfirmDialog } from "@/features/subscription/components/ConfirmDialog";

export const LEAVE_TITLE = "Leave without saving?";
export const LEAVE_BODY_1 = "You have unsaved changes.";
export const LEAVE_BODY_2 = "Your changes will be lost if you leave this page.";
export const DISCARD_CHANGES = "Discard changes";
export const GO_BACK_UPPER = "Go Back";

export function LeaveDialog({ onDiscard, onStay }: { onDiscard: () => void; onStay: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="relative z-[250]" data-leave-dialog="">
      <ConfirmDialog
        title={<span data-modal="leave">{LEAVE_TITLE}</span>}
        image="dont"
        busy={false}
        confirmLabel={GO_BACK_UPPER}
        confirmTone="teal"
        backLabel={DISCARD_CHANGES}
        backTone="teal"
        onConfirm={onStay}
        onBack={onDiscard}
        onDismiss={onStay}
      >
        <p>{LEAVE_BODY_1}</p>
        <p>{LEAVE_BODY_2}</p>
      </ConfirmDialog>
    </div>,
    document.body,
  );
}
