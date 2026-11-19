"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ThemedSelect } from "@/components/ThemedSelect";
import { useToast } from "@/components/Toast";
import {
  ApiError,
  archivedContactSentence,
  fetchXeroBillContacts,
  linkBillContactToXero,
  type ArchivedContact,
  type XeroBillContact,
} from "@/lib/api";
import { pushAppScrollLock } from "@/lib/appScrollRoot";

const UNREACHABLE = "I couldn't reach the server just now. Mind trying again?";
const NO_XERO_CONTACTS =
  "Xero has no active contact to map to. Restore the contact in Xero instead.";
const LIST_FAILED = "Your Xero contacts didn't load. Go back, then publish again to retry.";

/** Why "Map and publish" is greyed out, or null when it may go (CLAUDE.md's gated-button rule). */
function gateReason(
  contacts: ArchivedContact[],
  picks: Record<string, string>,
  options: XeroBillContact[] | null | "failed",
): string | null {
  if (options === null) return "Loading your Xero contacts…";
  if (options === "failed") return LIST_FAILED;
  if (options.length === 0) return NO_XERO_CONTACTS;
  const missing = contacts.filter((c) => !picks[c.id]);
  if (missing.length === 0) return null;
  return missing.length === 1
    ? `Choose the Xero contact for ${missing[0].name} to continue.`
    : "Choose a Xero contact for each contact above to continue.";
}

/**
 * "A contact is archived in Xero" (owner's decisions, C4, 2026-11-19): the publish was refused
 * (409) because Xero archived contacts the bill uses without merging them, and nothing was sent.
 * Per contact the doc's sentence and a searchable picker of the company's active Xero contacts
 * (read once, on open); "Map and publish" maps each (`POST /entity-bill-contacts/<id>/xero-link/`),
 * toasts each answer and hands back to publish again. A refused mapping says its sentence here and
 * keeps the dialog open; one already mapped is not sent twice. Go back, Escape or the backdrop
 * close it with nothing changed. A form, so this app's own frame (Upload Attachment's): full width
 * on a phone, a 520px card from sm.
 */
export function ArchivedContactsDialog({
  contacts,
  onCancel,
  onMapped,
}: {
  contacts: ArchivedContact[];
  onCancel: () => void;
  /** Every contact is mapped: publish again. */
  onMapped: () => void;
}) {
  const { showToast } = useToast();
  const titleId = useId();
  const gateId = useId();
  /** The company's Xero contacts: null while they load, "failed" when the read was refused. */
  const [options, setOptions] = useState<XeroBillContact[] | null | "failed">(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);

  useEffect(() => pushAppScrollLock(), []);

  useEffect(() => {
    panel.current?.focus();
    let live = true;
    fetchXeroBillContacts().then(
      (list) => {
        if (live) setOptions(list);
      },
      (err: unknown) => {
        if (!live) return;
        setOptions("failed");
        setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // ThemedSelect swallows the Escape that closes its open list (capture phase), so this one only
  // sees an Escape meant for the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  const reason = gateReason(contacts, picks, options);
  const list = Array.isArray(options) ? options : [];
  const selectOptions = list.map((o) => ({ value: o.xero_contact_id, label: o.name }));

  async function mapAndPublish() {
    if (reason || busy) return;
    setBusy(true);
    setProblem(null);
    const mapped = new Set(done);
    for (const contact of contacts) {
      if (mapped.has(contact.id)) continue;
      try {
        const answer = await linkBillContactToXero(contact.id, picks[contact.id]);
        showToast(answer.message, "success");
        mapped.add(contact.id);
        setDone(new Set(mapped));
      } catch (err) {
        setBusy(false);
        setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
        return;
      }
    }
    setBusy(false);
    onMapped();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center overflow-clip overscroll-none sm:items-center sm:p-4 md:p-6"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Go back"
        tabIndex={-1}
        className={`absolute inset-0 bg-overlay-scrim backdrop-blur-[1px] ${busy ? "cursor-not-allowed" : "cursor-pointer"}`}
        onClick={() => !busy && onCancel()}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-[1] flex max-h-[92dvh] w-full min-w-0 flex-col rounded-t-2xl bg-surface-card pb-[env(safe-area-inset-bottom)] shadow-xl outline-none ring-1 ring-border-subtle sm:max-h-[min(92dvh,760px)] sm:max-w-[520px] sm:rounded-2xl sm:pb-0"
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void mapAndPublish();
          }}
        >
          <div className="shrink-0 border-b border-border-subtle px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
            <h2
              id={titleId}
              className="text-lg font-bold leading-snug text-text-primary sm:text-xl md:text-2xl"
            >
              {contacts.length === 1
                ? "A contact is archived in Xero"
                : "Some contacts are archived in Xero"}
            </h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6">
            {problem ? (
              <div
                ref={problemRef}
                tabIndex={-1}
                className="mb-4 rounded-lg border border-status-danger-bg bg-status-danger-bg px-3 py-2 text-sm text-status-danger-ink outline-none [overflow-wrap:anywhere]"
                role="alert"
              >
                {problem}
              </div>
            ) : null}
            <div className="flex flex-col gap-5">
              {contacts.map((c) => {
                const id = `archived-contact-${c.id}`;
                const linked = done.has(c.id);
                return (
                  <div key={c.id} className="min-w-0">
                    <p className="mb-2 text-sm text-text-primary">
                      {archivedContactSentence(c.name)}
                    </p>
                    <label
                      htmlFor={id}
                      className="mb-1 block text-sm font-medium text-text-secondary"
                    >
                      Map {c.name} to
                    </label>
                    <ThemedSelect
                      id={id}
                      value={picks[c.id] ?? ""}
                      onChange={(value) => setPicks((p) => ({ ...p, [c.id]: value }))}
                      options={selectOptions}
                      placeholder={
                        options === null ? "Loading Xero contacts…" : "Search Xero contacts"
                      }
                      searchable
                      disabled={busy || linked || list.length === 0}
                    />
                    {linked ? <p className="mt-1 text-sm text-text-secondary">Mapped.</p> : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-5 text-sm text-text-secondary">
              Or restore it in Xero, then publish again.
            </p>
          </div>

          <div className="shrink-0 border-t border-border-subtle px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="box-border h-12 min-h-[48px] w-full min-w-0 cursor-pointer rounded-lg border-2 border-action-secondary-border bg-surface-card px-3 text-sm font-semibold text-action-secondary-text transition-colors hover:bg-state-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:min-h-[44px] sm:flex-1 sm:px-4"
              >
                Go back
              </button>
              <button
                type="submit"
                disabled={reason !== null || busy}
                aria-describedby={reason ? gateId : undefined}
                className="box-border h-12 min-h-[48px] w-full min-w-0 cursor-pointer rounded-lg border border-transparent bg-action-primary px-4 text-sm font-semibold text-action-on-primary shadow-sm transition-colors hover:bg-action-primary-hover active:bg-action-primary-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:min-h-[44px] sm:flex-1"
              >
                {busy ? "Mapping…" : "Map and publish"}
              </button>
            </div>
            {reason ? (
              <p id={gateId} className="mt-2 text-sm text-text-secondary sm:text-right">
                {reason}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
