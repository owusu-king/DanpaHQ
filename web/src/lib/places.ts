/**
 * Places: what somebody types into the location field, and where it is.
 *
 * A suggestion is a place with a centre and a box, never text the client then
 * guesses the geography of. The map fits the box; the search sends the slug.
 */

import { apiFetch } from "./api";

export type PlaceKind =
  | "region"
  | "district"
  | "city"
  | "town"
  | "suburb"
  | "neighbourhood"
  | "village"
  | "landmark";

export type GeoBounds = { west: number; south: number; east: number; north: number };

export type Place = {
  slug: string;
  name: string;
  kind: PlaceKind;
  kind_label: string;
  /** The larger place the name is read against: "Accra, Greater Accra". */
  context: string;
  /** The name with the first part of its context: "East Legon, Accra". */
  display_name: string;
  center: { lat: number; lng: number };
  bounds: GeoBounds;
  locality_id: string | null;
};

export type MapConfig = {
  tiles_url: string;
  glyphs_url: string;
  attribution: string;
  bounds: [number, number, number, number];
  default_view: { lat: number; lng: number; zoom: number };
  min_zoom: number;
  max_zoom: number;
};

/**
 * Suggestions while somebody types. Pass the signal: the next keystroke
 * withdraws this request. One attempt — a suggestion list that retries for four
 * seconds answers a question nobody is asking any more.
 */
export function searchPlaces(query: string, signal?: AbortSignal) {
  return apiFetch<Place[]>(`/geo/places/?q=${encodeURIComponent(query)}`, {
    signal,
    maxAttempts: 1,
    timeoutMs: 6_000,
  });
}

/** One place by slug, to restore a refreshed or shared search. */
export function getPlace(slug: string, signal?: AbortSignal) {
  return apiFetch<Place>(`/geo/places/${encodeURIComponent(slug)}/`, { signal });
}

let mapConfig: Promise<MapConfig> | null = null;

/** Where the basemap and its fonts live. Fetched once per tab; a failure is not remembered. */
export function getMapConfig(): Promise<MapConfig> {
  mapConfig ??= apiFetch<MapConfig>("/map/config/").catch((cause) => {
    mapConfig = null;
    throw cause;
  });
  return mapConfig;
}
