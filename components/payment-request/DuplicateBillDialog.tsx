"use client";

import { useCallback, useRef, useState } from "react";

import { formatMoney } from "@minty/shared/money";

import { duplicateBillsOf, type DuplicateBill } from "@/lib/api";
import { formatIsoDateForDisplay } from "@/lib/dateDisplayFormat";

import { ConfirmDialog } from "./ConfirmDialog";

type Warning = { sentence: string; duplicates: DuplicateBill[] };

/**
 * The duplicate reminder (owner's decisions doc DUP1, 2026-11-19; `duplicateBillsOf` in
 * lib/api.ts): the API's sentence and each bill with the same date, supplier and amount
 * (reference · supplier · amount · date), then Go back (nothing saved, the form stays as typed) or
 * Save anyway (the same save again with `confirm_duplicate: true`). It never blocks. On
 * minty-web's `ConfirmDialog`, above every form and dialog of the app (z 440).
 */
export function DuplicateBillDialog({
  warning,
  currencyCode,
  onSaveAnyway,
  onBack,
}: {
  warning: Warning;
  currencyCode: string | null | undefined;
  onSaveAnyway: () => void;
  onBack: () => void;
}) {
  return (
    <ConfirmDialog
      open
      zIndex={440}
      title="Save it anyway?"
      confirmLabel="Save anyway"
      confirmVariant="primary"
      backLabel="Go back"
      onConfirm={onSaveAnyway}
      onClose={onBack}
    >
      <span className="block">{warning.sentence}</span>
      {warning.duplicates.map((d) => (
        <span key={d.id} className="mt-3 block min-w-0 [overflow-wrap:anywhere]">
          {[
            d.reference,
            d.contact,
            formatMoney(d.amount, currencyCode),
            d.invoice_date ? formatIsoDateForDisplay(d.invoice_date) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ))}
    </ConfirmDialog>
  );
}

/** The question's state, from `useDuplicateBillQuestion`, for `DuplicateBillQuestion` to draw. */
export type DuplicateQuestion<Save extends string> = {
  asked: { warning: Warning; save: Save } | null;
  /** Closes it; `saveAnyway` arms `confirmed()` for the next save. Answers the save that asked. */
  answer: (saveAnyway: boolean) => Save | null;
};

/**
 * DUP1 for one form: `ask(err, save)` opens the question when `err` is the duplicate 409 (true),
 * remembering which of the form's saves asked; any other error is left to the caller (false).
 * `DuplicateBillQuestion` draws it: Save anyway calls that save again, and the save's first line,
 * `confirmed()`, then answers true once, so that one request carries `confirm_duplicate: true`
 * (every other save answers false). `asking` is true while the question is open, so the form's own
 * Escape handler can leave the keystroke to it.
 */
export function useDuplicateBillQuestion<Save extends string>(): {
  ask: (err: unknown, save: Save) => boolean;
  confirmed: () => boolean;
  asking: boolean;
  question: DuplicateQuestion<Save>;
} {
  const [asked, setAsked] = useState<{ warning: Warning; save: Save } | null>(null);
  const ask = useCallback((err: unknown, save: Save) => {
    const warning = duplicateBillsOf(err);
    if (!warning) return false;
    setAsked({ warning, save });
    return true;
  }, []);
  const saveAnyway = useRef(false);
  const confirmed = useCallback(() => {
    const yes = saveAnyway.current;
    saveAnyway.current = false;
    return yes;
  }, []);
  const answer = (yes: boolean) => {
    setAsked(null);
    saveAnyway.current = yes;
    return asked?.save ?? null;
  };
  return { ask, confirmed, asking: asked !== null, question: { asked, answer } };
}

/** The open question, if any; Save anyway runs `saves[the save that asked]` again. */
export function DuplicateBillQuestion<Save extends string>({
  question,
  currencyCode,
  saves,
}: {
  question: DuplicateQuestion<Save>;
  currencyCode: string | null | undefined;
  saves: Record<Save, () => void>;
}) {
  if (!question.asked) return null;
  return (
    <DuplicateBillDialog
      warning={question.asked.warning}
      currencyCode={currencyCode}
      onSaveAnyway={() => {
        const save = question.answer(true);
        if (save) saves[save]();
      }}
      onBack={() => question.answer(false)}
    />
  );
}
