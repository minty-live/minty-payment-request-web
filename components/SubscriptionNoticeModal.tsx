"use client";

import { createPortal } from "react-dom";
import { useEffect } from "react";
import { ConfirmDialog } from "@/features/subscription/components/ConfirmDialog";
import { pushAppScrollLock } from "@/lib/appScrollRoot";
import { buildMintyEnterUrl } from "@/lib/mintyUrls";
import type { SubscriptionNotice, NoticeSeverity } from "@/lib/subscriptionNotice";

export type SubscriptionNoticeModalProps = {
  notice: SubscriptionNotice | null;
  onClose: () => void;
};

/** Per-item card colouring. Severity is the server's call, not the component's. */
const itemToneClass: Record<NoticeSeverity, string> = {
  critical: "border-red-200 bg-red-50",
  warning: "border-amber-200 bg-amber-50",
  info: "border-gray-200 bg-gray-50",
};

const itemTitleClass: Record<NoticeSeverity, string> = {
  critical: "text-red-900",
  warning: "text-amber-900",
  info: "text-primary",
};

/**
 * Subscription notice for the Payment landing page.
 *
 * Same list Minty's Petty Cash dashboard renders, from the same builder — a company
 * can be past due on one module and winding down another, so every applicable item
 * is shown rather than just the worst.
 *
 * The action goes back to Minty, not to this app's settings: subscription management
 * lives there. `buildMintyEnterUrl` wraps the path so the billing token buys a Flask
 * session on arrival, instead of landing on the login form.
 */
export function SubscriptionNoticeModal({ notice, onClose }: SubscriptionNoticeModalProps) {
  const open = Boolean(notice && notice.items.length > 0);

  useEffect(() => {
    if (!open) return;
    return pushAppScrollLock();
  }, [open]);

  if (!open || !notice || typeof document === "undefined") return null;

  const critical = notice.severity === "critical";
  const settingsHref = notice.settings_path ? buildMintyEnterUrl(notice.settings_path) : null;

  const act = notice.can_manage && settingsHref ? settingsHref : null;
  return createPortal(
    <div className="relative z-[460]">
      <ConfirmDialog
        role="alertdialog"
        title={critical ? "Action needed" : "Your subscription"}
        image="dont"
        busy={false}
        hideBack={!act}
        backLabel="Dismiss"
        confirmLabel={act ? "Go to subscription settings" : "Dismiss"}
        confirmHref={act ?? undefined}
        onBack={onClose}
        onConfirm={act ? () => undefined : onClose}
      >
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {notice.items.map((item) => (
            <li
              key={`${item.module_code}-${item.kind}`}
              className={`rounded-xl border px-3 py-3 ${itemToneClass[item.severity]}`}
            >
              <p className={`text-sm font-semibold ${itemTitleClass[item.severity]}`}>
                {item.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-primary/70">{item.detail}</p>
            </li>
          ))}
        </ul>
        {/* Only the payer can act — the server refuses everyone else, so a button
              here would be a click that fails. Name who to ask instead. */}
        {!notice.can_manage && notice.payer ? (
          <p>
            Billing for this company is managed by {notice.payer.name || notice.payer.email}
            {notice.payer.name && notice.payer.email ? ` <${notice.payer.email}>` : ""} — only they
            can change its subscription.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>,
    document.body,
  );
}
