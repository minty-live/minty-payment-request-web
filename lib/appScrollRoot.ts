/**
 * The page's scroll lock is `@minty/shared/scrollLock`'s - one reference count for this app's
 * overlays and the packaged ones (the file preview's full-screen viewer, the sidebar drawer). Two
 * counters on the same element would let a stacked overlay restore the other's saved overflow.
 */
export { APP_SCROLL_ROOT_ID, getAppScrollRoot, pushAppScrollLock } from "@minty/shared/scrollLock";
