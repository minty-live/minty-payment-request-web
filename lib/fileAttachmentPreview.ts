export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.trim().split(".").pop()?.toLowerCase() ?? "";
  return (
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "png" ||
    ext === "heic" ||
    ext === "heif" ||
    ext === "webp" ||
    ext === "gif"
  );
}

export function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.trim().toLowerCase().endsWith(".pdf");
}

export function isHtmlFile(file: File): boolean {
  if (file.type === "text/html") return true;
  const ext = file.name.trim().split(".").pop()?.toLowerCase() ?? "";
  return ext === "html" || ext === "htm";
}

/**
 * Returns true when `file` matches an allowlist. Mirrors Minty's upload rule:
 * validate by MIME type when the browser provides one, falling back to the file
 * extension (drag-drop / some browsers report an empty `type`, and some Android
 * pickers `application/octet-stream`, which says nothing either).
 */
export function isAllowedFileType(
  file: File,
  allowedExtensions: readonly string[],
  allowedMimeTypes: readonly string[],
): boolean {
  const type = file.type.trim().toLowerCase();
  if (type && type !== "application/octet-stream") return allowedMimeTypes.includes(type);
  const ext = file.name.trim().split(".").pop()?.toLowerCase() ?? "";
  return allowedExtensions.includes(ext);
}

/**
 * Invoice / bank-slip attachments: PDF, JPEG, PNG, HEIC, HTML. An iPhone HEIC is stored as it is
 * and made JPEG on the fly where it can't be used (the user, 2026-11-24).
 */
export const ATTACHMENT_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "heic",
  "heif",
  "html",
  "htm",
] as const;
export const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "text/html",
] as const;
/**
 * `accept` for the attachment inputs. JPEG first: iOS hands a HEIC photo over as the first type
 * it can, so most iPhone photos (and every camera shot) arrive as JPEG. Mixed with PDF, it also
 * makes Android offer its camera beside its files. No `capture`: that would skip Files and PDFs.
 */
export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,application/pdf,image/heic,image/heif,text/html,.jpg,.jpeg,.png,.pdf,.heic,.heif,.html,.htm";

export function isAllowedAttachment(file: File): boolean {
  return isAllowedFileType(file, ATTACHMENT_EXTENSIONS, ATTACHMENT_MIME_TYPES);
}
