// Every call this app makes to the Django API goes through one wrapper (lib/api.ts's
// `apiFetch`). It is private, so it is exercised through the thin public functions that use it
// - which is also the path the app itself takes.
//
// The two 401 branches are the most valuable cases in the file. Treating any 401 as an expired
// session sent the person back through the handoff, which re-minted the SAME token and landed
// them on the same screen failing the same way: an endless loop, reported as "our session
// timed out". Only a genuinely expired token is fixed by signing in again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bill, billListItem } from "@/lib/__fixtures__/bills";
import { tokenExpiringIn, unsignedToken } from "@/lib/__fixtures__/tokens";
import {
  ApiError,
  archivedContactsOf,
  createBill,
  deleteBillAttachment,
  fetchBills,
  fetchEntityCurrency,
  publishBill,
  uploadBillAttachments,
  uploadPaymentAttachment,
} from "@/lib/api";
import { getAuth, setAuth } from "@/lib/auth";
import { env } from "@/lib/env";

const TOKEN = unsignedToken();
const ENTITY_ID = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const ENTITY_NAME = "Olive & Vine";
const V1 = `${env.PAYMENT_REQUEST_API_URL}/api/v1`;

const fetchMock = vi.fn<typeof fetch>();

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fresh copy of the module graph, for the tests that trip the once-only redirect. */
async function freshApi() {
  vi.resetModules();
  return {
    api: await import("@/lib/api"),
    auth: await import("@/lib/auth"),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  setAuth(TOKEN, ENTITY_ID, ENTITY_NAME);
});

afterEach(() => {
  // clearMocks/restoreMocks do not undo stubGlobal.
  vi.unstubAllGlobals();
});

describe("the request", () => {
  it("goes to the API's /api/v1 with the bearer and the company", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { currency_code: "HKD" }));

    // decimal_places missing: amounts keep 2 places.
    await expect(fetchEntityCurrency()).resolves.toEqual({ currency_code: "HKD", decimals: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${V1}/auth/entity-currency`);
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("X-Entity-Id")).toBe(ENTITY_ID);
  });

  it("reads the currency's decimal places (JPY 0)", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { currency_code: "JPY", decimal_places: 0 }));

    await expect(fetchEntityCurrency()).resolves.toEqual({ currency_code: "JPY", decimals: 0 });
  });

  it("sends JSON with its content type", async () => {
    fetchMock.mockResolvedValueOnce(answer(201, bill()));

    await createBill({ contact: "Young Bros Transport", amount: "6000.00" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({
      contact: "Young Bros Transport",
      amount: "6000.00",
    });
  });

  it("does NOT set a content type for a FormData body - the browser must set the boundary", async () => {
    fetchMock.mockResolvedValueOnce(answer(201, []));

    await uploadBillAttachments("bill-1", [
      new File(["%PDF-1.4"], "invoice.pdf", { type: "application/pdf" }),
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${V1}/bills/bill-1/attachments`);
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("sends an image exactly as chosen - no shrinking, no conversion (owner, 2026-11-04)", async () => {
    const png = new File(["\x89PNG-receipt"], "receipt.png", { type: "image/png" });
    const slip = new File(["\xff\xd8\xff-slip"], "slip.jpg", { type: "image/jpeg" });
    fetchMock.mockResolvedValueOnce(answer(201, [])).mockResolvedValueOnce(answer(201, {}));

    await uploadBillAttachments("bill-1", [png]);
    await uploadPaymentAttachment("bill-1", "pay-1", slip);

    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("files")).toBe(png);
    expect((fetchMock.mock.calls[1][1]?.body as FormData).get("file")).toBe(slip);
  });

  it("builds the list query from the parameters it was given, and omits the rest", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, [billListItem()]));

    await fetchBills({ status: "submitted", page: 2, amount_min: 0, search: "Young Bros" });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v1/bills/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "submitted",
      page: "2",
      amount_min: "0",
      search: "Young Bros",
    });
  });

  it("asks for the plain list when given no parameters", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, []));
    await fetchBills();
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${V1}/bills/`);
  });
});

describe("the answer", () => {
  it("is the parsed body", async () => {
    const row = billListItem({ id: "bill-1" });
    fetchMock.mockResolvedValueOnce(answer(200, [row]));
    await expect(fetchBills()).resolves.toEqual([row]);
  });

  it("is undefined for a 204, which has no body to parse", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteBillAttachment("bill-1", "att-1")).resolves.toBeUndefined();
  });
});

describe("a failure", () => {
  it("reads as friendly copy while keeping the server's own words in detail", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Internal Server Error" }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const err = await fetchBills().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe("Something went wrong on my end. Mind trying again?");
    expect((err as ApiError).detail).toBe("Internal Server Error");
  });

  // CHARACTERISATION, and a real hole in the guard above.
  //
  // `isRawStatusText` recognises a bare reason phrase only by comparing it to `res.statusText`.
  // HTTP/2 carries no reason phrase at all, so `res.statusText` is ALWAYS "" there - and
  // production is HTTP/2 (Render, Vercel). A server that puts a reason phrase in its JSON
  // `detail` therefore has it shown verbatim, which is the exact leak docs/ERROR_COPY.md
  // records as fixed. It only holds today because the API sends real sentences.
  //
  // Pinned, not fixed: the fix is a change to what users see, which is a separate decision.
  it("shows a bare reason phrase from the body when statusText is empty, as it is over HTTP/2", async () => {
    fetchMock.mockResolvedValueOnce(answer(500, { detail: "Internal Server Error" }));

    const err = (await fetchBills().catch((e: unknown) => e)) as ApiError;

    expect(err.message).toBe("Internal Server Error");
    expect(err.message).not.toBe("Something went wrong on my end. Mind trying again?");
  });

  it("falls back to the reason phrase when the body is not JSON at all", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>502</html>", { status: 502, statusText: "Bad Gateway" }),
    );

    const err = (await fetchBills().catch((e: unknown) => e)) as ApiError;

    expect(err.message).toBe("I couldn't reach the server just now. Mind trying again?");
    expect(err.message).not.toBe("Bad Gateway");
  });

  it("shows a 422's own sentence, which callers surface inline", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(422, { detail: "That invoice number already exists in this company." }),
    );

    const err = (await createBill({}).catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(422);
    expect(err.message).toBe("That invoice number already exists in this company.");
  });

  it("does not wrap a dropped connection - a network failure is still a TypeError", async () => {
    // docs/ERROR_COPY.md says so outright: catch sites must narrow to ApiError, because this
    // one arrives as "Failed to fetch".
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const err = await fetchBills().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(ApiError);
  });
});

describe("a 401", () => {
  it("with a LIVE token is reported and the session is left alone - no handoff loop", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { detail: "not_a_member" }));

    const err = (await fetchBills().catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(401);
    expect(err.message).toBe(
      "You don't have access to that. If you've just been added to a company, try picking it again from the company list.",
    );
    // The cookies are still there: nothing was signed out, and the page stays where it is.
    expect(getAuth()?.token).toBe(TOKEN);
  });

  it("with a live token shows the server's sentence when it has one", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(401, { detail: "You are not a member of that company any more." }),
    );

    const err = (await fetchBills().catch((e: unknown) => e)) as ApiError;

    expect(err.message).toBe("You are not a member of that company any more.");
    expect(getAuth()?.token).toBe(TOKEN);
  });

  it("with a live token keeps a machine-shaped refusal out of the message but in the detail", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { detail: "entity_membership_revoked" }));

    const err = (await fetchBills().catch((e: unknown) => e)) as ApiError;

    expect(err.message).toContain("You don't have access to that.");
    expect(err.detail).toBe("entity_membership_revoked");
  });

  it("on a token handed over more than a minute ago hands the person over again, on the same page", async () => {
    // The Minty sign-in behind it may have ended - signed out, or 60 minutes without activity
    // (Phase 9) - and every API then answers 401 to a token that has not expired. One more
    // hand-off settles it: a fresh token while the sign-in lives, the sign-in page when not.
    const { api, auth } = await freshApi();
    const visited: string[] = [];
    auth._resetRedirectForTests((url) => visited.push(url));
    window.history.replaceState(null, "", "/entity/360812e1/olive-vine/payment-request");
    const now = Math.floor(Date.now() / 1000);
    auth.setAuth(tokenExpiringIn(1500, { iat: now - 300 }), ENTITY_ID, ENTITY_NAME);
    fetchMock.mockResolvedValueOnce(answer(401, { detail: "Unauthorized" }));

    const err = (await api.fetchBills().catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(401);
    expect(auth.getAuth()).toBeNull();
    expect(visited).toEqual(["/entity/360812e1/olive-vine/payment-request"]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh call
    window.history.replaceState(null, "", "/");
  });

  it("with an EXPIRED token signs the person out and says the session expired", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { api, auth } = await freshApi();
      auth.setAuth(tokenExpiringIn(-60), ENTITY_ID, ENTITY_NAME);
      fetchMock.mockResolvedValueOnce(answer(401, { detail: "token expired" }));

      const err = (await api.fetchBills().catch((e: unknown) => e)) as ApiError;

      expect(err.status).toBe(401);
      expect(err.message).toBe("Your session expired. Taking you back to sign in.");
      expect(auth.getAuth()).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("the session before the request", () => {
  it("never refreshes: a token about to run out is sent as it is (Phase 9)", async () => {
    const soon = tokenExpiringIn(60);
    setAuth(soon, ENTITY_ID, ENTITY_NAME);
    fetchMock.mockResolvedValueOnce(answer(200, []));

    await fetchBills();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${V1}/bills/`);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe(
      `Bearer ${soon}`,
    );
  });

  it("refuses to call at all with no session, and asks nothing of the network", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { api, auth } = await freshApi();
      auth.clearAuth();

      const err = (await api.fetchBills().catch((e: unknown) => e)) as ApiError;

      expect(err.status).toBe(401);
      expect(err.message).toBe("You're signed out. Taking you back to sign in.");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("a publish refused over contacts archived in Xero (C4, 2026-11-19)", () => {
  it("keeps the whole answer on the error, so the archived contacts can be read", async () => {
    const body = {
      detail: "Kee Wah is archived in Xero. Restore it in Xero, or map it to another contact now.",
      archived_contacts: [{ id: "mc-1", name: "Kee Wah" }],
    };
    fetchMock.mockResolvedValueOnce(answer(409, body));

    const err = await publishBill("b-1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(body.detail);
    expect(archivedContactsOf(err)).toEqual([{ id: "mc-1", name: "Kee Wah" }]);
  });

  it("finds none in any other refusal", async () => {
    fetchMock.mockResolvedValueOnce(answer(409, { detail: "Someone else changed that first." }));
    const err = await publishBill("b-1").catch((e: unknown) => e);
    expect(archivedContactsOf(err)).toBeNull();
    expect(archivedContactsOf(new ApiError(422, "x", "x", { archived_contacts: [] }))).toBeNull();
    expect(archivedContactsOf(new Error("x"))).toBeNull();
  });
});
