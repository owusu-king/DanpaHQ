"use client";

import { Select } from "@/components/Select";
import type { FeatureOption } from "@/lib/propertyTypes";

/**
 * To let, or for sale — a compact dropdown (owner, 2026-10-05: two cards for a
 * two-way choice was "unnecessary"). Asked first because it decides everything
 * after it, and fixed once the property exists.
 *
 * A property for sale is sold whole: it takes no Units, and it is advertised as
 * itself the moment its verification passes (owner, 2026-09-28).
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
      options={[["letting", "To let"], ["sale", "For sale"]] as const}
      hint="Can’t be changed later."
    />
  );
}

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
      value={value}
      onChange={onChange}
      options={[["", "Choose one"] as const, ...types.map((type) => [type.value, type.label] as const)]}
    />
  );
}
