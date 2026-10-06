"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { LeaseWizard, type LeaseSpec } from "@/components/leases/LeaseWizard";
import { WorkspaceHead } from "@/components/workspace/Workspace";

/**
 * Preparing a tenancy agreement, at an address.
 *
 * The agreement is normally prepared in the request's own modal, which widens
 * into the wizard after acceptance. This route keeps a direct link working and
 * renders the same wizard, so the agreement never depends on which way in was
 * used — the same six stops, the same payload, the same backend rendering.
 *
 * **The provider supplies terms; Rooomly writes the agreement.** Standard
 * clauses belong to the versioned template and cannot be edited here. Custom
 * wording is a separate, clearly labelled section.
 *
 * **Ready and Sent are two different acts.** Generating marks the lease Ready;
 * sending is a separate deliberate press.
 */
export default function NewLeasePage() {
  return (
    <Suspense fallback={<div className="ws-page lease-wizard-page" aria-busy="true" />}>
      <LeaseBuilder />
    </Suspense>
  );
}

function LeaseBuilder() {
  const router = useRouter();
  const search = useSearchParams();
  const unitId = search.get("unitId");
  const tenantId = search.get("tenantId");
  const sourceId = search.get("sourceId");
  const returnTo = search.get("returnTo");

  const leave = () => (returnTo?.startsWith("/") ? router.push(returnTo as never) : router.back());

  if (!unitId || !tenantId || !sourceId) {
    return (
      <div className="ws-page lease-wizard-page">
        <WorkspaceHead icon="leases" title="Tenancy agreement" summary="Open an accepted tenancy request to prepare its agreement." />
      </div>
    );
  }

  const spec: LeaseSpec = {
    unitId,
    bedId: search.get("bedId"),
    tenantId,
    source: {
      kind: search.get("sourceKind") === "join_request" ? "join_request" : "application",
      id: sourceId,
      listingId: search.get("listingId") || undefined,
    },
    initialRentMinor: Number(search.get("rentMinor")) || 0,
    initialAdvanceMonths: Number(search.get("advanceMonths")) || 1,
  };

  return (
    <div className="ws-page lease-wizard-page">
      <WorkspaceHead icon="leases" title="Tenancy agreement" summary="Terms, rent and duties, then send it to the tenant." />
      <section className="ws-panel lease-wizard-frame">
        <LeaseWizard spec={spec} onExit={leave} exitLabel="Cancel" onDone={() => router.push("/documents?view=leases" as never)} />
      </section>
    </div>
  );
}
