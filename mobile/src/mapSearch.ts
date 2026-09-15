/**
 * The map's half of the phone's search.
 *
 * It asks exactly what the results list asks — `listingQuery` builds both — plus
 * what only the map knows: the window on screen and the zoom. The count and
 * extent come back with the markers, so the number over the list and the
 * markers on the map describe one set of rentals.
 */

import { apiFetch } from "@/api";
import { listingQuery, type Listing, type SearchFilters } from "@/listings";
import type { GeoBounds } from "@/places";

export type MapListingFeature = {
  type: "listing";
  id: string;
  lat: number;
  lng: number;
  rent_minor: number | null;
  rent_currency: string;
  rent_period: string;
  precision: "area" | "locality" | "";
};

export type MapClusterFeature = {
  type: "cluster";
  key: string;
  lat: number;
  lng: number;
  count: number;
  min_rent_minor: number | null;
  rent_currency: string;
  /** Several listings on one public point: a tap previews them, zooming never separates them. */
  stacked: boolean;
  ids: string[] | null;
  bounds: GeoBounds;
};

export type MapFeature = MapListingFeature | MapClusterFeature;

export type MapResults = {
  zoom: number;
  features: MapFeature[];
  truncated: boolean;
  total?: number;
  unmapped?: number;
  extent?: GeoBounds | null;
};

/** A coordinate to five decimals, about a metre: enough for a window, short in a URL. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

export function searchListingMap(
  filters: SearchFilters,
  { window, zoom, summary }: { window: GeoBounds | null; zoom: number; summary: boolean },
) {
  const params = new URLSearchParams(listingQuery(filters));
  params.set("zoom", String(Math.max(0, Math.min(22, Math.round(zoom)))));
  if (window) {
    params.set("view_west", String(roundCoordinate(window.west)));
    params.set("view_south", String(roundCoordinate(window.south)));
    params.set("view_east", String(roundCoordinate(window.east)));
    params.set("view_north", String(roundCoordinate(window.north)));
  }
  if (!summary) params.set("summary", "false");
  return apiFetch<MapResults>(`/listings/map/?${params.toString()}`, { anonymous: true, maxAttempts: 2 });
}

/** The listings a marker stands for, in its order. Public search rules still decide what comes back. */
export async function getListingsById(ids: string[]): Promise<Listing[]> {
  const wanted = ids.slice(0, 40);
  if (!wanted.length) return [];
  const page = await apiFetch<{ results: Listing[] }>(`/listings/?ids=${wanted.join(",")}&page_size=40`, {
    anonymous: true,
  });
  const order = new Map(wanted.map((id, index) => [id, index]));
  return [...page.results].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * "₵850", "₵1.2k", "₵24k/yr": short enough to sit on a map without covering it.
 * Written out rather than `Intl`'s compact notation, which not every Android
 * engine a tenant carries implements.
 */
export function compactRent(minor: number | null, period = "monthly"): string {
  if (minor === null || !Number.isFinite(minor)) return "₵–";
  const cedis = minor / 100;
  const text = cedis >= 1_000_000
    ? `${Math.round(cedis / 100_000) / 10}m`
    : cedis >= 1_000
      ? `${Math.round(cedis / 100) / 10}k`
      : String(Math.round(cedis));
  return `₵${text}${period === "yearly" ? "/yr" : ""}`;
}
