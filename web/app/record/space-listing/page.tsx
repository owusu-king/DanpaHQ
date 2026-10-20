"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ListingComposer } from "@/components/property/ListingComposer";
import { EntityHeader, EntityPath } from "@/components/property/WorkspacePatterns";
import { ApiFailure } from "@/lib/api";
import { getUnit, type UnitDetail } from "@/lib/console";

export default function NewUnitListingPage() {
  const search = useSearchParams();
  const propertyId = search.get("propertyId") ?? "";
  const spaceId = search.get("spaceId") ?? "";
  const router = useRouter();
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!spaceId) return;
    getUnit(spaceId)
      .then(setUnit)
      .catch((cause) => setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Unit."));
  }, [spaceId]);

  if (!propertyId || !spaceId) {
    return <Notice tone="info" title="Choose a Unit first" body="Open a Unit from a property before creating its public listing." />;
  }

  if (error) return <Notice tone="error" title={error} body="Return to the Unit and try again." />;
  if (!unit) return <LoadingRows rows={5} />;

  const unitPath = `/record/space?propertyId=${propertyId}&spaceId=${spaceId}`;
  return (
    <div>
      <EntityPath items={[
        { label: "Properties", href: "/properties" },
        { label: unit.property.title || "Property", href: `/record/property?id=${propertyId}` },
        { label: unit.label || "Unit", href: unitPath },
        { label: "Publish" },
      ]} />
      <EntityHeader
        eyebrow="Public listing"
        title={`Publish ${unit.label || "this Unit"}`}
        subtitle="Set the public description and move-in amount. The Unit’s verified photos and Property context are added automatically."
      />
      <ListingComposer unitId={unit.id} onCreated={async () => router.replace(unitPath as never)} />
    </div>
  );
}
