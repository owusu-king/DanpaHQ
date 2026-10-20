import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

/**
 * Which glyph stands for each amenity and each answer in the creation flows.
 *
 * The twin of the web `creationGlyphs.ts`, drawn from Ionicons. The words come
 * from the backend — amenity names and the water, power and compound labels are
 * served — so this holds only the drawing. An amenity added on the server
 * without an entry here still gets its category's glyph, and one in a category
 * nobody drew gets the generic mark, never a blank.
 */

export type Glyph = ComponentProps<typeof Ionicons>["name"];

const AMENITY_BY_NAME: Record<string, Glyph> = {
  "security guard": "shield-checkmark-outline",
  cctv: "videocam-outline",
  "parking space": "car-outline",
  "swimming pool": "umbrella-outline",
  gym: "barbell-outline",
  "laundry room": "shirt-outline",
  "internet / fibre": "wifi-outline",
  "self meter": "speedometer-outline",
  "private bathroom": "water-outline",
  "water in the unit": "water",
  porch: "enter-outline",
  kitchen: "restaurant-outline",
  "private toilet": "water-outline",
  furnished: "bed-outline",
  "air conditioning": "snow-outline",
  "tiled floors": "grid-outline",
  balcony: "sunny-outline",
  wardrobe: "shirt-outline",
  "study desk": "desktop-outline",
  "shop frontage": "storefront-outline",
  "loading access": "bus-outline",
};

const AMENITY_BY_CATEGORY: Record<string, Glyph> = {
  water: "water-outline",
  power: "flash-outline",
  security: "shield-checkmark-outline",
  recreation: "umbrella-outline",
  transport: "bus-outline",
  kitchen: "restaurant-outline",
  bathroom: "water-outline",
  laundry: "shirt-outline",
  connectivity: "wifi-outline",
  parking: "car-outline",
  outdoor: "leaf-outline",
  comfort: "bed-outline",
};

export function amenityGlyph(name: string, category = ""): Glyph {
  return AMENITY_BY_NAME[name.trim().toLowerCase()] ?? AMENITY_BY_CATEGORY[category] ?? "sparkles-outline";
}

/** The three property facts, each answer drawn. Keyed by fact, then by value. */
export const FACT_GLYPHS: Record<"water" | "power" | "compound", Record<string, Glyph>> = {
  water: { borehole_pump: "cube-outline", gwl_mains: "water-outline", well: "funnel-outline", none: "ban-outline" },
  power: { prepaid: "flash-outline", postpaid: "receipt-outline", none: "ban-outline" },
  compound: { walled_gated: "lock-closed-outline", fenced: "grid-outline", open: "leaf-outline" },
};

/** A short second line under each answer, so the tile says what it means. */
export const FACT_HINTS: Record<string, string> = {
  borehole_pump: "Pumped to a polytank",
  gwl_mains: "Straight to the tap",
  well: "Drawn by hand",
  prepaid: "Credit meter",
  postpaid: "Monthly ECG bill",
  walled_gated: "Wall all round, with a gate",
  fenced: "Fenced, no gate",
  open: "No wall or fence",
};

/** The label without its parenthesis — the hint below already says it. */
export function shortFactLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, "").replace(/\s*\/.*$/, "");
}

export const TYPE_GLYPHS: Record<string, Glyph> = {
  residential: "home-outline",
  commercial: "storefront-outline",
  hostel: "bed-outline",
  land: "map-outline",
};

export const SPACE_GLYPHS: Record<string, Glyph> = {
  apartment: "business-outline",
  house: "home-outline",
  studio: "cube-outline",
  room: "bed-outline",
  bed_space: "bed-outline",
  shop: "storefront-outline",
  office: "desktop-outline",
  warehouse: "file-tray-outline",
  land: "map-outline",
};
