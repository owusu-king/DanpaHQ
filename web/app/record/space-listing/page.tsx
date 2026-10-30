"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ListingComposer } from "@/components/property/ListingComposer";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { getUnit, listMyListings, type Listing, type UnitDetail } from "@/lib/console";

export default function NewUnitListingPage() {
  const search = useSearchParams();
  const propertyId = search.get("propertyId") ?? "";
  const spaceId = search.get("spaceId") ?? "";
  const router = useRouter();
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [error, setError] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!spaceId) return;
    getUnit(spaceId)
      .then(async (value) => {
        const rows = value.publication.listing_id ? await listMyListings() : [];
        setListing(rows.find((row) => row.id === value.publication.listing_id) ?? null);
        setUnit(value);
      })
      .catch((cause) => setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Unit."));
  }, [spaceId]);

  if (!propertyId || !spaceId) {
    return <Notice tone="info" title="Choose a Unit first" body="Open a Unit from a property before creating its public listing." />;
  }

  if (error) return <Notice tone="error" title={error} body="Return to the Unit and try again." />;
  if (!unit) return <LoadingRows rows={5} />;

  const unitPath = `/record/space?propertyId=${propertyId}&spaceId=${spaceId}`;
  return (
    <ModalSheet open onClose={() => { if (!busy) router.replace(unitPath as never); }} title="Publish to Explore" icon="units" size="sm" dismissible={false} className="compact-action-sheet">
      <ListingComposer unitId={unit.id} listing={listing} onBusyChange={setBusy} onCreated={async () => router.replace(unitPath as never)} />
    </ModalSheet>
  );
}
