/**
 * Places for the phone's location field (ADR 0034).
 *
 * Suggestions and the chosen place are asked of Rooomly's API, which asks the
 * location provider on the app's behalf; the app holds no Places key. One search
 * is one Places session: its token is made with the first suggestion request,
 * carried by every one after it, and spent by resolving the choice.
 */

import { randomUUID } from "expo-crypto";

import { apiFetch } from "@/api";

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
  /** West, south, east, north: where Rooomly's maps may go. */
  bounds: [number, number, number, number];
  default_view: { lat: number; lng: number; zoom: number };
  min_zoom: number;
  max_zoom: number;
};

/** A fresh session token. Never reuse one after its resolve. */
export function newPlacesSession(): string {
  return randomUUID();
}

/** How a suggestion is named once chosen: "East Legon, Accra". */
export function placeLabel(suggestion: Pick<PlaceSuggestion, "name" | "context">): string {
  const anchor = suggestion.context.split(",")[0]?.trim();
  return anchor && anchor !== suggestion.name ? `${suggestion.name}, ${anchor}` : suggestion.name;
}

/** Suggestions while somebody types. One attempt: a retried suggestion answers a question nobody is still asking. */
export function suggestPlaces(query: string, session: string, areasOnly = false) {
  const params = new URLSearchParams({ q: query, session });
  if (areasOnly) params.set("scope", "areas");
  return apiFetch<PlaceSuggestions>(`/geo/places/suggest/?${params.toString()}`, {
    anonymous: true,
    maxAttempts: 1,
  });
}

/** The chosen suggestion, located — by the provider that suggested it, in the same session. */
export function resolvePlace(suggestion: PlaceSuggestion, session: string | null) {
  const params = new URLSearchParams({
    provider: suggestion.provider,
    reference: suggestion.reference,
    name: placeLabel(suggestion),
  });
  if (session) params.set("session", session);
  return apiFetch<ResolvedPlace>(`/geo/places/resolve/?${params.toString()}`, {
    anonymous: true,
    maxAttempts: 1,
  });
}

let mapConfig: Promise<MapConfig> | null = null;

/** Where maps may go and where they open. Fetched once; a failure is not remembered. */
export function getMapConfig(): Promise<MapConfig> {
  mapConfig ??= apiFetch<MapConfig>("/map/config/", { anonymous: true }).catch((cause) => {
    mapConfig = null;
    throw cause;
  });
  return mapConfig;
}
