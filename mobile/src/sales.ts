/**
 * Properties for sale: public discovery, the seller's controls, and enquiries.
 *
 * A property for sale is sold whole — no Units — and is public exactly while its
 * verification is current and its seller has it on the market. That rule lives
 * in the backend (`apps.sale.read_models`); nothing here decides whether a sale
 * is public, it only reads what the server says.
 *
 * The web client's `src/lib/sales.ts`, adapted to this client's `apiFetch`,
 * which attaches the bearer token whenever one is held — so a signed-in reader
 * gets their own enquiry back on a sale and a signed-out one does not.
 */

import { apiFetch } from "@/api";

type Page<T> = { next: string | null; previous: string | null; results: T[] };

export type SaleKind = "residential" | "commercial" | "land";
export type SaleStatus = "active" | "withdrawn" | "sold";
export type Tenure = "freehold" | "leasehold" | "customary";
export type SaleSort = "newest" | "price_asc" | "price_desc";

export type SaleLocation = {
  latitude: number;
  longitude: number;
  precision: "area" | "locality";
  radius_m: number;
};

/** One property for sale, as a search result shows it. */
export type SaleCard = {
  id: string;
  kind: SaleKind;
  kind_label: string;
  status: SaleStatus;
  headline: string;
  price_minor: number | null;
  currency: string;
  price_formatted: string | null;
  price_negotiable: boolean;
  tenure: Tenure | "";
  tenure_label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_area_sqm: string | null;
  commercial_use: string;
  commercial_use_label: string;
  land_size: string | null;
  land_size_unit: string;
  land_size_unit_label: string;
  is_serviced: boolean | null;
  locality_name: string | null;
  district_name: string | null;
  region_name: string | null;
  cover_url: string | null;
  location: SaleLocation | null;
  seller_label: string;
  listed_at: string;
};

export type SalePhoto = {
  id: string;
  file_id: string;
  kind: string;
  caption: string;
  is_primary: boolean;
  download_url: string;
};

export type SaleDetail = SaleCard & {
  description: string;
  lease_years_remaining: number | null;
  gallery: SalePhoto[];
  landmark: string;
  /** Water, power and the compound — null for land, which has none of them. */
  features: {
    water_source_label: string;
    power_meter_label: string;
    compound_label: string;
  } | null;
  amenities: { id: string; name: string; category: string }[];
  /** The reader's own conversation about this property, when signed in and started. */
  my_enquiry_id: string | null;
};

export type SaleFilters = {
  q?: string;
  kind?: SaleKind;
  locality_id?: string;
  price_min?: number;
  price_max?: number;
  bedrooms_min?: number;
  tenure?: Tenure;
  west?: number;
  south?: number;
  east?: number;
  north?: number;
  sort?: SaleSort;
};

export type SalePage = { results: SaleCard[]; next: string | null };

export async function searchSales(filters: SaleFilters = {}): Promise<SalePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  const suffix = text ? `?${text}` : "";
  const page = await apiFetch<Page<SaleCard>>(`/sales/${suffix}`);
  return { results: page.results, next: page.next };
}

export async function searchSalesPage(cursorUrl: string): Promise<SalePage> {
  const query = cursorUrl.includes("?") ? cursorUrl.slice(cursorUrl.indexOf("?")) : "";
  const page = await apiFetch<Page<SaleCard>>(`/sales/${query}`);
  return { results: page.results, next: page.next };
}

/** Signed in, the answer carries the reader's own enquiry; signed out, it does not. */
export function getSale(id: string): Promise<SaleDetail> {
  return apiFetch<SaleDetail>(`/sales/${id}/`);
}

// --- the seller ----------------------------------------------------------------

/** Something the sale still needs before the property can be sent, named. */
export type SaleGap = { field: string; message: string };

export type SellerSale = {
  id: string;
  kind: SaleKind;
  status: SaleStatus;
  status_label: string;
  status_changed_at: string | null;
  is_public: boolean;
  headline: string;
  description: string;
  price_minor: number | null;
  currency: string;
  price_formatted: string | null;
  price_negotiable: boolean;
  tenure: Tenure | "";
  lease_years_remaining: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_area_sqm: string | null;
  commercial_use: string;
  land_size: string | null;
  land_size_unit: string;
  is_serviced: boolean | null;
  missing: SaleGap[];
  /** What may change right now: everything while being described, the price and
   *  words once verified, nothing while our team holds it. */
  editable_fields: string[];
  enquiry_count: number;
  created_at: string;
};

export type SaleInput = Partial<{
  price_minor: number;
  price_negotiable: boolean;
  headline: string;
  description: string;
  tenure: string;
  lease_years_remaining: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_area_sqm: string | null;
  commercial_use: string;
  land_size: string | null;
  land_size_unit: string;
  is_serviced: boolean | null;
}>;

export function getSellerSale(propertyId: string): Promise<SellerSale> {
  return apiFetch<SellerSale>(`/properties/${propertyId}/sale/`);
}

export function updateSale(propertyId: string, input: SaleInput): Promise<SellerSale> {
  return apiFetch<SellerSale>(`/properties/${propertyId}/sale/`, {
    method: "PATCH",
    body: input,
  });
}

export function setSaleStatus(
  propertyId: string,
  action: "withdraw" | "relist" | "sold",
): Promise<SellerSale> {
  return apiFetch<SellerSale>(`/properties/${propertyId}/sale/${action}/`, {
    method: "POST",
    body: {},
  });
}

// --- enquiries -------------------------------------------------------------------

export type EnquiryMessage = {
  id: string;
  body: string;
  mine: boolean;
  author_name: string;
  created_at: string;
};

export type Enquiry = {
  id: string;
  role: "buyer" | "seller";
  status: "open" | "closed";
  sale: {
    id: string;
    property_id: string;
    headline: string;
    status: SaleStatus;
    price_formatted: string | null;
    locality_name: string | null;
  };
  buyer_name: string;
  unread: boolean;
  last_message: string;
  last_message_at: string | null;
  created_at: string;
};

export type EnquiryDetail = Enquiry & { messages: EnquiryMessage[] };

export function startEnquiry(saleId: string, message: string): Promise<EnquiryDetail> {
  return apiFetch<EnquiryDetail>(`/sales/${saleId}/enquiries/`, {
    method: "POST",
    body: { message },
  });
}

export function listEnquiries(as: "buyer" | "seller"): Promise<Enquiry[]> {
  return apiFetch<Enquiry[]>(`/me/sale-enquiries/?as=${as}`);
}

export function getEnquiry(id: string): Promise<EnquiryDetail> {
  return apiFetch<EnquiryDetail>(`/sale-enquiries/${id}/`);
}

export function replyToEnquiry(id: string, message: string): Promise<EnquiryDetail> {
  return apiFetch<EnquiryDetail>(`/sale-enquiries/${id}/messages/`, {
    method: "POST",
    body: { message },
  });
}

// --- words ------------------------------------------------------------------------

export const SALE_KIND_LABEL: Record<SaleKind, string> = {
  residential: "House",
  commercial: "Commercial property",
  land: "Land",
};

export const TENURES: readonly (readonly [Tenure, string])[] = [
  ["freehold", "Freehold"],
  ["leasehold", "Leasehold"],
  ["customary", "Customary land"],
];

export const LAND_UNITS = [
  ["plots", "Plots"],
  ["acres", "Acres"],
  ["sqm", "Square metres"],
] as const;

export const COMMERCIAL_USES = [
  ["shop", "Shop or retail"],
  ["office", "Office"],
  ["warehouse", "Warehouse or industrial"],
  ["mixed_use", "Mixed use"],
  ["other", "Other commercial"],
] as const;

/** The one line a card says about size: rooms for a house, area for the rest. */
export function saleFacts(sale: Pick<
  SaleCard,
  "kind" | "bedrooms" | "bathrooms" | "floor_area_sqm" | "land_size" | "land_size_unit_label" | "commercial_use_label"
>): string[] {
  if (sale.kind === "land") {
    return sale.land_size ? [`${trimNumber(sale.land_size)} ${sale.land_size_unit_label.toLowerCase()}`] : [];
  }
  if (sale.kind === "commercial") {
    return [
      sale.commercial_use_label,
      sale.floor_area_sqm ? `${trimNumber(sale.floor_area_sqm)} m²` : "",
    ].filter(Boolean);
  }
  return [
    sale.bedrooms !== null ? `${sale.bedrooms} bed${sale.bedrooms === 1 ? "" : "s"}` : "",
    sale.bathrooms !== null ? `${sale.bathrooms} bath${sale.bathrooms === 1 ? "" : "s"}` : "",
    sale.floor_area_sqm ? `${trimNumber(sale.floor_area_sqm)} m²` : "",
  ].filter(Boolean);
}

/** "2.000" → "2", "1.500" → "1.5": a decimal from the API, said as a person would. */
export function trimNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 1000) / 1000) : value;
}
