// "Your session has expired" (owner, 2026-11-19): a 401 whose body says `reason: session_expired`
// (the hub sign-in behind the token has ended - 60 minutes without activity, or signed out) goes
// through ONE call, `showSessionExpired(loginUrl)`, once however many calls fail together: the
// hub's sign-in page (accounts-api's front door) with `next` = the company hand-off back to the
// page the person was on. Any other 401 still hands the person over quietly (`redirectToLogin`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenExpiringIn } from "@/lib/__fixtures__/tokens";
import { env } from "@/lib/env";

const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const PAGE = "/entity/360812e1/olive-vine/payment-request/PR-0001";
const fetchMock = vi.fn<typeof fetch>();
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fresh module graph: the once-only guards start clear. */
async function fresh() {
  vi.resetModules();
  const modules = {
    api: await import("@/lib/api"),
    auth: await import("@/lib/auth"),
    expired: await import("@/lib/sessionExpired"),
    host: await import("@/components/ui/sidebarHost"),
  };
  const handedOver: string[] = [];
  const shown: string[] = [];
  modules.auth._resetRedirectForTests((url) => handedOver.push(url));
  modules.expired._resetSessionExpiredForTests((url) => shown.push(url));
  const now = Math.floor(Date.now() / 1000);
  modules.auth.setAuth(tokenExpiringIn(1500, { iat: now - 300 }), ENTITY_ID, "Olive & Vine");
  return { ...modules, handedOver, shown };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", PAGE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  window.history.replaceState(null, "", "/");
});

describe("a 401 whose sign-in has ended", () => {
  it("reads the reason off a 401's body", async () => {
    const { expired } = await fresh();
    expect(expired.isSessionExpired({ detail: "Unauthorized", reason: "session_expired" })).toBe(
      true,
    );
    expect(expired.isSessionExpired({ detail: "Unauthorized" })).toBe(false);
    expect(expired.isSessionExpired(null)).toBe(false);
  });

  it("says so once for calls failing together, with the way back to this page", async () => {
    const { api, auth, host, handedOver, shown } = await fresh();
    fetchMock.mockImplementation(async () =>
      answer(401, { detail: "Unauthorized", reason: "session_expired" }),
    );

    const results = await Promise.allSettled([
      api.fetchBills(),
      host.mintyFetch("/api/me/profile"),
      host.billingApiFetch("/api/me/subscriptions", { onUnauthorized: "reject" }),
    ]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(handedOver).toEqual([]); // no quiet hand-off
    expect(shown).toHaveLength(1);
    const target = new URL(shown[0]);
    expect(target.origin + target.pathname).toBe(env.ACCOUNTS_API_URL + "/");
    const back = new URL(target.searchParams.get("next") ?? "", env.ACCOUNTS_API_URL);
    expect(back.pathname).toBe("/entity/360812e1/olive-vine/payment-request");
    expect(back.searchParams.get("request")).toBe("PR-0001");
    expect(auth.getAuth()).toBeNull();
  });

  it("a 401 without the reason still hands the person over quietly", async () => {
    const { api, handedOver, shown } = await fresh();
    fetchMock.mockResolvedValueOnce(answer(401, { detail: "Unauthorized" }));

    await api.fetchBills().catch(() => undefined);

    expect(shown).toEqual([]);
    expect(handedOver).toEqual([PAGE]);
  });

  it("off a company page, the way back is the company list", async () => {
    const { mintyUrls } = { mintyUrls: await import("@/lib/mintyUrls") };
    window.history.replaceState(null, "", "/landing");
    const back = new URL(
      new URL(mintyUrls.sessionExpiredLoginUrl()).searchParams.get("next") ?? "",
      env.ACCOUNTS_API_URL,
    );
    expect(back.pathname).toBe("/entity");
  });
});
