import { clearAuth, getAuth } from "@/lib/auth";
import { COMPANY_PAGE, decodeSegment } from "@/lib/companyPages";
import { resolveMintyModuleUrl } from "@/lib/mintyEnv";
import { sessionExpiredShown, showSessionExpired } from "@/lib/sessionExpired";

/** Minty (module 1) origin — same as Petty Cash / entity entry. */
export const MINTY_MODULE_URL = resolveMintyModuleUrl();
export { resolveMintyModuleUrl };

/**
 * Minty entry URL with optional `next` path (path on the Minty app, e.g. `/entity/…/settings`):
 * accounts-api's `/entity/<id>/enter` goes on to `next` on the person's accounts-api session, or
 * signs them in first (gap 4, 2026-11-09: it carries no token - it used to be `?token=`). With no
 * company held, Minty's `/entity`.
 */
export function buildMintyEnterUrl(nextPath?: string): string {
  const entityId = getAuth()?.entityId;
  if (entityId) {
    const base = `${MINTY_MODULE_URL}/entity/${encodeURIComponent(entityId)}/enter`;
    return nextPath ? `${base}?next=${encodeURIComponent(nextPath)}` : base;
  }
  return `${MINTY_MODULE_URL}/entity`;
}

/**
 * Flask's way into this app for the company in an address: a page of a company the cookie does
 * not hold (another tab switched it, a bookmark, an expired cookie) goes there, and Flask -
 * after its sign-in and membership checks - mints a token for that company and lands on the
 * same page. Flask resolves `<shortid>/<name>` itself. (middleware.ts; and the way back after
 * "Your session has expired", below.)
 */
export function companyHandoffUrl(ref: string, slug: string, page: string): string {
  const company = `${resolveMintyModuleUrl().replace(/\/+$/, "")}/entity/${ref}/${slug}`;
  if (page.startsWith("settings/")) return `${company}/settings/payment-request`;
  // The pathname is still percent-encoded and URLSearchParams encodes again, so decode first
  // (`PR%2F0001` reaches Flask as `PR%2F0001`, not `PR%252F0001`). `new` names no request.
  const requestId = decodeSegment(page.split("/")[1] ?? "").trim();
  return requestId && requestId !== "new"
    ? `${company}/payment-request?${new URLSearchParams({ request: requestId }).toString()}`
    : `${company}/payment-request`;
}

/**
 * The hub's sign-in page when the sign-in behind the token has ENDED (lib/sessionExpired.ts,
 * 2026-11-19): accounts-api's front door (`/`), which sends the person to minty-web's `/login` -
 * the right copy of it on a preview set - with `next` = the company hand-off (a path on
 * accounts-api) back to this page, or the company list off a company page. Someone signed in
 * again meanwhile (another tab) goes straight back.
 */
export function sessionExpiredLoginUrl(): string {
  const page = COMPANY_PAGE.exec(window.location.pathname);
  const back = page ? new URL(companyHandoffUrl(page[1], page[2], page[3])) : null;
  const next = back ? back.pathname + back.search : "/entity";
  return `${MINTY_MODULE_URL}/?${new URLSearchParams({ next }).toString()}`;
}

/** "Your session has expired": the cookies cleared, then `showSessionExpired` - once. */
export function sessionExpired(): void {
  if (sessionExpiredShown() || typeof window === "undefined") return;
  const url = sessionExpiredLoginUrl();
  clearAuth();
  showSessionExpired(url);
}

/** The hub's settings tabs this app links to, by accounts-api's name for each address. */
export type HubSettingsTab = "general" | "integration" | "payment-request";

/**
 * A company's settings tab in the hub (minty-web), where every company setting lives since
 * 2026-11-10 (owner): accounts-api's company address for it, whose gated hand-off mints the hub's
 * token and opens the tab - `general` (name, country, currency), `integration` (Xero) and
 * `payment-request` (the old name of the hub's Payment Settings tab). `company` is the id, or with
 * `readable` the address's own `<shortid>/<name>` (the old settings page knows only that).
 */
export function hubSettingsUrl(
  company: string,
  tab: HubSettingsTab,
  { readable = false }: { readable?: boolean } = {},
): string {
  const at = readable
    ? company.split("/").map(encodeURIComponent).join("/")
    : encodeURIComponent(company);
  return `${MINTY_MODULE_URL}/entity/${at}/settings/${tab}`;
}

/**
 * Leave by a top-level form POST (no body) - Minty's `/logout` answers a GET with 405 and takes a
 * POST only from a front end's `Origin`. Never `fetch` (the session cookie and the 302 belong to
 * the browser's navigation). The meta first: this app's `Referrer-Policy: same-origin` makes the
 * browser send `Origin: null` on a cross-origin POST, and `strict-origin` names only the origin -
 * what `Origin` says anyway, never a path or query. The page is leaving, so it stays.
 */
export function postNavigate(url: string): void {
  const meta = document.createElement("meta");
  meta.name = "referrer";
  meta.content = "strict-origin";
  document.head.appendChild(meta);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  form.hidden = true;
  document.body.appendChild(form);
  form.submit();
}
