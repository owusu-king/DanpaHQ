/**
 * Google Maps configuration, from the web build (ADR 0034).
 *
 * `NEXT_PUBLIC_*` values are inlined when the bundle is built, so a key added
 * later needs a rebuild — in development, a restart of the web container. This
 * is a browser key: restrict it by HTTP referrer and to the Maps JavaScript API.
 * Places requests go through Rooomly's API and never use it.
 */

export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/**
 * Advanced markers need a map ID, and the map ID carries the map's style.
 * Development without one borrows Google's demo ID, which draws the default
 * style; a production build without one has no map rather than an unstyled one.
 */
export const GOOGLE_MAPS_MAP_ID =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ||
  (process.env.NODE_ENV === "production" ? "" : "DEMO_MAP_ID");

export function googleMapsConfigured(): boolean {
  return Boolean(GOOGLE_MAPS_KEY && GOOGLE_MAPS_MAP_ID);
}

/**
 * What a developer needs to hear when this build has no map: the setting that
 * would draw one. A static "not available" card otherwise reads as a map that
 * stopped updating. Production builds never say this to the people using them.
 */
export function googleMapsSetupHint(): string | null {
  if (process.env.NODE_ENV === "production" || googleMapsConfigured()) return null;
  return "Development build: add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to .env and recreate the web container (runbook, Maps and places).";
}
