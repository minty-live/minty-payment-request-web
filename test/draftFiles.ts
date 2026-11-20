// The files an auto-saved draft keeps (`@minty/shared/drafts`), in memory for the unit tests.
//
// In a browser they go to IndexedDB, which jsdom does not have (and setup.dom.ts deliberately
// does not stub). The package lets a test swap its file store; ./setup.dom.ts puts this one in
// before every test and empties it, so a test can look at what a draft kept. The real store's
// round trip is e2e/18_auto_save_drafts.spec.ts's.

type Store = {
  data: Map<string, File[]>;
  put(key: string, files: readonly File[]): Promise<void>;
  get(key: string): Promise<File[]>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

const data = new Map<string, File[]>();

export const draftFiles: Store = {
  data,
  async put(key, files) {
    data.set(key, [...files]);
  },
  async get(key) {
    return [...(data.get(key) ?? [])];
  },
  async remove(key) {
    data.delete(key);
  },
  async keys() {
    return [...data.keys()];
  },
};

/** The drafts kept in localStorage right now, parsed - what a test asserts on. */
export function keptDrafts(): { key: string; value: Record<string, unknown> }[] {
  const out: { key: string; value: Record<string, unknown> }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("minty:draft:")) continue;
    out.push({ key, value: JSON.parse(localStorage.getItem(key) ?? "null") });
  }
  return out;
}
