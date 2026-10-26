import { SegmentedField, type FilterOption } from "@/components/filters/FilterFields";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard, SheetGlassButton, SheetPrimaryButton } from "@/components/sheet/SheetParts";

import type { ExploreMode } from "./ExploreHero";

/**
 * What Explore shows — everything, rentals, or properties for sale — as the
 * first row of every Filters sheet (owner, 2026-10-05: the All / Rent / Buy bar
 * above the search is gone; "those operations can be added to the main
 * filter"). The twin of the web console's Show chip.
 */
const SHOW_OPTIONS: FilterOption<ExploreMode>[] = [
  { value: "all", label: "All" },
  { value: "rent", label: "To rent" },
  { value: "buy", label: "To buy" },
];

export function ShowField({ mode, onChange }: { mode: ExploreMode; onChange: (mode: ExploreMode) => void }) {
  return <SegmentedField label="Show" value={mode} options={SHOW_OPTIONS} onChange={onChange} />;
}

/** The kinds both sides share: hostels are only let, land only sold. */
export const ALL_TYPES: FilterOption<string>[] = [
  { value: "", label: "Any" },
  { value: "residential", label: "Homes" },
  { value: "commercial", label: "Commercial" },
];

const ALL_BEDROOMS: FilterOption<string>[] = [
  { value: "", label: "Any" },
  { value: "1", label: "1+" },
  { value: "2", label: "2+" },
  { value: "3", label: "3+" },
];

/**
 * All's filters: the questions rentals and sales answer the same way. Each
 * side's own — rent and advance, budget and tenure — arrive with To rent or
 * To buy, chosen in the first row.
 */
export function AllFilterSheet({
  visible,
  onClose,
  onModeChange,
  type,
  onTypeChange,
  bedrooms,
  onBedroomsChange,
  resultLabel,
}: {
  visible: boolean;
  onClose: () => void;
  onModeChange: (mode: ExploreMode) => void;
  /** Absent where the screen has no shared filters (a build without a map). */
  type?: string;
  onTypeChange?: (value: string) => void;
  bedrooms?: string;
  onBedroomsChange?: (value: string) => void;
  resultLabel: string;
}) {
  const shared = onTypeChange && onBedroomsChange;
  const canClear = Boolean(type || bedrooms);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      hideTitle
      closeLabel="Close filters"
      footer={(
        <>
          <SheetGlassButton
            label="Clear all"
            icon="refresh"
            disabled={!canClear}
            onPress={() => { onTypeChange?.(""); onBedroomsChange?.(""); }}
          />
          <SheetPrimaryButton label={resultLabel} onPress={onClose} />
        </>
      )}
    >
      <SheetCard>
        <ShowField mode="all" onChange={onModeChange} />
      </SheetCard>
      {shared ? (
        <AllFilterCards type={type ?? ""} onTypeChange={onTypeChange} bedrooms={bedrooms ?? ""} onBedroomsChange={onBedroomsChange} />
      ) : null}
    </BottomSheet>
  );
}

/** All's two shared questions, without a sheet: the one Filters sheet hosts them. */
export function AllFilterCards({
  type,
  onTypeChange,
  bedrooms,
  onBedroomsChange,
}: {
  type: string;
  onTypeChange: (value: string) => void;
  bedrooms: string;
  onBedroomsChange: (value: string) => void;
}) {
  return (
    <SheetCard>
      <SegmentedField label="Type" value={type} options={ALL_TYPES} onChange={onTypeChange} />
      <SegmentedField label="Bedrooms" value={bedrooms} options={ALL_BEDROOMS} onChange={onBedroomsChange} />
    </SheetCard>
  );
}
