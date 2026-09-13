/**
 * The one Explore search, as data.
 *
 * The location field, the filter pills, the Filters panel, the results list,
 * the map's markers and the result count all read this; only the URL writes it.
 * The map is a view of the search, not its owner — so opening it, closing it,
 * leaving for a listing and coming back all return to exactly this, and a copied
 * address reproduces it for somebody else.
 *
 * The geographic part of a search is its *area*: a box searched on the map, or
 * else a chosen place (a stable slug, never the text that was typed), or else a
 * locality from a link made before places existed.
 */

import type { ListingSort } from "./listings";
import type { GeoBounds } from "./places";

export type ExploreView = "list" | "map";

export type ExploreQuery = {
  /** A place's slug, e.g. `east-legon-accra`. */
  place: string;
  /** An area searched with "Search this area". Narrows the place, never replaces it. */
  bbox: GeoBounds | null;
  /** Free text, when somebody searched without choosing a place. */
  q: string;
  /** Links from before places: a locality filter and the names it was shown with. */
  localityId: string;
  localityName: string;
  propertyType: string;
  spaceType: string;
  bedrooms: string;
  /** Rent in whole cedis, as the tenant typed it. */
  rentMin: string;
  rentMax: string;
  advanceMax: string;
  furnished: boolean;
  sort: ListingSort;
  view: ExploreView;
};

export const EMPTY_EXPLORE_QUERY: ExploreQuery = {
  place: "",
  bbox: null,
  q: "",
  localityId: "",
  localityName: "",
  propertyType: "",
  spaceType: "",
  bedrooms: "",
  rentMin: "",
  rentMax: "",
  advanceMax: "",
  furnished: false,
  sort: "newest",
  view: "list",
};

const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");

/** `west,south,east,north`, and only when all four are real, in range and the right way round. */
export function parseBounds(value: string | null): GeoBounds | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

/**
 * A coordinate to five decimals — about a metre: precise enough for a viewport,
 * short enough to share. Arithmetic rather than `toFixed`, which this codebase
 * keeps for nothing, because it is how money gets formatted wrongly.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

export function formatBounds(bounds: GeoBounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map(roundCoordinate).join(",");
}

export function parseExploreQuery(params: URLSearchParams): ExploreQuery {
  const sort = params.get("sort");
  const bedrooms = digits(params.get("bedrooms_min"));
  return {
    place: (params.get("place") ?? "").trim().slice(0, 160),
    bbox: parseBounds(params.get("bbox")),
    q: (params.get("q") ?? "").slice(0, 120),
    localityId: params.get("locality_id") ?? "",
    localityName: params.get("locality_name") ?? "",
    propertyType: params.get("property_type") ?? "",
    spaceType: params.get("space_type") ?? "",
    // `0` meant any to the backend (it filters `>=`), so an old link restores as Any.
    bedrooms: bedrooms === "0" ? "" : bedrooms,
    rentMin: digits(params.get("rent_min")),
    rentMax: digits(params.get("rent_max")),
    advanceMax: digits(params.get("advance_max")),
    furnished: params.get("furnished") === "true",
    sort: sort === "rent_asc" || sort === "rent_desc" ? sort : "newest",
    view: params.get("view") === "map" ? "map" : "list",
  };
}

/** The address-bar form. Defaults are left out, so a plain search stays a plain URL. */
export function serializeExploreQuery(query: ExploreQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.place) params.set("place", query.place);
  else if (query.localityId) {
    params.set("locality_id", query.localityId);
    if (query.localityName) params.set("locality_name", query.localityName);
  } else if (query.q.trim()) params.set("q", query.q.trim());
  if (query.bbox) params.set("bbox", formatBounds(query.bbox));
  if (query.propertyType) params.set("property_type", query.propertyType);
  if (query.spaceType) params.set("space_type", query.spaceType);
  if (query.bedrooms) params.set("bedrooms_min", query.bedrooms);
  if (query.rentMin) params.set("rent_min", query.rentMin);
  if (query.rentMax) params.set("rent_max", query.rentMax);
  if (query.advanceMax) params.set("advance_max", query.advanceMax);
  if (query.furnished) params.set("furnished", "true");
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.view === "map") params.set("view", "map");
  return params;
}

/**
 * The API form of the same search, for `/listings/` and `/listings/map/` alike.
 *
 * One function, so the list and the map cannot be asked different questions.
 * Rent travels in pesewas; the area is the searched box when there is one,
 * otherwise the place, otherwise the legacy locality.
 */
export function listingSearchParams(query: ExploreQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.bbox) {
    params.set("west", String(query.bbox.west));
    params.set("south", String(query.bbox.south));
    params.set("east", String(query.bbox.east));
    params.set("north", String(query.bbox.north));
  } else if (query.place) {
    params.set("place", query.place);
  } else if (query.localityId) {
    params.set("locality_id", query.localityId);
  }
  if (!query.place && !query.localityId && query.q.trim()) params.set("q", query.q.trim());
  if (query.propertyType) params.set("property_type", query.propertyType);
  if (query.spaceType) params.set("space_type", query.spaceType);
  if (query.bedrooms) params.set("bedrooms_min", query.bedrooms);
  if (query.rentMin) params.set("rent_min", String(Number(query.rentMin) * 100));
  if (query.rentMax) params.set("rent_max", String(Number(query.rentMax) * 100));
  if (query.advanceMax) params.set("advance_max", query.advanceMax);
  if (query.furnished) params.set("furnished", "true");
  params.set("sort", query.sort);
  return params;
}

/** Everything the Filters panel holds that is set. Place is not a filter: the field owns it. */
export function refinementCount(query: ExploreQuery): number {
  return [
    query.rentMin || query.rentMax,
    query.propertyType,
    query.spaceType,
    query.bedrooms,
    query.advanceMax,
    query.furnished,
    query.sort !== "newest",
  ].filter(Boolean).length;
}

/** The same query with every filter cleared and the area, text and view kept. */
export function withoutFilters(query: ExploreQuery): ExploreQuery {
  return {
    ...EMPTY_EXPLORE_QUERY,
    place: query.place,
    bbox: query.bbox,
    q: query.q,
    localityId: query.localityId,
    localityName: query.localityName,
    view: query.view,
  };
}
