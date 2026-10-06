"use client";

import { Select } from "@/components/Select";
import type { PropertyTypeOption } from "@/lib/propertyTypes";

/**
 * What kind of property this is — a compact dropdown (owner, 2026-10-05: "it
 * needs to be a dropdown for selection", replacing the three tiles).
 *
 * The choice still says what it allows, in one line under the field, and says
 * it from the API's own `space_types` rather than from copy written here — so
 * if the vocabulary gains a space type the line gains it too, and nothing can
 * describe a combination the backend would refuse (`space_rules`).
 */
export function PropertyTypeChoice({
  types,
  value,
  onChange,
}: {
  types: PropertyTypeOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  const chosen = types.find((type) => type.value === value);
  return (
    <Select
      label="Property type"
      value={value}
      onChange={onChange}
      options={[["", "Choose a type"] as const, ...types.map((type) => [type.value, type.label] as const)]}
      hint={chosen?.space_types.length ? `Holds: ${chosen.space_types.map((space) => space.label).join(" · ")}` : undefined}
    />
  );
}
