// The cookie jar and the claims read out of the token (lib/auth.ts).
//
// Nothing here verifies a signature, because the app does not: the API re-checks every call.
// What the app DOES do client-side is decide, from the token alone, how long to keep it, whether
// a 401 means handing the person over again, and what they may see - so those readers are what
// this pins. There is no refresh (Phase 9): the cookie lives exactly as long as the token.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moduleTokenClaims, tokenExpiringIn, unsignedToken } from "@/lib/__fixtures__/tokens";
import {
  AUTH_COOKIE_NAME,
  ENTITY_ID_COOKIE_NAME,
  ENTITY_NAME_COOKIE_NAME,
  clearAuth,
  decodeJwtPayload,
  getAuth,
  getLoginSidFromToken,
  getRoleFromToken,
  isTokenExpired,
  isTokenFresh,
  setAuth,
} from "@/lib/auth";

const TOKEN = unsignedToken();
const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const ENTITY_NAME = "Olive & Vine";

/**
 * Records what the module writes to `document.cookie`. The attributes are the point - a jar
 * read back gives only `name=value`, so `max-age`, `SameSite` and `Secure` are invisible to
 * any other kind of assertion.
 */
function recordCookieWrites() {
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
  const writes: string[] = [];
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => descriptor.get!.call(document),
    set: (value: string) => {
      writes.push(value);
      descriptor.set!.call(document, value);
    },
  });
  return {
    writes,
    restore: () => {
      delete (document as unknown as Record<string, unknown>).cookie;
    },
  };
}

/** The same claims minus one, without leaving an unused binding behind. */
function tokenWithout(claim: string): string {
  const claims: Record<string, unknown> = moduleTokenClaims();
  delete claims[claim];
  return unsignedToken(claims);
}

describe("the cookie names", () => {
  it("are the three literals middleware.ts reads on the server", () => {
    expect(AUTH_COOKIE_NAME).toBe("billing_token");
    expect(ENTITY_ID_COOKIE_NAME).toBe("billing_entity_id");
    expect(ENTITY_NAME_COOKIE_NAME).toBe("billing_entity_name");
  });
});

describe("setAuth and getAuth", () => {
  it("round-trip the token and the company", () => {
    setAuth(TOKEN, ENTITY_ID, ENTITY_NAME);
    expect(getAuth()).toEqual({ token: TOKEN, entityId: ENTITY_ID, entityName: ENTITY_NAME });
  });

  it("round-trip a company name that needs encoding", () => {
    setAuth(TOKEN, ENTITY_ID, "Olive & Vine; Ltd, 100% 橄欖");
    expect(getAuth()?.entityName).toBe("Olive & Vine; Ltd, 100% 橄欖");
  });

  it("split a cookie on its FIRST '=' so a value containing one survives", () => {
    // Not academic: a padded base64 value ends in "=", and splitting on every "=" would hand
    // back a truncated token that fails every call with no hint why.
    document.cookie = `${AUTH_COOKIE_NAME}=a.b.c==;path=/`;
    expect(getAuth()?.token).toBe("a.b.c==");
  });

  it("report no session at all when the token cookie is absent", () => {
    document.cookie = `${ENTITY_ID_COOKIE_NAME}=${ENTITY_ID};path=/`;
    expect(getAuth()).toBeNull();
  });

  it("report empty strings for a token with no company cookies beside it", () => {
    document.cookie = `${AUTH_COOKIE_NAME}=${TOKEN};path=/`;
    expect(getAuth()).toEqual({ token: TOKEN, entityId: "", entityName: "" });
  });

  it("write the session for exactly as long as the token lives, same-site, and NOT Secure over http", () => {
    // The 30-minute hand-off token (Phase 9: no 8-hour refresh) - middleware.ts then sees no
    // cookie once it has run out and hands the person over again on the same page.
    const cookies = recordCookieWrites();
    try {
      setAuth(tokenExpiringIn(1800), ENTITY_ID, ENTITY_NAME);
      expect(cookies.writes).toHaveLength(3);
      for (const write of cookies.writes) {
        expect(write).toMatch(/;path=\/;max-age=(1799|1800);SameSite=Lax/);
        // jsdom serves the test from http, as the local dev server does.
        expect(write).not.toContain(";Secure");
      }
      expect(cookies.writes[0]).toContain(`${AUTH_COOKIE_NAME}=`);
      expect(cookies.writes[1]).toContain(`${ENTITY_ID_COOKIE_NAME}=`);
      expect(cookies.writes[2]).toContain(`${ENTITY_NAME_COOKIE_NAME}=`);
    } finally {
      cookies.restore();
    }
  });

  it("writes the hand-off token's 30 minutes when the token's exp cannot be read", () => {
    const cookies = recordCookieWrites();
    try {
      setAuth(tokenWithout("exp"), ENTITY_ID, ENTITY_NAME);
      expect(cookies.writes[0]).toContain(`max-age=${60 * 30}`);
    } finally {
      cookies.restore();
    }
  });
});

describe("clearAuth", () => {
  it("expires all three cookies", () => {
    setAuth(TOKEN, ENTITY_ID, ENTITY_NAME);
    clearAuth();
    expect(getAuth()).toBeNull();
    expect(document.cookie).not.toContain(ENTITY_ID_COOKIE_NAME);
  });

  it("expires them with max-age=0, so the browser drops them now", () => {
    const cookies = recordCookieWrites();
    try {
      clearAuth();
      expect(cookies.writes).toHaveLength(3);
      for (const write of cookies.writes) expect(write).toContain("path=/;max-age=0");
    } finally {
      cookies.restore();
    }
  });
});

describe("decodeJwtPayload", () => {
  it("reads the claims out of a well-formed token", () => {
    const claims = moduleTokenClaims({ role: "shop_manager" });
    expect(decodeJwtPayload(unsignedToken(claims))).toMatchObject({
      role: "shop_manager",
      entity_id: claims.entity_id,
      billing_enabled: true,
    });
  });

  it("reads base64url at every padding length", () => {
    for (const pad of ["a", "ab", "abc", "abcd"]) {
      const payload = decodeJwtPayload(unsignedToken({ pad }));
      expect(payload?.pad).toBe(pad);
    }
  });

  it("reads the base64url alphabet, not plain base64", () => {
    // `-` and `_` stand in for `+` and `/`; a decoder that did not swap them back would throw.
    const claims = moduleTokenClaims({ note: "???>>>" });
    expect(decodeJwtPayload(unsignedToken(claims))?.note).toBe("???>>>");
  });

  it.each([
    ["a two-part token", "header.payload"],
    ["a four-part token", "a.b.c.d"],
    ["an empty string", ""],
    ["nonsense", "not-a-token"],
    ["an unparseable payload", "aaa.$$$$.ccc"],
  ])("is null for %s, and never throws", (_label, token) => {
    expect(decodeJwtPayload(token)).toBeNull();
  });

  it("is null for a payload that is not a JSON object", () => {
    const b64 = (text: string) =>
      btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeJwtPayload(`h.${b64("[1,2,3]")}.s`)).toBeNull();
    expect(decodeJwtPayload(`h.${b64('"a string"')}.s`)).toBeNull();
    expect(decodeJwtPayload(`h.${b64("42")}.s`)).toBeNull();
    expect(decodeJwtPayload(`h.${b64("null")}.s`)).toBeNull();
  });
});

describe("getRoleFromToken", () => {
  it("is the role claim", () => {
    setAuth(unsignedToken(moduleTokenClaims({ role: "accountant" })), ENTITY_ID, ENTITY_NAME);
    expect(getRoleFromToken()).toBe("accountant");
  });

  it("is null with no token, a malformed one, or an empty role", () => {
    expect(getRoleFromToken()).toBeNull();
    setAuth("nonsense", ENTITY_ID, ENTITY_NAME);
    expect(getRoleFromToken()).toBeNull();
    setAuth(unsignedToken(moduleTokenClaims({ role: "" })), ENTITY_ID, ENTITY_NAME);
    expect(getRoleFromToken()).toBeNull();
  });

  it("is null for a role that is not a string", () => {
    setAuth(unsignedToken(moduleTokenClaims({ role: 7 })), ENTITY_ID, ENTITY_NAME);
    expect(getRoleFromToken()).toBeNull();
  });
});

describe("getLoginSidFromToken", () => {
  it("is the sid claim - how this app tells one sign-in from the next", () => {
    setAuth(unsignedToken(moduleTokenClaims({ sid: "sess-42" })), ENTITY_ID, ENTITY_NAME);
    expect(getLoginSidFromToken()).toBe("sess-42");
  });

  it("treats an EMPTY sid as absent - a token minted outside a request carries one", () => {
    setAuth(unsignedToken(moduleTokenClaims({ sid: "" })), ENTITY_ID, ENTITY_NAME);
    expect(getLoginSidFromToken()).toBeNull();
  });

  it("is null with no token and for a token without the claim", () => {
    expect(getLoginSidFromToken()).toBeNull();
    setAuth(tokenWithout("sid"), ENTITY_ID, ENTITY_NAME);
    expect(getLoginSidFromToken()).toBeNull();
  });
});

describe("isTokenFresh", () => {
  // A 401 on a token Minty has just handed over cannot be cured by handing over again (the
  // person lacks access), so it is reported rather than looped on; an older one may mean the
  // Minty sign-in behind it has ended (Phase 9), so the person is handed over once more.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const mintedAgo = (seconds: number) =>
    unsignedToken(moduleTokenClaims({ iat: Math.floor(Date.now() / 1000) - seconds }));

  it("is true for the first minute after the hand-off, then false", () => {
    setAuth(mintedAgo(59), ENTITY_ID, ENTITY_NAME);
    expect(isTokenFresh()).toBe(true);
    setAuth(mintedAgo(61), ENTITY_ID, ENTITY_NAME);
    expect(isTokenFresh()).toBe(false);
  });

  it("is false with no token, a malformed one, or no iat claim", () => {
    clearAuth();
    expect(isTokenFresh()).toBe(false);
    setAuth("nonsense", ENTITY_ID, ENTITY_NAME);
    expect(isTokenFresh()).toBe(false);
    setAuth(tokenWithout("iat"), ENTITY_ID, ENTITY_NAME);
    expect(isTokenFresh()).toBe(false);
  });
});

describe("isTokenExpired", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows five seconds of clock skew either side of the boundary", () => {
    setAuth(tokenExpiringIn(-4), ENTITY_ID, ENTITY_NAME);
    expect(isTokenExpired()).toBe(false);
    setAuth(tokenExpiringIn(-6), ENTITY_ID, ENTITY_NAME);
    expect(isTokenExpired()).toBe(true);
  });

  it("is false for a token that is merely expiring soon", () => {
    setAuth(tokenExpiringIn(30), ENTITY_ID, ENTITY_NAME);
    expect(isTokenExpired()).toBe(false);
  });

  it("is false with no token, a malformed one, or no exp claim", () => {
    expect(isTokenExpired()).toBe(false);
    setAuth("nonsense", ENTITY_ID, ENTITY_NAME);
    expect(isTokenExpired()).toBe(false);
    setAuth(tokenWithout("exp"), ENTITY_ID, ENTITY_NAME);
    expect(isTokenExpired()).toBe(false);
  });
});
