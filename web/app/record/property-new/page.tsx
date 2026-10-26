"use client";

/**
 * Creating a property, at an address.
 *
 * The flow normally opens as a sheet over Properties. This route keeps a direct
 * link working — "Create property" in setup checklists, the tenants page — and
 * renders the same wizard in the page, so the journey never depends on which
 * way in was used.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { PropertyWizard } from "@/components/property/PropertyWizard";
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
        summary="Saved as you go. Private until you send it for checking."
      />
      <section className="ws-panel creation-frame">
        <PropertyWizard
          purpose={selling ? "sale" : "letting"}
          organizationId={search.get("organization")}
          onClose={() => router.push("/properties" as never)}
          onFinished={(id) => router.push(`/properties?created=${encodeURIComponent(id)}` as never)}
        />
      </section>
    </div>
  );
}
