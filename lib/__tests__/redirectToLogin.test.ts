// The once-only trip back to Minty (lib/auth.ts `redirectToLogin`) - module-level state
// (`redirecting`), so each case imports a fresh module.
//
// There is no token refresh (Phase 9, owner's S2, 2026-11-19): the 30-minute hand-off token is
// kept as it is, and when it runs out - or the Minty sign-in behind it ends - the person is
// handed over again ON THE SAME PAGE, as petty-cash-web does.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unsignedToken } from "@/lib/__fixtures__/tokens";

const TOKEN = unsignedToken();
const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const ENTITY_NAME = "Olive & Vine";

async function freshAuth() {
  vi.resetModules();
  const auth = await import("@/lib/auth");
  const visited: string[] = [];
  auth._resetRedirectForTests((url) => visited.push(url));
  return { auth, visited };
}

describe("redirectToLogin", () => {
  beforeEach(() => {
    window.history.replaceState(
      null,
      "",
      "/entity/360812e1/olive-vine/payment-request/PR-0042?tab=history",
    );
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("clears the session and loads the same page again, which middleware hands over", async () => {
    const { auth, visited } = await freshAuth();
    auth.setAuth(TOKEN, ENTITY_ID, ENTITY_NAME);

    auth.redirectToLogin();

    expect(auth.getAuth()).toBeNull();
    expect(visited).toEqual(["/entity/360812e1/olive-vine/payment-request/PR-0042?tab=history"]);
  });

  it("fires once - several failing requests do not each navigate", async () => {
    const { auth, visited } = await freshAuth();
    auth.setAuth(TOKEN, ENTITY_ID, ENTITY_NAME);

    auth.redirectToLogin();
    expect(auth.getAuth()).toBeNull();

    // A second caller must do nothing at all - if it still ran, it would clear this again.
    auth.setAuth(TOKEN, ENTITY_ID, ENTITY_NAME);
    auth.redirectToLogin();
    expect(auth.getAuth()?.token).toBe(TOKEN);
    expect(visited).toHaveLength(1);
  });

  it("no longer offers a refresh", async () => {
    const { auth } = await freshAuth();
    expect("refreshToken" in auth).toBe(false);
    expect("isTokenExpiringSoon" in auth).toBe(false);
  });
});
