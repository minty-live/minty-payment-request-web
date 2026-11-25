/**
 * The file preview, through `@minty/shared/filePreview` (v0.37): every screen imports it from
 * here, so this app's icon font and its authenticated fetch are registered before anything draws.
 */
import { registerFilePreviewHost } from "@minty/shared/filePreview";

import { fetchProxyBlob } from "@/lib/previewProxy";

registerFilePreviewHost({ iconClass: "material-symbols-outlined", fetchBlob: fetchProxyBlob });

export * from "@minty/shared/filePreview";
