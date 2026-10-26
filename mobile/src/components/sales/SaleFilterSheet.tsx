/**
 * Buy's filters, as a sheet: what kind of property, rooms for a house, the
 * budget, the tenure and the order. Used by Explore's map view on Buy, and
 * shaped like Rent's so the two sides read as one Explore.
 */

import { useEffect, useState } from "react";

import { SegmentedField, SelectField } from "@/components/filters/FilterFields";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard, SheetGlassButton, SheetPrimaryButton } from "@/components/sheet/SheetParts";
import type { ExploreMode } from "@/components/explore/ExploreHero";
import { ShowField } from "@/components/explore/ExploreShow";
import type { SaleFilters, SaleKind, SaleSort, Tenure } from "@/sales";

export type SaleChoices = {
  kind: "" | SaleKind;
  bedrooms: string;
  budget: string;
  tenure: string;
  sort: SaleSort;
};

export const NO_SALE_CHOICES: SaleChoices = { kind: "", bedrooms: "", budget: "", tenure: "", sort: "newest" };

/** How many filters are on, for the Filters button's count. */
export function saleRefinements(choices: SaleChoices): number {
  return [
    choices.kind,
    choices.budget,
    choices.tenure,
    choices.kind === "residential" ? choices.bedrooms : "",
    choices.sort !== "newest" ? choices.sort : "",
  ].filter(Boolean).length;
}

/** The API's filters from the choices; rooms mean nothing for land or a shop. */
export function saleFiltersFrom(choices: SaleChoices): SaleFilters {
  return {
    kind: choices.kind || undefined,
    price_max: choices.budget ? Number(choices.budget) : undefined,
    bedrooms_min: choices.kind === "residential" && choices.bedrooms ? Number(choices.bedrooms) : undefined,
    tenure: (choices.tenure as Tenure) || undefined,
    sort: choices.sort === "newest" ? undefined : choices.sort,
  };
}

const KINDS = [
  { value: "", label: "All" },
  { value: "residential", label: "Houses" },
  { value: "commercial", label: "Commercial" },
  { value: "land", label: "Land" },
];

/** Cedis, sent as pesewas. Upper bounds only: "what can I afford" is the question. */
const BUDGETS = [
  { value: "", label: "Any budget" },
  { value: "20000000", label: "Up to GH₵200k" },
  { value: "50000000", label: "Up to GH₵500k" },
  { value: "100000000", label: "Up to GH₵1m" },
  { value: "250000000", label: "Up to GH₵2.5m" },
  { value: "500000000", label: "Up to GH₵5m" },
];

const TENURES = [
  { value: "", label: "Any tenure" },
  { value: "freehold", label: "Freehold" },
  { value: "leasehold", label: "Leasehold" },
  { value: "customary", label: "Customary land" },
];

const BEDROOMS = [
  { value: "", label: "Any" },
  { value: "1", label: "1+" },
  { value: "2", label: "2+" },
  { value: "3", label: "3+" },
  { value: "4", label: "4+" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

type Menu = "budget" | "tenure" | "sort";

export function SaleFilterSheet({
  visible,
  onClose,
  choices,
  onChange,
  resultLabel,
  onModeChange,
}: {
  visible: boolean;
  onClose: () => void;
  /** Show (All / To rent / To buy), the sheet's first row. */
  onModeChange?: (mode: ExploreMode) => void;
  choices: SaleChoices;
  onChange: (patch: Partial<SaleChoices>) => void;
  resultLabel: string;
}) {
  // One dropdown open at a time, and none left open when the sheet comes back.
  const [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => {
    if (!visible) setMenu(null);
  }, [visible]);
  const toggle = (next: Menu) => setMenu((current) => (current === next ? null : next));

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
            disabled={!saleRefinements(choices)}
            onPress={() => onChange(NO_SALE_CHOICES)}
          />
          <SheetPrimaryButton label={resultLabel} onPress={onClose} />
        </>
      )}
    >
      {onModeChange ? (
        <SheetCard>
          <ShowField mode="buy" onChange={onModeChange} />
        </SheetCard>
      ) : null}
      <SaleFilterCards choices={choices} onChange={onChange} />
    </BottomSheet>
  );
}

/**
 * Buy's questions, without a sheet around them: Explore's one Filters sheet
 * hosts them under its Show row (owner, 2026-10-05).
 */
export function SaleFilterCards({
  choices,
  onChange,
}: {
  choices: SaleChoices;
  onChange: (patch: Partial<SaleChoices>) => void;
}) {
  // One dropdown open at a time.
  const [menu, setMenu] = useState<Menu | null>(null);
  const toggle = (next: Menu) => setMenu((current) => (current === next ? null : next));
  return (
    <>
      <SheetCard>
        <SegmentedField label="What" value={choices.kind} options={KINDS} onChange={(value) => onChange({ kind: value as "" | SaleKind })} />
        {choices.kind === "residential" ? (
          <SegmentedField label="Bedrooms" value={choices.bedrooms} options={BEDROOMS} onChange={(value) => onChange({ bedrooms: value })} />
        ) : null}
      </SheetCard>
      <SheetCard>
        <SelectField
          label="Budget"
          value={choices.budget}
          options={BUDGETS}
          open={menu === "budget"}
          onToggle={() => toggle("budget")}
          onChange={(value) => { onChange({ budget: value }); setMenu(null); }}
        />
        <SelectField
          label="Tenure"
          value={choices.tenure}
          options={TENURES}
          open={menu === "tenure"}
          onToggle={() => toggle("tenure")}
          onChange={(value) => { onChange({ tenure: value }); setMenu(null); }}
        />
      </SheetCard>
      <SheetCard>
        <SelectField
          label="Sort by"
          value={choices.sort}
          options={SORTS}
          open={menu === "sort"}
          onToggle={() => toggle("sort")}
          onChange={(value) => { onChange({ sort: value as SaleSort }); setMenu(null); }}
        />
      </SheetCard>
    </>
  );
}
