"use client";

/**
 * Carrying on with a property's setup, at an address.
 *
 * Normally a sheet over Properties or the property itself. This route keeps the
 * links that name a step — `?step=documents` from the verification page — and
 * renders the same wizard, opened on that step.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Notice } from "@/components/Notice";
import { PropertyWizard } from "@/components/property/PropertyWizard";
import { WorkspaceHead } from "@/components/workspace/Workspace";

export default function PropertySetupPage() {
  return (
    <Suspense fallback={<div className="ws-page lease-wizard-page" aria-busy="true" />}>
      <PropertySetup />
    </Suspense>
  );
}

function PropertySetup() {
  const router = useRouter();
  const search = useSearchParams();
  const propertyId = search.get("propertyId") ?? "";

  if (!propertyId) {
    return (
      <div className="ws-page lease-wizard-page">
        <Notice tone="info" title="Choose a property first" body="Open a property from your Portfolio to carry on with it." />
        <p><Link href="/properties">All properties</Link></p>
      </div>
    );
  }

  const back = () => router.push(`/record/property?id=${propertyId}` as never);
  return (
    <div className="ws-page lease-wizard-page">
      <WorkspaceHead icon="properties" title="Property setup" summary="Saved as you go." />
      <section className="ws-panel creation-frame">
        <PropertyWizard
          propertyId={propertyId}
          startAt={search.get("step")}
          onClose={back}
          onFinished={(id) => router.push(`/properties?created=${encodeURIComponent(id)}` as never)}
        />
      </section>
    </div>
  );
}
