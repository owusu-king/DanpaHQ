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
import { Suspense, useRef } from "react";

import { Notice } from "@/components/Notice";
import { PropertyWizardModal } from "@/components/property/PropertyWizard";
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
  const finished = useRef<string | null>(null);
  const propertyId = search.get("propertyId") ?? "";

  if (!propertyId) {
    return (
      <div className="ws-page lease-wizard-page">
        <Notice tone="info" title="Choose a property first" body="Open a property from your Portfolio to carry on with it." />
        <p><Link href="/properties">All properties</Link></p>
      </div>
    );
  }

  const back = () => router.push((finished.current
    ? `/record/property-verify?id=${encodeURIComponent(finished.current)}`
    : `/record/property?id=${propertyId}`) as never);
  return (
    <div className="ws-page lease-wizard-page">
      <WorkspaceHead icon="properties" title="Property setup" />
      <PropertyWizardModal
        open
        propertyId={propertyId}
        startAt={search.get("step")}
        onClose={back}
        onFinished={(id) => { finished.current = id; }}
      />
    </div>
  );
}
