"use client";

/**
 * Auto-saved drafts (`@minty/shared/drafts`, the owner's decisions doc L1, 2026-11-20): what the
 * person types in Add Payment, a request's Edit and Easy View's draft edit is kept in THIS
 * browser 2 seconds after their last change - never the real bill, which only their own Save
 * writes. Kept per person and company, from the token this app holds.
 */

import { draftScopeFromToken, type DraftScope } from "@minty/shared/drafts";

import { getAuth } from "@/lib/auth";

/** The signed-in person and company (the token's `user_id`, `entity_id`), or null: no drafts. */
export function currentDraftScope(): DraftScope | null {
  return draftScopeFromToken(getAuth()?.token);
}

/** A bill edit's draft is kept against its `updated_at`; a bill this person can no longer edit
 * gets a marker that never matches, so its draft is dropped, never put back. */
export function billDraftBasis(updatedAt: string | null | undefined, editable: boolean): string {
  return editable ? (updatedAt ?? "") : `locked:${updatedAt ?? ""}`;
}
