# Authentication — minty-payment-request-web's half

Nobody signs in here. Minty (Flask) authenticates the person, mints a short-lived JWT and
sends the browser to this app; everything after that is carrying that token to
minty-payment-request-api, and — for the subscription notice and the sidebar — straight to
minty-subscription-api and Minty. The system-wide picture
is `minty-accounts-api/docs/features/authentication.md`; minty-payment-request-api's verification is
`minty-payment-request-api/docs/features/authentication.md`.

## Arriving: `/landing`

Minty links **Payments** to `/landing?code=<one-time code>&entity_id=&entity_name=&next=`
(`app/landing/page.tsx`, the shared `@minty/shared/landing` hook since v0.16). **Gap 4
(2026-11-09):** the page swaps the code for the token at accounts-api's `POST
/api/handoff/redeem` (once, 2 minutes, from this origin only); a used or lapsed code says so, with
a Continue back into Minty's `/entity`. A `?token=` in the address is never stored. The way back (`lib/mintyUrls.ts::buildMintyEnterUrl`, `/entity/<id>/enter?next=`)
carries no token. The page stores the token, the entity id and name in cookies
(`lib/auth.ts`: `billing_token`, `billing_entity_id`, `billing_entity_name`, `SameSite=Lax`,
`Secure` on https, **exactly the token's 30 minutes** - Phase 9) and forwards to `next` (Flask sends the company's list or its
Payment Request Settings - see Addresses below; `/`, the company's list, when there is none; a path on this
origin only - `lib/safeNext.ts`, a COPY of minty-web's: no `//host`, backslash or control
character, which until 2026-10-05 let `next=/%5Cevil.com` leave the site); `from` is
ignored since 2026-10-01 (its `billing_from` cookie served only the deleted profile pages' back
links). Without a token the middleware sends every page except `/landing` back into Minty's
`/entity` (`middleware.ts`; `/landing` itself does the same): the entity list for a signed-in
person, sign-in otherwise. Choosing between Petty Cash and Payment Request is minty-web's page
since phase 2 (2026-10-05) - this app's `/module-selection` is gone.

The old profile and payer-portal addresses (`/profile/*`) are forwarded by the middleware
BEFORE that check - an old email link arrives with no cookie - to minty-web through Minty:
`/profile` to Flask's `/profile` (its profile router), the portal pages to Flask's
`/handoff/minty-web?next=<minty-web page>`, the query string kept ([payer-portal.md](payer-portal.md)).

The cookies are readable by script on purpose (the app itself attaches the token); they
are cleared client-side on logout and by `POST /api/auth/logout` on the backend. **Logout** (the
sidebar's menu and My Profile — [sidebar.md](sidebar.md)) ends the session everywhere since
2026-09-30: after those two it leaves for Minty's `/logout`, where it used to land on Minty's
entity list with Minty still signed in. It leaves by a top-level form POST (`postNavigate`,
`lib/mintyUrls.ts`): `/logout` answers a GET with 405 and checks the POST's `Origin`, which a
`strict-origin` referrer meta keeps (this app's `Referrer-Policy: same-origin` would send `null`).

## Addresses: `/entity/<shortid>/<name>/...` (2026-10-05)

The pages live under the company's address, Flask's scheme (`minty-accounts-api/docs/features/authentication.md`
§3.2), built by `lib/companyPages.ts` from `lib/companyRef.ts` (a COPY of minty-web's):

| Page                   | Address                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| The list               | `/entity/<shortid>/<name>/payment-request`                                         |
| One payment request    | `/entity/<shortid>/<name>/payment-request/<Payment No.>` - the id when it has none |
| Payment Settings (old) | `/entity/<shortid>/<name>/settings/payment-request` - a redirect to the hub's tab  |

The company is still the cookie's - every API call sends its id - so `middleware.ts` checks the
address against the cookie before a page renders:

- **Another company's page** (another tab switched the cookie, a bookmark, an expired cookie):
  sent to Flask's `/entity/<shortid>/<name>/payment-request` (`?request=<id>` for one request -
  the segment decoded first, so it is encoded once, not twice; `new` is never sent as one) or
  `/settings/payment-request`, which signs in, checks membership, mints a token for that company
  and lands on the same page.
- **A misspelt name or a capital in the short id** (a renamed company's old link): moved to the
  cookie's spelling.
- **The old addresses** `/`, `/payment-request/<id>` and `/settings` move to the cookie
  company's, query kept.

All three are **307s, never 308s**: the target depends on the cookie, and a browser keeps a 308
for good, so the next company's `/` would open this one's address. Links on a company page take
the address from the URL (`useCompanyPages`, so the server's render and the browser's agree);
the sidebar and module selection take it from the cookie (`cookieCompanyPages`).

## Using the token

`lib/api.ts::apiFetch` sends `Authorization: Bearer <token>` and `X-Entity-Id` on every
call to minty-payment-request-api (`PAYMENT_REQUEST_API_URL`). The JWT and its cookie live
**30 minutes**, and nothing refreshes it (Phase 9, owner's S2, 2026-11-19: the 8-hour
`refreshToken` and `POST /api/auth/token/refresh` are gone, so Payment Request signs out
when Minty does). A 401 on an expired token, or on one handed over more than a minute ago
(`isTokenFresh` - the Minty sign-in behind it may have ended: signed out, or 60 minutes
without activity), runs `lib/auth.ts::redirectToLogin`: the cookies are cleared and the SAME
address is loaded again, which `middleware.ts` sends through accounts-api's company hand-off
(`flaskHandoff`) - silently back with a fresh token while the sign-in lives, through the
sign-in page when it does not. A 401 on a token under a minute old is the server declining
this caller (no role), reported in place - one hand-off at most, never a loop. Input on the
open form is lost (no warning first, S3).

**"Your session has expired" (owner, 2026-11-19).** A 401 whose body carries `"reason": "session_expired"` - every API adds it when the Minty sign-in behind the token has ENDED (signed out, or 60 minutes without activity; minty-accounts-api `docs/features/authentication.md` 3.3) - is not renewed quietly: `lib/sessionExpired.ts` reads it (`isSessionExpired(body)`) and calls ONE local `showSessionExpired(loginUrl)`, once however many calls fail together, and the quiet hand-off then stays put. Today that call only goes to the sign-in page; the pop-up ("Your session has expired", one OK) is to come from `@minty/shared` as one component for every app and will sit behind the same call. Read in `lib/api.ts` (both 401 paths) and `components/ui/sidebarHost.ts` (`bearerJson`, decoration
too). `loginUrl` = accounts-api's front door `/?next=` the company hand-off for the page the person
was on (`lib/mintyUrls.ts::sessionExpiredLoginUrl` + `companyHandoffUrl`, which `middleware.ts`
uses too; off a company page, `/entity`); the cookies are cleared first. Tests:
`lib/__tests__/sessionExpired.test.ts`.

The role and the module claims in the token (`lib/moduleClaims.ts`, `useUserRole`) are
read for the **first paint only**; `components/ModuleGate.tsx` then confirms the
entitlement from `GET /api/auth/entitlements` and the backend re-checks role and
membership on every call — the database decides, not the claim
(`e2e/01_handoff.spec.ts` proves it).

## What the role changes on screen

`useUserRole()` decides which actions render: cashiers and shop managers create and
edit; accountant / admin / super_admin (the _elevated_ roles) also record payments,
return, void and publish. The backend refuses the rest regardless
(`minty-payment-request-api/core/permissions.py`).

A **system super admin who is not a member** of the company is view-only: every write control
is dead. The token's `is_view_only` decides when it carries one; otherwise a `system_role` of
`superadmin` (what Flask mints) or the legacy `superuser` - trimmed, any case
(`isSystemSuperAdmin`) - makes the hook ask `GET /api/v1/profile/me` for the member companies.
Until 2026-10-20 only `superuser` was recognised, so a super admin on a token without the claim
was offered write controls the API then refused.

## The subscription notice talks to minty-subscription-api directly

The landing page's subscription notice (`lib/subscriptionNotice.ts`,
`components/SubscriptionNoticeModal.tsx`) fetches the subscription engine's
`GET /api/entities/<id>/subscription-notice` (`SUBSCRIPTION_API_URL`, `lib/env.ts`) with the same
JWT: Minty signed it with the shared key, so the API verifies it, and a token that names no
company is held to the caller's membership of the company in the path. (Until 2026-10-06 it
read Flask's `/api/entity/<id>/subscription-notice`, which is deleted.) Two kinds come back,
`past_due` and `pending_cancel` (no trial kind since 2026-10-01). Its button opens
`settings_path` - a Flask path with its own query (`/handoff/minty-web?next=<the module page>&entity_id=<id>`)

- through `/entity/<id>/enter` (`buildMintyEnterUrl`, which URL-encodes it whole as `next`). A
  failed notice shows nothing.

## The sidebar talks to Flask and minty-subscription-api directly

My Profile reads and saves Flask's `/api/me/profile`, the header's initials read it once per
token, and the Subscriptions Overview reads minty-subscription-api's `/api/me/subscriptions` — all
with this app's token (`components/ui/sidebarHost.ts`; [sidebar.md](sidebar.md)).

## Configuration

`PAYMENT_REQUEST_API_URL` (minty-payment-request-api, default `http://localhost:8020`),
`ACCOUNTS_API_URL` (minty-accounts-api, default `http://localhost:8000` — one variable, no environment-name
switch), `SUBSCRIPTION_API_URL` (minty-subscription-api, default `http://localhost:8000`); all
read in `lib/env.ts` and inlined at build time (`next.config.ts` `env`). `ACCOUNTS_API_URL` was
named `PETTY_CASH_URL` until 2026-11-06.

## Tests

`e2e/01_handoff.spec.ts` (no token → module selection; the hand-off sets the cookies; the
database entitlement decides). There is no unit-test runner in this repo — the Playwright
suite is the test suite, and it mints its own token with the shared `SECRET_KEY`
(`e2e/README.md`).
