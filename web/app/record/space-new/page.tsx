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
import { usePageTitle } from "@/components/PageTitle";
import { UnitWizard } from "@/components/property/UnitWizard";
import { UnitWizardModal } from "@/components/property/UnitWizardModal";
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
  const unitId = search.get("unitId");
  const finishedUnit = useRef<string | null>(null);
  const title = unitId ? "Edit Unit" : "Add Unit";
  usePageTitle(title);

  const returnToRecord = () => {
    const destinationUnit = finishedUnit.current ?? unitId;
    router.replace((destinationUnit
      ? `/record/space?propertyId=${propertyId}&spaceId=${destinationUnit}`
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
      <WorkspaceHead icon="units" title={title} />
      <UnitWizardModal
        open
        propertyId={propertyId}
        wizard={UnitWizard}
        {...(unitId ? { mode: "edit", unitId, startAt: search.get("step") } : { mode: "create" })}
        onClose={returnToRecord}
        onFinished={(unit) => { finishedUnit.current = unit.id; }}
      />
    </div>
  );
}
