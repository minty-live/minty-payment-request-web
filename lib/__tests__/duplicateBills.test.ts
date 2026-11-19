// The duplicate reminder (owner's decisions doc DUP1, 2026-11-19): reading the API's 409.

import { describe, expect, it } from "vitest";

import { ApiError, duplicateBillsOf } from "@/lib/api";

const SENTENCE =
  "This looks like a bill you already have: the same date, supplier and amount. Save it anyway?";
const MATCH = {
  id: "b-2",
  reference: "PR-0002",
  contact: "ABC Furniture",
  amount: "6000.00",
  invoice_date: "2026-03-03",
};

describe("duplicateBillsOf", () => {
  it("reads the sentence and the matching bills", () => {
    const err = new ApiError(409, SENTENCE, SENTENCE, { detail: SENTENCE, duplicates: [MATCH] });
    expect(duplicateBillsOf(err)).toEqual({ sentence: SENTENCE, duplicates: [MATCH] });
  });

  it("is null for another 409, another status, an empty list or no body", () => {
    expect(duplicateBillsOf(new ApiError(409, "x", "x", { detail: "x" }))).toBeNull();
    expect(
      duplicateBillsOf(new ApiError(422, "x", "x", { detail: "x", duplicates: [MATCH] })),
    ).toBeNull();
    expect(
      duplicateBillsOf(new ApiError(409, "x", "x", { detail: "x", duplicates: [] })),
    ).toBeNull();
    expect(duplicateBillsOf(new ApiError(409, "x"))).toBeNull();
    expect(duplicateBillsOf(new TypeError("Failed to fetch"))).toBeNull();
  });
});
