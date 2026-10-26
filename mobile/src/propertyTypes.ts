import { apiFetch } from "@/api";

/**
 * What a property may contain, read from the backend rather than duplicated here.
 *
 * Before this, the mobile property form asked for the type as **free text** —
 * "Apartment, house, studio, shop, office or land" as a hint over an input — so
 * a typo produced a property of type `appartment`, and nothing downstream could
 * decide what might be let inside it.
 *
 * Now the matrix that validates a request also describes the form, so a client
 * cannot offer a combination the backend would refuse, and cannot invent one.
 */

export type SpaceTypeOption = {
  value: string;
  label: string;
  /** Whether individual bed spaces can be set up inside it. Only a room can. */
  accepts_bed_spaces: boolean;
  /** False for land: no rooms to count, no interior to photograph. */
  has_interior: boolean;
  /** Which details fit this kind of space. Served by the backend's `space_rules`. */
  asks: { bedrooms: boolean; bathrooms: "count" | "yes_no" | "none"; floor: boolean };
};

export type PropertyTypeOption = {
  value: string;
  label: string;
  space_types: SpaceTypeOption[];
};

/** One choice from a fixed set — a water source, a meter, a kind of compound. */
export type FeatureOption = { value: string; label: string };

/**
 * The property vocabulary, whole.
 *
 * The three feature lists are not decoration: `trust.evidence_policy` reads the
 * stored values to decide what a property must photograph, so a form offering a
 * value the backend does not have would build a checklist nobody could finish.
 */
export type PropertyVocabulary = {
  property_types: PropertyTypeOption[];
  water_sources: FeatureOption[];
  power_meter_types: FeatureOption[];
  compound_types: FeatureOption[];
  /** What can be sold whole: a house, a commercial building, land. */
  sale_types: FeatureOption[];
};

/**
 * Cached for the app session.
 *
 * This describes the product's vocabulary, not anybody's data — it changes when
 * the code changes. Re-fetching it per form would spend the person's data on an
 * answer that cannot have moved.
 */
let cached: Promise<PropertyVocabulary> | null = null;

export function loadPropertyVocabulary(): Promise<PropertyVocabulary> {
  if (!cached) {
    cached = apiFetch<PropertyVocabulary>("/property-types/").catch((cause) => {
      // Not cached on failure, so one bad moment of signal does not leave the
      // form empty for the rest of the session.
      cached = null;
      throw cause;
    });
  }
  return cached;
}

/** The categories alone, which is all most callers want. */
export function loadPropertyTypes(): Promise<PropertyTypeOption[]> {
  return loadPropertyVocabulary().then((vocabulary) => vocabulary.property_types);
}

/** The space types a property of this category may contain. */
export function spaceTypesFor(
  types: PropertyTypeOption[],
  propertyType: string,
): SpaceTypeOption[] {
  return types.find((type) => type.value === propertyType)?.space_types ?? [];
}
