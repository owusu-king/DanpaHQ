/**
 * Which glyph stands for each amenity and each answer in the creation flows.
 *
 * The words come from the backend — amenity names and the water, power and
 * compound labels are served — so this holds only the drawing. An amenity added
 * on the server without an entry here still gets its category's glyph, and one
 * in a category nobody drew gets the generic mark, never a blank.
 */

import type { IconName } from "@/components/portal/icons";

const AMENITY_BY_NAME: Record<string, IconName> = {
  "security guard": "shield",
  cctv: "video",
  "parking space": "car",
  "swimming pool": "pool",
  gym: "dumbbell",
  "laundry room": "washer",
  "internet / fibre": "wifi",
  "self meter": "power",
  "private bathroom": "bath",
  "water in the unit": "water",
  porch: "door",
  kitchen: "kitchen",
  "private toilet": "toilet",
  furnished: "sofa",
  "air conditioning": "snow",
  "tiled floors": "tiles",
  balcony: "balcony",
  wardrobe: "wardrobe",
  "study desk": "desk",
  "shop frontage": "shop",
  "loading access": "truck",
};

const AMENITY_BY_CATEGORY: Record<string, IconName> = {
  water: "water",
  power: "power",
  security: "shield",
  recreation: "pool",
  transport: "truck",
  kitchen: "kitchen",
  bathroom: "bath",
  laundry: "washer",
  connectivity: "wifi",
  parking: "car",
  outdoor: "tree",
  comfort: "sofa",
};

export function amenityGlyph(name: string, category = ""): IconName {
  return AMENITY_BY_NAME[name.trim().toLowerCase()] ?? AMENITY_BY_CATEGORY[category] ?? "amenities";
}

/** The three property facts, each answer drawn. Keyed by fact, then by value. */
export const FACT_GLYPHS: Record<"water" | "power" | "compound", Record<string, IconName>> = {
  water: { borehole_pump: "tank", gwl_mains: "tap", well: "well", none: "none" },
  power: { prepaid: "power", postpaid: "receipt", none: "none" },
  compound: { walled_gated: "gate", fenced: "fence", open: "tree" },
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
