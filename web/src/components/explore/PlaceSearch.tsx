"use client";

import { useEffect, useState } from "react";
import { LocationAutocomplete } from "@/components/property/LocationAutocomplete";
import type { ExploreArea } from "@/lib/exploreQuery";
import type { ResolvedPlace } from "@/lib/places";

/** Search our listings database. Typing never calls an external place service. */
export function PlaceSearch({ area, text, onSubmitText, onClear, label = "Search by location or property" }: {
  area: ExploreArea | null;
  text: string;
  // Kept for existing callers and saved area URLs; new searches use plain text.
  onChoosePlace: (place: ResolvedPlace) => void;
  onSubmitText: (text: string) => void;
  onClear: () => void;
  label?: string;
}) {
  const committed = area?.name ?? text;
  const [draft, setDraft] = useState(committed);
  useEffect(() => { setDraft(committed); }, [committed]);
  return <LocationAutocomplete compact label={label} value={draft} onChange={setDraft}
    onSelect={(row) => { setDraft(row.name); onSubmitText(row.name); }}
    onSubmit={(value) => onSubmitText(value)} onClear={() => { setDraft(""); onClear(); }} />;
}
