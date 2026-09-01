/**
 * What a property may contain, read from the backend rather than duplicated here.
 *
 * This file used to be a `PROPERTY_TYPES` array in the new-property page, and the
 * unit form had its own list beside it. Three copies of the vocabulary — two here
 * and the real one in `space_rules.py` — of which only the backend's was
 * enforced. They drifted the moment the categories changed.
 *
 * Now the matrix is served, and the same rules that validate a request describe
 * the form. A client cannot offer a combination the backend would refuse.
 */

import { apiFetch } from "./api";

export type SpaceTypeOption = {
  value: string;
  label: string;
  /** Whether individual bed spaces can be set up inside it. Only a room can. */
  accepts_bed_spaces: boolean;
  /** False for land: no rooms to count, no interior to photograph. */
  has_interior: boolean;
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
 * The three feature lists are not decoration. `trust.evidence_policy` reads them
 * to decide what a property must photograph — a borehole or sachet supply makes
 * the water source a required view, a family compound or an estate adds the
 * compound — so a form offering a value the backend does not have would build a
 * checklist nobody could finish.
 */
export type PropertyVocabulary = {
  property_types: PropertyTypeOption[];
  water_sources: FeatureOption[];
  power_meter_types: FeatureOption[];
  compound_types: FeatureOption[];
};

/**
 * Cached for the tab's lifetime.
 *
 * This describes the product's vocabulary, not anybody's data — it changes when
 * the code changes, so re-fetching it per form would be a request that always
 * returns the same answer.
 */
let cached: Promise<PropertyVocabulary> | null = null;

export function loadPropertyVocabulary(): Promise<PropertyVocabulary> {
  if (!cached) {
    // `apiFetch`, not `authedFetch`: the listing browser needs this while signed
    // out, and it describes the product's vocabulary rather than anyone's data.
    cached = apiFetch<PropertyVocabulary>("/property-types/").catch((cause) => {
      // Not cached on failure, so a dropped connection does not leave the form
      // permanently empty for the rest of the session.
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
