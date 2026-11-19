/**
 * The module token, kept in a cookie.
 *
 * minty-accounts-api hands this app a 30-minute token for ONE company; the cookies live exactly
 * as long as it (its `exp`), as petty-cash-web's do. There is no refresh (Phase 9, owner's S2,
 * 2026-11-19): when the token runs out, or the Minty sign-in behind it ends (signed out, or 60
 * minutes without activity - every API then answers 401), the person is handed over again on
 * the same page (`redirectToLogin`), so Payment Request signs out when Minty does.
 */

import { sessionExpiredShown } from "./sessionExpired";

const TOKEN_KEY = "billing_token";
const ENTITY_ID_KEY = "billing_entity_id";
const ENTITY_NAME_KEY = "billing_entity_name";

/** What a token is allowed to live when its `exp` cannot be read - the hand-off token's lifetime. */
const FALLBACK_MAX_AGE_SECONDS = 60 * 30;

export type AuthInfo = {
  token: string;
  entityId: string;
  entityName: string;
};

/** Seconds until the token's `exp`, floored at 1 - or the fallback when there is no `exp`. */
export function secondsUntilExpiry(token: string): number {
  const exp = decodeJwtPayload(token)?.exp;
  if (typeof exp !== "number") return FALLBACK_MAX_AGE_SECONDS;
  return Math.max(1, Math.floor(exp - Date.now() / 1000));
}

export function setAuth(token: string, entityId: string, entityName: string) {
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  const opts = `path=/;max-age=${secondsUntilExpiry(token)};SameSite=Lax${isSecure ? ";Secure" : ""}`;
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)};${opts}`;
  document.cookie = `${ENTITY_ID_KEY}=${encodeURIComponent(entityId)};${opts}`;
  document.cookie = `${ENTITY_NAME_KEY}=${encodeURIComponent(entityName)};${opts}`;
}

export function getAuth(): AuthInfo | null {
  if (typeof document === "undefined") return null;
  const jar = Object.fromEntries(
    document.cookie
      .split("; ")
      .filter(Boolean)
      .map((c) => {
        const idx = c.indexOf("=");
        return [c.slice(0, idx), decodeURIComponent(c.slice(idx + 1))];
      }),
  );
  const token = jar[TOKEN_KEY];
  if (!token) return null;
  return {
    token,
    entityId: jar[ENTITY_ID_KEY] ?? "",
    entityName: jar[ENTITY_NAME_KEY] ?? "",
  };
}

/**
 * The same read as `getAuth()`, but referentially stable while the cookies are unchanged.
 *
 * `getAuth()` parses the jar on every call and returns a FRESH object. That is fine for a one-off
 * read, and unusable as a `useSyncExternalStore` snapshot: React compares snapshots by identity,
 * so a new object every call loops forever. Caching on the raw cookie string keeps the identity
 * stable and still notices `setAuth()` / `clearAuth()` / a cookie expiring.
 *
 * See `useClientValue` for why components read auth this way rather than in an effect.
 */
let cookieJarAtParse: string | null = null;
let parsedAuth: AuthInfo | null = null;

export function getAuthSnapshot(): AuthInfo | null {
  if (typeof document === "undefined") return null;
  if (document.cookie !== cookieJarAtParse) {
    cookieJarAtParse = document.cookie;
    parsedAuth = getAuth();
  }
  return parsedAuth;
}

/** `getAuthSnapshot()?.entityId ?? ""`, as a standalone snapshot for the components that only want it. */
export function getEntityIdSnapshot(): string {
  return getAuthSnapshot()?.entityId ?? "";
}

export function clearAuth() {
  const expire = "path=/;max-age=0";
  document.cookie = `${TOKEN_KEY}=;${expire}`;
  document.cookie = `${ENTITY_ID_KEY}=;${expire}`;
  document.cookie = `${ENTITY_NAME_KEY}=;${expire}`;
}

/** Cookie names read by Next.js middleware: auth gating, and the company the address must name. */
export const AUTH_COOKIE_NAME = TOKEN_KEY;
export const ENTITY_ID_COOKIE_NAME = ENTITY_ID_KEY;
export const ENTITY_NAME_COOKIE_NAME = ENTITY_NAME_KEY;

/**
 * Decodes the JWT payload and returns the `role` claim string, or null if the
 * token is missing, malformed, or contains no `role` claim. Never throws.
 */
export function getRoleFromToken(): string | null {
  try {
    const auth = getAuth();
    if (!auth?.token) return null;
    const payload = decodeJwtPayload(auth.token);
    if (!payload) return null;
    if (typeof payload.role !== "string" || !payload.role) return null;
    return payload.role;
  } catch {
    return null;
  }
}

/**
 * Neutral JWT-payload decode: splits the token, base64url-decodes and JSON-
 * parses the payload segment, and returns it as a plain object — or `null` if
 * the token is missing a payload, malformed, or the payload isn't a JSON
 * object. Never throws. Callers apply their own claim reading and defaults.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    const json = atob(base64);
    const payload = JSON.parse(json) as unknown;
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Returns the `sid` claim — an opaque id for the Minty sign-in this token belongs
 * to — or null if absent. Minty rewrites it on every login, so it is how this app
 * distinguishes "same sign-in as before" from "signed out and back in": it cannot
 * see the Flask session that actually holds that state.
 *
 * Not a credential and not usable as one; it only ever answers that question.
 * Tokens minted outside a request context carry an empty sid, treated as absent.
 */
export function getLoginSidFromToken(): string | null {
  try {
    const auth = getAuth();
    if (!auth?.token) return null;
    const payload = decodeJwtPayload(auth.token);
    if (!payload) return null;
    if (typeof payload.sid !== "string" || !payload.sid) return null;
    return payload.sid;
  } catch {
    return null;
  }
}

/**
 * True while the token was handed over within `seconds` (default 60), from its `iat`. A 401 on
 * a token Minty has just handed over cannot be cured by handing over again - the person lacks
 * access - so it is reported, never looped on; an older one may mean the sign-in behind it has
 * ended (Phase 9). False with no token, a malformed one or no `iat`. Never throws.
 */
export function isTokenFresh(seconds = 60): boolean {
  try {
    const auth = getAuth();
    if (!auth?.token) return false;
    const iat = decodeJwtPayload(auth.token)?.iat;
    if (typeof iat !== "number") return false;
    return Date.now() / 1000 - iat < seconds;
  } catch {
    return false;
  }
}

/**
 * Returns true only if the JWT is already past its `exp` claim (with a small
 * 5-second clock-skew tolerance). A 401 on an expired token always hands the
 * person over again.
 * Returns false if the token is missing, malformed, or has no `exp` claim.
 * Never throws.
 */
export function isTokenExpired(): boolean {
  try {
    const auth = getAuth();
    if (!auth?.token) return false;
    const payload = decodeJwtPayload(auth.token);
    if (!payload) return false;
    if (typeof payload.exp !== "number") return false;
    return payload.exp - Date.now() / 1000 < -5;
  } catch {
    return false;
  }
}

/**
 * Hands the person back to Minty for a fresh token, returning to the page they are on - when
 * the token has run out, or the Minty sign-in behind it has ended (Phase 9). petty-cash-web's
 * `redirectToHandoff`, through this app's middleware: the cookies are cleared and the SAME
 * address is loaded again, which middleware.ts sends through accounts-api's company hand-off
 * (`flaskHandoff`) - silently back here with a fresh 30-minute token while the Minty sign-in
 * lives, through the sign-in page (and then back) when it does not. Input on the open form is
 * lost (no warning first, owner's S3).
 *
 * It used to go to Minty's root, which lost the page; before that to a relogin route Flask
 * replayed on ITS origin (a 404). The company address is one middleware already hands over.
 *
 * Fires once. Several requests in flight fail together, and each one calling
 * this would reassign `location.href` while the first navigation is already
 * under way.
 */
type Navigate = (url: string) => void;

const defaultNavigate: Navigate = (url) => {
  window.location.href = url;
};

let navigate: Navigate = defaultNavigate;
let redirecting = false;

export function redirectToLogin() {
  if (redirecting || sessionExpiredShown() || typeof window === "undefined") return;
  redirecting = true;

  clearAuth();
  navigate(window.location.pathname + window.location.search);
}

/** Test seam: forget that a redirect is under way, and optionally capture the navigation
 * instead of assigning `location.href` (jsdom does not allow `location` to be replaced). */
export function _resetRedirectForTests(capture?: Navigate) {
  redirecting = false;
  navigate = capture ?? defaultNavigate;
}
