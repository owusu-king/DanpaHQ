/**
 * Search, as a tenant does it.
 *
 * Every field here is one a tenant decides on. `advance_label` and
 * `total_move_in_minor` in particular: the monthly rent is not what determines
 * whether someone can take a room in Ghana - the lump sum on day one is - so
 * the API sends both and the UI never shows one without the other.
 */

import { apiFetch } from "@/api";

export type ListingMedia = {
  id: string;
  file_id: string;
  is_cover: boolean;
  caption: string;
  download_url: string | null;
};

export type ListingCardMedia = {
  file_id: string;
  caption: string;
  download_url: string;
};

export type Listing = {
  id: string;
  unit: string;
  status: string;
  headline: string;
  description: string;
  rent_minor: number | null;
  rent_currency: string;
  rent_period: string;
  rent_formatted: string | null;
  advance_months: number;
  advance_label: string;
  caution_months: number;
  agency_fee_months: number;
  total_move_in_minor: number;
  available_from: string | null;
  minimum_lease_months: number;
  media: ListingMedia[];
  /** The one photograph a card shows: the Unit's own primary image, then the
   *  campaign's. `media` is optional campaign media and is usually empty. */
  cover_url: string | null;
  card_media: ListingCardMedia[];
  amenities: { id: string; name: string; category: string; icon: string }[];
  locality_name: string | null;
  district_name: string | null;
  landmark: string | null;
  property_type: string | null;
  space_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  is_furnished: boolean | null;
  map_latitude: string | null;
  map_longitude: string | null;
  provider_label: string;
  trust_stamps: {
    phone: { state: "verified" | "pending" | "unverified" | "expired" };
    identity: { state: "verified" | "pending" | "unverified" | "expired" };
    property: { state: "verified" | "pending" | "unverified" | "expired" };
    relationship: string;
    relationship_label: string;
  };
  review_note: string;
  reviewed_at: string | null;
  /** When it was listed; Explore's All view orders rentals and sales by it. */
  created_at: string;
};

export type SavedListing = {
  id: string;
  listing: Listing;
  note: string;
  created_at: string;
};

export type Locality = {
  id: string;
  name: string;
  district_name: string;
  region_name: string;
};

export type ListingSort = "newest" | "rent_asc" | "rent_desc";

export type SearchFilters = {
  q?: string;
  locality_id?: string;
  /** The search box, sent whole: a chosen place's bounds, or what "Search this area" searched. */
  west?: number;
  south?: number;
  east?: number;
  north?: number;
  property_type?: string;
  space_type?: string;
  bedrooms_min?: number;
  rent_min?: number;
  rent_max?: number;
  /** The one that actually decides things: months of advance a tenant can raise. */
  advance_max?: number;
  furnished?: boolean;
  sort?: ListingSort;
};

type Page<T> = { next: string | null; previous: string | null; results: T[] };

export type ListingPage = { results: Listing[]; next: string | null };

/** The query the list and the map both send, so they cannot be asked different questions. */
export function listingQuery(filters: SearchFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.toString();
}

/**
 * One page of results, and the cursor for the next.
 *
 * This used to return `page.results` and drop `next`, so scrolling stopped at
 * the first twenty rentals however many existed.
 */
export async function searchListings(filters: SearchFilters = {}): Promise<ListingPage> {
  const query = listingQuery(filters);
  const suffix = query ? `?${query}` : "";
  const page = await apiFetch<Page<Listing>>(`/listings/${suffix}`, { anonymous: true });
  return { results: page.results, next: page.next };
}

export async function searchListingsPage(cursorUrl: string): Promise<ListingPage> {
  // The cursor comes back absolute; only its query belongs to us.
  const query = cursorUrl.includes("?") ? cursorUrl.slice(cursorUrl.indexOf("?")) : "";
  const page = await apiFetch<Page<Listing>>(`/listings/${query}`, { anonymous: true });
  return { results: page.results, next: page.next };
}

export function getListing(id: string) {
  return apiFetch<Listing>(`/listings/${id}/`, { anonymous: true });
}

export function searchLocalities(query: string) {
  return apiFetch<Locality[]>(`/geo/localities/?q=${encodeURIComponent(query)}`, {
    anonymous: true,
  });
}

export function listSaved() {
  return apiFetch<SavedListing[]>("/me/saved-listings/");
}

export function saveListing(listingId: string, note = "") {
  return apiFetch<SavedListing>("/me/saved-listings/", {
    method: "POST",
    body: { listing_id: listingId, note },
  });
}

export function unsaveListing(listingId: string) {
  return apiFetch<null>("/me/saved-listings/", {
    method: "DELETE",
    body: { listing_id: listingId },
  });
}

/** Pesewas to "GH₵1,500.00". Never a float — see ADR 0006. */
export function formatMinor(minor: number, currency = "GHS"): string {
  const symbol = currency === "GHS" ? "GH₵" : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A listing, told in the order a tenant asks about it.
 *
 * `space` answers "what exactly am I renting" and `property_context` answers
 * "where is it". `gallery` combines appropriate photographs from both while
 * preserving their source labels and keeping the Unit primary photo first.
 *
 * Only the detail endpoint returns these; search results stay on the lighter
 * `Listing` shape, because each block costs the backend a query and a page of
 * cards needs none of them.
 *
 * The street, the house number and how to find the door are deliberately
 * absent. They are released when a viewing is confirmed.
 */
export type ListingDetail = Listing & {
  gallery: {
    id: string;
    file_id: string;
    source: "unit" | "listing" | "property";
    source_label: string;
    kind: string;
    caption: string;
    is_primary: boolean;
    download_url: string | null;
  }[];
  space: {
    id: string;
    label: string;
    space_type: string;
    space_type_label: string;
    description: string;
    bedrooms: number;
    bathrooms: number;
    floor_level: number | null;
    floor_area_sqm: string | null;
    wing: string;
    is_furnished: boolean;
    has_private_bathroom: boolean;
    has_private_toilet: boolean;
    has_private_kitchen: boolean;
    has_air_conditioning: boolean;
    amenities: { id: string; name: string; category: string; icon: string; notes: string }[];
    photos: { id: string; caption: string; is_primary: boolean; download_url: string | null }[];
    verification: { state: string; state_label: string; checked: boolean };
  };
  property_context: {
    id: string;
    title: string;
    property_type: string;
    property_type_label: string;
    locality_name: string | null;
    district_name: string | null;
    region_name: string | null;
    landmark: string;
    photos: {
      id: string;
      file_id: string;
      kind: string;
      caption: string;
      download_url: string | null;
    }[];
    amenities: { id: string; name: string; category: string; icon: string; notes: string }[];
    features: {
      water_source: string;
      water_source_label: string;
      power_meter_type: string;
      power_meter_label: string;
      compound_type: string;
      compound_label: string;
    };
    condition_state: string;
    authority: { state: "verified" | "pending" | "unverified" | "expired" };
    provider_label: string;
  };
};

export function getListingDetail(id: string) {
  return apiFetch<ListingDetail>(`/listings/${id}/`, { anonymous: true });
}

/** A backend-ranked, deliberately small set of available alternatives. */
export function getRelatedListings(id: string) {
  return apiFetch<Listing[]>(`/listings/${id}/related/`, { anonymous: true });
}
