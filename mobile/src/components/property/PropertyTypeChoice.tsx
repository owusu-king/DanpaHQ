import { Select } from "@/components/form/Select";
import type { PropertyTypeOption } from "@/propertyTypes";

/**
 * What kind of property this is: one compact field that opens the three
 * answers (owner, 2026-10-05: "it needs to be a dropdown for selection").
 *
 * Each answer still says what it can hold — from the API's own `space_types`,
 * not from copy written here — but in the sheet, under its name, rather than as
 * three tall cards on the form.
 *
 * The twin of `web/src/components/property/PropertyTypeChoice.tsx`.
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
  return (
    <Select
      label="Property type"
      placeholder="Choose a type"
      value={value}
      onChange={onChange}
      options={types.map((type) => ({
        value: type.value,
        label: type.label,
        detail: `Holds: ${type.space_types.map((space) => space.label).join(" · ")}`,
      }))}
    />
  );
}
