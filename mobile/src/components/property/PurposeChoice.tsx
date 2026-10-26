import { Select } from "@/components/form/Select";
import type { FeatureOption } from "@/propertyTypes";

/**
 * To let, or for sale — one compact field (owner, 2026-10-05: two cards for a
 * two-way choice was "unnecessary"). Asked first because it decides everything
 * after it, and fixed once the property exists.
 *
 * A property for sale is sold whole, takes no Units, and goes public by itself
 * once verified (owner, 2026-09-28). The twin of the web `PurposeChoice.tsx`.
 */
export function PurposeChoice({
  value,
  onChange,
}: {
  value: "letting" | "sale";
  onChange: (next: "letting" | "sale") => void;
}) {
  return (
    <Select
      label="Purpose"
      value={value}
      onChange={(next) => onChange(next as "letting" | "sale")}
      options={[
        { value: "letting", label: "To let", detail: "Units, rooms or beds, each let to a tenant" },
        { value: "sale", label: "For sale", detail: "Sold whole · can’t be changed later" },
      ]}
    />
  );
}

const SALE_HOLDS: Record<string, string> = {
  residential: "Bedrooms and bathrooms",
  commercial: "Its use and floor area",
  land: "Its size and a site plan",
};

/** What is being sold, from the backend's own sale vocabulary. */
export function SaleTypeChoice({
  types,
  value,
  onChange,
}: {
  types: FeatureOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Select
      label="What you’re selling"
      placeholder="Choose one"
      value={value}
      onChange={onChange}
      options={types.map((type) => ({
        value: type.value,
        label: type.label,
        detail: SALE_HOLDS[type.value],
      }))}
    />
  );
}
