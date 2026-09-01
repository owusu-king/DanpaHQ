const DEVICE_KEY = "rooomly.device_fingerprint";
let memoryFingerprint = "";

function newFingerprint() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function persistentDeviceFingerprint(storage, create = newFingerprint) {
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
    if (!memoryFingerprint) memoryFingerprint = create().slice(0, 128);
    return memoryFingerprint;
  }
}

export function describeBrowser(userAgent) {
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
