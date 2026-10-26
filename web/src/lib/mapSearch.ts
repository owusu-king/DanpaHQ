/**
 * The map's half of the Explore search.
 *
 * It asks exactly what the results list asks — `listingSearchParams` builds both
 * — plus what only the map knows: the window on screen and the zoom. The count
 * and extent come back with the markers, so the number over the results and
 * the markers under the map describe one set of rentals.
 */

import { apiFetch } from "./api";
import type { Listing } from "./console";
import { roundCoordinate } from "./exploreQuery";
import type { GeoBounds } from "./places";

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
  /** Present when the summary was asked for: it belongs to the search, not the window. */
  total?: number;
  unmapped?: number;
  extent?: GeoBounds | null;
};

export function searchListingMap(
  search: URLSearchParams,
  { window, zoom, summary }: { window: GeoBounds | null; zoom: number; summary: boolean },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams(search);
  params.set("zoom", String(Math.max(0, Math.min(22, Math.round(zoom)))));
  if (window) {
    params.set("view_west", String(roundCoordinate(window.west)));
    params.set("view_south", String(roundCoordinate(window.south)));
    params.set("view_east", String(roundCoordinate(window.east)));
    params.set("view_north", String(roundCoordinate(window.north)));
  }
  if (!summary) params.set("summary", "false");
  return apiFetch<MapResults>(`/listings/map/?${params.toString()}`, { signal, maxAttempts: 2 });
}

/**
 * One page of results for the search. `listingSearchParams` builds `search`,
 * the same parameters the map sends, so the list and the markers are one answer.
 * The next page is followed with `searchPublicListingsPage` and its cursor.
 */
export async function searchListingsFor(search: URLSearchParams, signal?: AbortSignal) {
  const page = await apiFetch<{ results: Listing[]; next: string | null }>(
    `/listings/?${search.toString()}`,
    { signal },
  );
  return { results: page.results, next: page.next };
}

/** The card shape for a marker's listings. Public search rules still decide what comes back. */
export async function getListingsById(ids: string[], signal?: AbortSignal): Promise<Listing[]> {
  const wanted = ids.slice(0, 40);
  if (!wanted.length) return [];
  const page = await apiFetch<{ results: Listing[] }>(
    `/listings/?ids=${wanted.join(",")}&page_size=40`,
    { signal },
  );
  const order = new Map(wanted.map((id, index) => [id, index]));
  return [...page.results].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * "₵850", "₵1.2k", "₵24k/yr": short enough to sit on a map without covering it.
 *
 * The full "GH₵1,200.00 / month" is the card's; a marker has room for the
 * comparison and nothing else, so the cedi sign carries the currency.
 */
export function compactRent(minor: number | null, period = "monthly"): string {
  if (minor === null || !Number.isFinite(minor)) return "₵–";
  return `₵${COMPACT.format(minor / 100).toLowerCase()}${period === "yearly" ? "/yr" : ""}`;
}

const COMPACT = new Intl.NumberFormat("en-GH", { notation: "compact", maximumFractionDigits: 1 });

/** "GH₵850k", "GH₵1.2m": a sale price short enough for a map marker. */
export function compactSalePrice(minor: number | null): string {
  if (minor === null) return "For sale";
  const cedis = minor / 100;
  if (cedis >= 1_000_000) return `GH₵${Math.round(cedis / 100_000) / 10}m`;
  if (cedis >= 1_000) return `GH₵${Math.round(cedis / 1_000)}k`;
  return `GH₵${Math.round(cedis)}`;
}
