"use client";

/**
 * Creating a property, at an address.
 *
 * The flow normally opens as a sheet over Properties. This route keeps a direct
 * link working — "Create property" in setup checklists, the tenants page — and
 * opens the same modal as the Portfolio.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { PropertyWizardModal } from "@/components/property/PropertyWizard";
import { WorkspaceHead } from "@/components/workspace/Workspace";

export default function NewPropertyPage() {
  return (
    <Suspense fallback={<div className="ws-page lease-wizard-page" aria-busy="true" />}>
      <NewProperty />
    </Suspense>
  );
}

function NewProperty() {
  const router = useRouter();
  const search = useSearchParams();
  const selling = search.get("purpose") === "sale";

  return (
    <div className="ws-page lease-wizard-page">
      <WorkspaceHead
        icon="properties"
        title={selling ? "Sell a property" : "New property"}
      />
      <PropertyWizardModal
        open
        purpose={selling ? "sale" : "letting"}
        organizationId={search.get("organization")}
        onClose={() => router.replace("/properties")}
        onFinished={() => undefined}
      />
    </div>
  );
}
