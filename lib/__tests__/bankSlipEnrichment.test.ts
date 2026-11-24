// A bill's bank slips for the details dialog (lib/bankSlipEnrichment.ts): which slips are drawn
// straight from their presigned URL and which go through the fetched preview.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  listPaymentAttachments: vi.fn(),
}));

import { listPaymentAttachments, type PaymentItem } from "@/lib/api";
import { buildBankSlipDetailsFromPaymentList } from "@/lib/bankSlipEnrichment";

const ROW = {
  contactTitle: "Vendor",
  submittedDate: "",
  invoiceDate: "",
  paidDate: "",
  unpaidAmount: "",
  currencyCode: "HKD",
};

const slip = (id: string, original_name: string, mime_type: string) => ({
  id,
  attachment: {
    id: `att-${id}`,
    original_name,
    mime_type,
    download_url: `https://b2.example/${id}`,
  },
});

describe("buildBankSlipDetailsFromPaymentList", () => {
  it("draws a JPEG from its presigned URL, but sends an iPhone HEIC through the fetched preview", async () => {
    vi.mocked(listPaymentAttachments).mockResolvedValue([
      slip("s1", "slip.jpg", "image/jpeg"),
      slip("s2", "IMG_1.HEIC", "image/heic"),
    ] as never);
    const payments = [{ id: "p1", bill_id: "b1", amount: "1.00" }] as unknown as PaymentItem[];

    const { bankSlipDetails } = await buildBankSlipDetailsFromPaymentList("b1", payments, ROW);

    const [jpeg, heic] = bankSlipDetails!.files;
    expect(jpeg.previewUrl).toBe("https://b2.example/s1");
    // the fetched preview knows the proxy path, so a browser that can't draw HEIC gets a JPEG
    expect(heic.previewUrl).toBeUndefined();
    expect(heic.fetchSource).toEqual({
      billId: "b1",
      paymentId: "p1",
      attachmentId: "s2",
      fileAttachmentId: "att-s2",
    });
  });
});
