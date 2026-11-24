import { getAuth, redirectToLogin } from "@/lib/auth";
import { API_BASE } from "@/lib/apiBase";

/**
 * Fetch a file through one of the API's `/preview/` proxy paths, with the JWT, and hand back a
 * `blob:` URL - or null on any failure. Bytes that come back with no usable type are typed
 * `fallbackType`, so the renderer accepts them. Used by the PDF preview (pdf.js, which must not
 * load a cross-origin B2 URL) and by an iPhone HEIC's `?as=jpeg`, the JPEG the API makes on the
 * fly for a browser that can't draw HEIC (the user, 2026-11-24).
 */
export async function fetchProxyBlob(
  apiPath: string,
  fallbackType: string,
): Promise<string | null> {
  try {
    const auth = getAuth();
    if (!auth?.token) {
      redirectToLogin();
      return null;
    }
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${auth.token}`);
    headers.set("X-Entity-Id", auth.entityId);
    const url = `${API_BASE.replace(/\/$/, "")}${apiPath}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    const typed =
      blob.type && blob.type !== "application/octet-stream"
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: fallbackType });
    return URL.createObjectURL(typed);
  } catch {
    return null;
  }
}
