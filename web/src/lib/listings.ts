import { apiFetch, idempotentMutation } from "./api";
import { authedFetch } from "./auth";
import type { Listing } from "./console";

type Page<T> = { next: string | null; previous: string | null; results: T[] };

export type ListingSort = "newest" | "rent_asc" | "rent_desc";

export type ListingFilters = {
  q?: string;
  locality_id?: string;
  property_type?: string;
  space_type?: string;
  bedrooms_min?: number;
  rent_min?: number;
  rent_max?: number;
  advance_max?: number;
  furnished?: boolean;
  sort?: ListingSort;
};

export type ListingPage = { results: Listing[]; next: string | null };

/**
 * One page of results, and the cursor for the next.
 *
 * This used to return `page.results` and drop `next` on the floor, so discovery
 * silently stopped at the first twenty rentals however many existed. The cursor
 * is opaque and absolute; it is followed rather than rebuilt.
 */
export async function searchPublicListings(filters: ListingFilters = {}): Promise<ListingPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const page = await apiFetch<Page<Listing>>(`/listings/${suffix}`);
  return { results: page.results, next: page.next };
}

export async function searchPublicListingsPage(cursorUrl: string): Promise<ListingPage> {
  // The cursor comes back as an absolute URL; only its query belongs to us.
  const query = cursorUrl.includes("?") ? cursorUrl.slice(cursorUrl.indexOf("?")) : "";
  const page = await apiFetch<Page<Listing>>(`/listings/${query}`);
  return { results: page.results, next: page.next };
}

/** The id travels in the body, not the path — the collection has no detail route. */
export function unsavePublicListing(listingId: string) {
  return authedFetch("/me/saved-listings/", {
    method: "DELETE",
    body: JSON.stringify({ listing_id: listingId }),
  });
}

export function savePublicListing(listingId: string) {
  return authedFetch("/me/saved-listings/", {
    method: "POST",
    body: JSON.stringify({ listing_id: listingId }),
  });
}

export function requestPublicViewing(listingId: string) {
  return authedFetch("/me/viewings/", {
    method: "POST",
    body: JSON.stringify({
      listing_id: listingId,
      message: "I would like to arrange a viewing for this property.",
    }),
    ...idempotentMutation(),
  });
}

/**
 * A public listing, told in the order a tenant asks about it.
 *
 * Two context blocks answer different questions, while `gallery` brings their
 * appropriate photographs together without blurring their source. `space` is
 * "what exactly am I renting"; `property_context` is "where is it".
 *
 * Only the detail endpoint returns these. Search results stay on the lighter
 * `Listing` shape: each block costs the backend a query, and a page of twenty
 * cards needs none of them.
 *
 * What is deliberately absent: the street, the house number and how to find the
 * door. Those are released when a viewing is confirmed, not to anyone who opens
 * a page.
 */
export type ListingDetail = Listing & {
  gallery: Array<{
    id: string;
    file_id: string;
    source: "unit" | "listing" | "property";
    source_label: string;
    kind: string;
    caption: string;
    is_primary: boolean;
    download_url: string | null;
  }>;
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
    amenities: Array<{ id: string; name: string; category: string; icon: string; notes: string }>;
    photos: Array<{ id: string; caption: string; is_primary: boolean; download_url: string | null }>;
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
    photos: Array<{
      id: string;
      file_id: string;
      kind: string;
      caption: string;
      download_url: string | null;
    }>;
    amenities: Array<{ id: string; name: string; category: string; icon: string; notes: string }>;
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

export function getPublicListing(listingId: string) {
  return apiFetch<ListingDetail>(`/listings/${listingId}/`);
}

/** A backend-ranked, deliberately small set of available alternatives. */
export function getRelatedListings(listingId: string) {
  return apiFetch<Listing[]>(`/listings/${listingId}/related/`);
}
