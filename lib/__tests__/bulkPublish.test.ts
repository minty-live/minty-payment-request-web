import { describe, expect, it } from "vitest";

import { ApiError, XERO_RECONNECT_MESSAGE } from "@/lib/api";
import { failedSummary, publishEach } from "@/lib/bulkPublish";

const archived = (...contacts: { id: string; name: string }[]) =>
  new ApiError(409, "Kee Wah is archived in Xero.", undefined, {
    detail: "Kee Wah is archived in Xero.",
    archived_contacts: contacts,
  });

describe("publishEach", () => {
  it("waits for every bill and sorts the answers", async () => {
    const answers: Record<string, () => Promise<unknown>> = {
      a: async () => ({}),
      b: async () => {
        throw archived({ id: "c-kee", name: "Kee Wah" });
      },
      c: async () => {
        throw new ApiError(422, "This payment request has no line items yet.");
      },
      d: async () => ({}),
    };

    const result = await publishEach(["a", "b", "c", "d"], (id) => answers[id]());

    expect(result.published).toEqual(["a", "d"]);
    expect(result.archived).toEqual({
      contacts: [{ id: "c-kee", name: "Kee Wah" }],
      billIds: ["b"],
    });
    expect(result.failed).toEqual([
      { id: "c", message: "This payment request has no line items yet." },
    ]);
  });

  it("lists a contact once however many bills share it", async () => {
    const result = await publishEach(["a", "b"], async (id) => {
      throw id === "a"
        ? archived({ id: "c-kee", name: "Kee Wah" })
        : archived({ id: "c-kee", name: "Kee Wah" }, { id: "c-sam", name: "Sam's Fish" });
    });

    expect(result.archived.contacts.map((c) => c.name)).toEqual(["Kee Wah", "Sam's Fish"]);
    expect(result.archived.billIds).toEqual(["a", "b"]);
  });

  it("says the reconnect sentence for a Xero sign-in problem, and its own for a network one", async () => {
    const result = await publishEach(["a", "b"], async (id) => {
      throw id === "a"
        ? new ApiError(502, "Xero said no.", '{"Type":"AuthenticationUnsuccessful"}')
        : new TypeError("Failed to fetch");
    });

    expect(result.failed).toEqual([
      { id: "a", message: XERO_RECONNECT_MESSAGE },
      { id: "b", message: "This payment didn't quite make it over to Xero. Mind trying again?" },
    ]);
  });
});

describe("failedSummary", () => {
  it("is nothing when nothing else failed", () => {
    expect(failedSummary([])).toBeNull();
  });

  it("counts the refusals and says each reason once", () => {
    expect(
      failedSummary([
        { id: "a", message: "Xero is busy. Try again in a minute." },
        { id: "b", message: "Xero is busy. Try again in a minute." },
      ]),
    ).toBe("2 payment requests weren't published. Xero is busy. Try again in a minute.");
    expect(failedSummary([{ id: "a", message: "No account code." }])).toBe(
      "1 payment request wasn't published. No account code.",
    );
  });
});
