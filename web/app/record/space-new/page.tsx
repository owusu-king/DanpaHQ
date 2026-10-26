"use client";

/**
 * Adding a Unit, at an address.
 *
 * Normally a sheet over the property. This route keeps "Add Unit" links from
 * the Units workspace and a half-finished Unit's "carry on" link working, with
 * the same wizard in the page.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Notice } from "@/components/Notice";
import { UnitWizard } from "@/components/property/UnitWizard";
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
      <WorkspaceHead icon="units" title="Add Unit" summary="Saved as you go." />
      <section className="ws-panel creation-frame">
        <UnitWizard
          propertyId={propertyId}
          unitId={search.get("unitId")}
          startAt={search.get("step")}
          onClose={() => router.push(`/record/property?id=${propertyId}` as never)}
          onFinished={(unit) => router.push(`/record/space?propertyId=${propertyId}&spaceId=${unit.id}` as never)}
        />
      </section>
    </div>
  );
}
