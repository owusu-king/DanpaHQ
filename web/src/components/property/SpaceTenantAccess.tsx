"use client";

import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { UnitPrivateAccess } from "@/components/property/UnitPrivateAccess";
import { type AccessCodeState } from "@/lib/console";

/**
 * Private acquisition starts with one verified Unit access code.
 *
 * The code itself is `UnitPrivateAccess`, so the Tenants tab and the Unit's own
 * page say the same thing about the same Unit. What is left here is the context
 * the Tenants tab needs and the Unit page gets from its own header.
 */
export function SpaceTenantAccess({
  unitId,
  accessCode,
  conditionState,
  availabilityState,
  onAccessCodeChanged,
}: {
  unitId: string;
  accessCode: AccessCodeState;
  conditionState: string;
  availabilityState: string;
  onAccessCodeChanged: () => Promise<void>;
}) {
  const verified = conditionState === "approved";
  const occupied = availabilityState === "occupied";

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      {!verified ? (
        <Notice
          tone="info"
          title="This Unit has not been checked yet"
          body="Send its photographs for review. A private access code becomes available once the Unit is verified."
        />
      ) : null}
      <UnitPrivateAccess
        unitId={unitId}
        accessCode={accessCode}
        verified={verified}
        occupied={occupied}
        onChanged={onAccessCodeChanged}
      />
    </div>
  );
}

export function LeasePreparationForm({
  unitId,
  bedId,
  tenantId,
  source,
  initialRentMinor = 0,
  initialAdvanceMonths = 1,
  onDone,
}: {
  unitId: string;
  bedId: string | null;
  tenantId: string;
  source: { kind: "join_request" | "application"; id: string; listingId?: string };
  initialRentMinor?: number;
  initialAdvanceMonths?: number;
  onDone: () => Promise<void>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function openBuilder() {
    const params = new URLSearchParams({
      unitId,
      tenantId,
      sourceKind: source.kind,
      sourceId: source.id,
      rentMinor: String(initialRentMinor),
      advanceMonths: String(initialAdvanceMonths),
      returnTo: pathname,
    });
    if (bedId) params.set("bedId", bedId);
    if (source.listingId) params.set("listingId", source.listingId);
    router.push(`/leases/new?${params.toString()}` as never);
  }

  // Completion happens on the dedicated route; retain the callback in this
  // public component contract for existing callers until they migrate.
  void onDone;

  return (
    <Button variant="secondary" onClick={openBuilder}>Prepare agreement</Button>
  );
}
