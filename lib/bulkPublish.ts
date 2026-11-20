import {
  ApiError,
  archivedContactsOf,
  isXeroAuthError,
  publishBill,
  XERO_RECONNECT_MESSAGE,
  type ArchivedContact,
} from "@/lib/api";

/**
 * Bulk Publish on the list (owner's decisions C4, 2026-11-19): each selected bill is published on
 * its own and EVERY answer is waited for, so one refusal never hides what the others did. The
 * answers are sorted three ways:
 *
 * - `published` - in Xero now;
 * - `archived` - refused because Xero archived a contact the bill uses (409 `archived_contacts`):
 *   each contact once, however many bills share it, and the bills to publish again once mapped
 *   (the same dialog a single bill opens);
 * - `failed` - any other refusal, with the API's own sentence (a Xero sign-in problem reads as the
 *   reconnect sentence, as on a single bill).
 */
export type BulkPublishResult = {
  published: string[];
  archived: { contacts: ArchivedContact[]; billIds: string[] };
  failed: { id: string; message: string }[];
};

const NOT_SENT = "This payment didn't quite make it over to Xero. Mind trying again?";

export async function publishEach(
  ids: readonly string[],
  publish: (id: string) => Promise<unknown> = publishBill,
): Promise<BulkPublishResult> {
  const answers = await Promise.allSettled(ids.map((id) => publish(id)));
  const result: BulkPublishResult = {
    published: [],
    archived: { contacts: [], billIds: [] },
    failed: [],
  };
  const seen = new Set<string>();
  answers.forEach((answer, i) => {
    const id = ids[i];
    if (answer.status === "fulfilled") {
      result.published.push(id);
      return;
    }
    const err: unknown = answer.reason;
    const archived = archivedContactsOf(err);
    if (archived) {
      result.archived.billIds.push(id);
      for (const contact of archived) {
        if (seen.has(contact.id)) continue;
        seen.add(contact.id);
        result.archived.contacts.push(contact);
      }
      return;
    }
    result.failed.push({
      id,
      message: isXeroAuthError(err)
        ? XERO_RECONNECT_MESSAGE
        : err instanceof ApiError
          ? err.message
          : NOT_SENT,
    });
  });
  return result;
}

/**
 * One toast for the refusals that are not about archived contacts: the count, then each distinct
 * sentence once (three bills refused for the same reason say it once). Null when there are none.
 */
export function failedSummary(failed: BulkPublishResult["failed"]): string | null {
  if (failed.length === 0) return null;
  const reasons = Array.from(new Set(failed.map((f) => f.message)));
  const head =
    failed.length === 1
      ? "1 payment request wasn't published."
      : `${failed.length} payment requests weren't published.`;
  return `${head} ${reasons.join(" ")}`;
}
