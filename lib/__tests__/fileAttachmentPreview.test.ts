// Which files an attachment field takes, and how its size reads
// (lib/fileAttachmentPreview.tsx). ATTACHMENT_ACCEPT is pinned verbatim because it is the
// `<input accept>` string the picker shows.

import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MIME_TYPES,
  formatFileSize,
  isAllowedAttachment,
  isAllowedFileType,
  isHtmlFile,
  isImageFile,
  isPdfFile,
} from "@/lib/fileAttachmentPreview";

const file = (name: string, type = "") => new File(["x"], name, { type });

describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1.0 MB"],
    [10 * 1024 * 1024, "10.0 MB"],
    [1024 * 1024 * 1024, "1.0 GB"],
  ])("shows %i bytes as %s", (bytes, shown) => {
    expect(formatFileSize(bytes)).toBe(shown);
  });

  it("shows an em dash rather than a number it cannot stand behind", () => {
    expect(formatFileSize(-1)).toBe("—");
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("isImageFile", () => {
  it("goes by the MIME type when the browser gives one", () => {
    expect(isImageFile(file("photo.bin", "image/png"))).toBe(true);
  });

  it("falls back to the extension when it does not", () => {
    expect(isImageFile(file("photo.JPG"))).toBe(true);
    expect(isImageFile(file("photo.jpeg"))).toBe(true);
    expect(isImageFile(file("photo.png"))).toBe(true);
    expect(isImageFile(file("photo.heic"))).toBe(true);
    expect(isImageFile(file("photo.webp"))).toBe(true);
    expect(isImageFile(file("photo.gif"))).toBe(true);
  });

  it("is false for anything else", () => {
    expect(isImageFile(file("invoice.pdf"))).toBe(false);
    expect(isImageFile(file("noextension"))).toBe(false);
  });
});

describe("isPdfFile", () => {
  it("goes by MIME, then by extension, ignoring case and padding", () => {
    expect(isPdfFile(file("invoice.bin", "application/pdf"))).toBe(true);
    expect(isPdfFile(file("invoice.PDF"))).toBe(true);
    expect(isPdfFile(file("  invoice.pdf  "))).toBe(true);
  });

  it("is false for anything else", () => {
    expect(isPdfFile(file("photo.png"))).toBe(false);
  });
});

describe("isHtmlFile", () => {
  it("takes both spellings of the extension", () => {
    expect(isHtmlFile(file("page.html"))).toBe(true);
    expect(isHtmlFile(file("page.htm"))).toBe(true);
    expect(isHtmlFile(file("page.bin", "text/html"))).toBe(true);
  });

  it("is false for anything else", () => {
    expect(isHtmlFile(file("invoice.pdf"))).toBe(false);
  });
});

describe("the attachment allowlist", () => {
  it("is PDF, JPEG, PNG, HEIC and HTML", () => {
    expect([...ATTACHMENT_EXTENSIONS]).toEqual([
      "pdf",
      "jpg",
      "jpeg",
      "png",
      "heic",
      "heif",
      "html",
      "htm",
    ]);
    expect([...ATTACHMENT_MIME_TYPES]).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/heic",
      "image/heif",
      "text/html",
    ]);
  });

  // JPEG first: iOS hands a HEIC photo over as the first type it can, so most iPhone photos
  // arrive as JPEG; HEIC is still taken as it is (the user, 2026-11-24). Mixed with PDF, the
  // list also makes Android offer its camera beside its files.
  it("is offered to the file picker exactly as the input needs it", () => {
    expect(ATTACHMENT_ACCEPT).toBe(
      "image/jpeg,image/png,application/pdf,image/heic,image/heif,text/html,.jpg,.jpeg,.png,.pdf,.heic,.heif,.html,.htm",
    );
  });

  it("takes an iPhone HEIC by its type", () => {
    expect(isAllowedAttachment(file("IMG_1.HEIC", "image/heic"))).toBe(true);
    expect(isAllowedAttachment(file("IMG_1.heif", "image/heif"))).toBe(true);
  });

  it.each([
    "invoice.pdf",
    "photo.jpg",
    "photo.jpeg",
    "photo.png",
    "IMG_1.HEIC",
    "page.html",
    "page.htm",
  ])("accepts %s when the browser reports no type", (name) => {
    expect(isAllowedAttachment(file(name))).toBe(true);
  });

  it.each(["payload.exe", "logo.svg", "bundle.zip", "sheet.xlsx", "noextension"])(
    "refuses %s",
    (name) => {
      expect(isAllowedAttachment(file(name))).toBe(false);
    },
  );
});

describe("isAllowedFileType", () => {
  // CHARACTERISATION: when the browser reports a type, ONLY that is checked - the extension is
  // not consulted at all. So a file named .exe that claims application/pdf passes here. The API
  // re-checks the upload, which is what makes this safe; it is not a client-side guarantee.
  // application/octet-stream says nothing (some Android pickers give it for a HEIC photo), so
  // the extension decides, as the API's own check does (2026-11-24; it used to be refused).
  it("trusts the reported MIME over the extension, unless it is octet-stream", () => {
    expect(isAllowedAttachment(file("payload.exe", "application/pdf"))).toBe(true);
    expect(isAllowedAttachment(file("invoice.pdf", "application/octet-stream"))).toBe(true);
    expect(isAllowedAttachment(file("IMG_1.HEIC", "application/octet-stream"))).toBe(true);
    expect(isAllowedAttachment(file("payload.exe", "application/octet-stream"))).toBe(false);
  });

  it("takes its allowlists as arguments, so another field can have its own", () => {
    expect(isAllowedFileType(file("notes.txt", "text/plain"), ["txt"], ["text/plain"])).toBe(true);
    expect(isAllowedFileType(file("notes.txt", "text/plain"), ["txt"], ["text/csv"])).toBe(false);
    expect(isAllowedFileType(file("notes.txt"), ["txt"], ["text/csv"])).toBe(true);
  });
});
