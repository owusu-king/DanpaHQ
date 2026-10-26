/**
 * Browser implementation of the mobile secure-storage boundary.
 *
 * Expo SecureStore intentionally has no web implementation. The Expo web
 * preview therefore uses tab-scoped storage: it survives a refresh, is not
 * shared with another tab, and disappears when the browser session ends.
 * Native iOS and Android continue to resolve `secure.ts` and use the platform
 * Keychain/Keystore.
 */

const PREFIX = "danpahq.mobile.";
const fallback = new Map<string, string>();

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // Privacy settings can make Storage exist while denying access to it.
    return null;
  }
}

function namespaced(key: string) {
  return `${PREFIX}${key}`;
}

export const secure = {
  async get(key: string): Promise<string | null> {
    const storage = sessionStore();
    if (storage) {
      try {
        return storage.getItem(namespaced(key));
      } catch {
        // Keep the preview usable when browser storage is blocked.
      }
    }
    return fallback.get(key) ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    const storage = sessionStore();
    if (storage) {
      try {
        storage.setItem(namespaced(key), value);
        fallback.delete(key);
        return;
      } catch {
        // The in-memory fallback lasts for this page session only.
      }
    }
    fallback.set(key, value);
  },

  async clear(key: string): Promise<void> {
    const storage = sessionStore();
    if (storage) {
      try {
        storage.removeItem(namespaced(key));
      } catch {
        // Clearing the fallback below still removes the usable copy.
      }
    }
    fallback.delete(key);
  },
};
