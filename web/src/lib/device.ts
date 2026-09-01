/**
 * Stable, non-secret identity for this browser installation.
 *
 * This is deliberately not a browser fingerprint. It is a random id created by
 * Rooomly and kept in this browser profile, just like the native app keeps its
 * installation id in secure storage. It may identify a device session; it can
 * neither authenticate the user nor reveal the refresh token.
 */

export type WebDeviceContext = {
  device_fingerprint: string;
  platform: "web";
  device_label: string;
};

const DEVICE_KEY = "rooomly.device_fingerprint";
let memoryFingerprint = "";

function newFingerprint(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Exported as a pure seam so persistence has regression coverage. */
export function persistentDeviceFingerprint(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  create: () => string = newFingerprint,
): string {
  if (!storage) {
    if (!memoryFingerprint) memoryFingerprint = create().slice(0, 128);
    return memoryFingerprint;
  }
  try {
    const stored = storage.getItem(DEVICE_KEY)?.trim();
    if (stored && stored.length <= 128) return stored;

    const created = create().slice(0, 128);
    storage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    // Storage can be disabled. Keep one installation id for the lifetime of
    // this page rather than manufacturing a different device for every call.
    if (!memoryFingerprint) memoryFingerprint = create().slice(0, 128);
    return memoryFingerprint;
  }
}

export function describeBrowser(userAgent: string): string {
  const ua = userAgent || "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /(?:Chrome|CriOS)\//.test(ua)
      ? "Chrome"
      : /(?:Firefox|FxiOS)\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua) && /Version\//.test(ua)
          ? "Safari"
          : "Web browser";

  const system = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";

  return system ? `${browser} on ${system}` : browser;
}

export function getWebDeviceContext(): WebDeviceContext {
  let storage: Storage | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Some privacy configurations throw while merely reading localStorage.
  }
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return {
    device_fingerprint: persistentDeviceFingerprint(storage),
    platform: "web",
    device_label: describeBrowser(userAgent),
  };
}
