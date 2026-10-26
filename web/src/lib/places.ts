/**
 * Places: what somebody types into the location field, and where it is.
 *
 * Suggestions and the chosen place come from Danpa HQ's API, which asks the
 * location provider on the client's behalf (ADR 0034) — no Places key is in this
 * bundle. A suggestion has no geometry. Choosing one resolves it, once, into a
 * centre and a box, and the search keeps that box in the address bar, so a
 * shared link asks nobody again.
 */

import { apiFetch } from "./api";

export type GeoBounds = { west: number; south: number; east: number; north: number };

export type PlaceKind = "area" | "landmark" | "address";

export type PlaceSuggestion = {
  provider: string;
  reference: string;
  /** "East Legon" */
  name: string;
  /** The larger place it is read against: "Accra". */
  context: string;
  kind: PlaceKind;
};

export type PlaceSuggestions = {
  /** Who answered: the configured provider, or Danpa HQ's localities standing in. */
  provider: string;
  /** Whose attribution these suggestions must carry, if anyone's. */
  attribution: string | null;
  suggestions: PlaceSuggestion[];
};

export type ResolvedPlace = {
  provider: string;
  reference: string;
  display_name: string;
  kind: PlaceKind;
  center: { lat: number; lng: number };
  bounds: GeoBounds;
};

export type MapConfig = {
  /** West, south, east, north: where Danpa HQ's maps may go. */
  bounds: [number, number, number, number];
  default_view: { lat: number; lng: number; zoom: number };
  min_zoom: number;
  max_zoom: number;
};

/** A version 4 UUID, also where `crypto.randomUUID` is missing (a page served over plain http). */
function uuid4(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A Places session: every suggestion request in one search, and the resolve
 * that ends it. A provider that prices sessions then prices one search, not
 * every letter typed. Never reuse one after its resolve.
 */
export function newPlacesSession(): string {
  return uuid4();
}

/** How a suggestion is named once chosen: "East Legon, Accra". */
export function placeLabel(suggestion: Pick<PlaceSuggestion, "name" | "context">): string {
  const anchor = suggestion.context.split(",")[0]?.trim();
  return anchor && anchor !== suggestion.name ? `${suggestion.name}, ${anchor}` : suggestion.name;
}

/**
 * Suggestions while somebody types. Pass the signal: the next keystroke
 * withdraws this request. One attempt — a suggestion list that retries for four
 * seconds answers a question nobody is asking any more.
 */
export function suggestPlaces(
  query: string,
  session: string,
  signal?: AbortSignal,
  areasOnly = false,
) {
  const params = new URLSearchParams({ q: query, session });
  if (areasOnly) params.set("scope", "areas");
  return apiFetch<PlaceSuggestions>(`/geo/places/suggest/?${params.toString()}`, {
    signal,
    maxAttempts: 1,
    timeoutMs: 6_000,
  });
}

/** The chosen suggestion, located — by the provider that suggested it, in the same session. */
export function resolvePlace(suggestion: PlaceSuggestion, session: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({
    provider: suggestion.provider,
    reference: suggestion.reference,
    name: placeLabel(suggestion),
  });
  if (session) params.set("session", session);
  return apiFetch<ResolvedPlace>(`/geo/places/resolve/?${params.toString()}`, {
    signal,
    maxAttempts: 1,
    timeoutMs: 8_000,
  });
}

let mapConfig: Promise<MapConfig> | null = null;

/** Where maps may go and where they open. Fetched once per tab; a failure is not remembered. */
export function getMapConfig(): Promise<MapConfig> {
  mapConfig ??= apiFetch<MapConfig>("/map/config/").catch((cause) => {
    mapConfig = null;
    throw cause;
  });
  return mapConfig;
}
