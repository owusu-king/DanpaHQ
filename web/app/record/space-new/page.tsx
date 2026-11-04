"use client";

/**
 * Adding a Unit, at an address.
 *
 * Direct and bookmarked setup links use the same modal as the Unit record.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef } from "react";

import { Notice } from "@/components/Notice";
import { UnitWizardModal } from "@/components/property/UnitWizard";
import { WorkspaceHead } from "@/components/workspace/Workspace";

export default function NewSpacePage() {
  return (
    <Suspense fallback={<div className="ws-page lease-wizard-page" aria-busy="true" />}>
      <NewSpace />
    </Suspense>
  );
}

function NewSpace() {
  const router = useRouter();
  const search = useSearchParams();
  const propertyId = search.get("propertyId") ?? "";
  const finishedUnit = useRef<string | null>(null);

  const returnToRecord = () => {
    const unitId = finishedUnit.current ?? search.get("unitId");
    router.replace((unitId
      ? `/record/space?propertyId=${propertyId}&spaceId=${unitId}`
      : `/record/property?id=${propertyId}`) as never);
  };

  if (!propertyId) {
    return (
      <div className="ws-page lease-wizard-page">
        <Notice tone="info" title="Choose a property first" body="Open a property before adding a Unit to it." />
        <p><Link href="/properties">All properties</Link></p>
      </div>
    );
  }

  return (
    <div className="ws-page lease-wizard-page">
      <WorkspaceHead icon="units" title={search.get("unitId") ? "Unit setup" : "Add Unit"} />
      <UnitWizardModal
        open
        propertyId={propertyId}
        unitId={search.get("unitId")}
        startAt={search.get("step")}
        onClose={returnToRecord}
        onFinished={(unit) => { finishedUnit.current = unit.id; returnToRecord(); }}
      />
    </div>
  );
}
