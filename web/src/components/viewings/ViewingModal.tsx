"use client";

/**
 * A viewing opened from the agenda, over the agenda.
 *
 * The record is the same one its own page shows, so every decision — offer
 * times, confirm, check in, cancel, report attendance — is made here without
 * leaving the list. The page owns the list; `onChanged` reloads it, and the
 * sheet reads the fresh viewing back from it. The last viewing shown is held
 * so the sheet can play its exit after the page has let it go.
 */

import { useState } from "react";

import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ProviderViewingRecord } from "@/components/viewings/ProviderViewingRecord";
import type { Viewing } from "@/lib/console";

export function ViewingModal({
  viewing,
  onClose,
  onChanged,
}: {
  viewing: Viewing | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [shown, setShown] = useState<Viewing | null>(viewing);
  // Adjusted while rendering rather than in an effect, so a reload shows the
  // new state in the same frame and a close keeps the old one for the exit.
  if (viewing && viewing !== shown) setShown(viewing);
  const current = viewing ?? shown;
  if (!current) return null;

  const place = [current.property_title, current.unit_label].filter(Boolean).join(" · ");

  return (
    <ModalSheet
      open={Boolean(viewing)}
      onClose={onClose}
      icon="viewings"
      title={current.tenant_name}
      meta={place || current.listing_headline}
      className="host-viewing-sheet"
      size="sm"
      closeLabel="Close viewing"
    >
      <ProviderViewingRecord key={current.id} viewing={current} onChanged={onChanged} />
    </ModalSheet>
  );
}
