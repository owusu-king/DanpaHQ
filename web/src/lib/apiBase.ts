/**
 * Where the API lives, decided once for the whole web client.
 *
 * `NEXT_PUBLIC_*` is inlined at build time, so a production build made without
 * `NEXT_PUBLIC_API_URL` bakes the development fallback into the bundle and
 * ships an app that talks plain HTTP to `localhost` — broken on every machine
 * but the developer's, and insecure while it fails. A release refuses to build
 * rather than shipping that, which is how the backend treats a missing
 * production secret and how the mobile client treats a missing API URL.
 *
 * Development keeps the convenient default: `docker compose up` serves the API
 * on :8000 and the web app on :3000, and neither needs configuring.
 */
const DEVELOPMENT_FALLBACK = "http://localhost:8000/api/v1";

function resolve(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (process.env.NODE_ENV === "production") {
    if (!configured) {
      throw new Error(
        "NEXT_PUBLIC_API_URL is not set. A production build must be given the " +
          "API URL; it must never fall back to a development address.",
      );
    }
    if (!configured.startsWith("https://")) {
      throw new Error(
        `NEXT_PUBLIC_API_URL must be https:// in a production build (got ${configured}).`,
      );
    }
    return configured;
  }

  return configured ?? DEVELOPMENT_FALLBACK;
}

export const API_BASE_URL = resolve();
