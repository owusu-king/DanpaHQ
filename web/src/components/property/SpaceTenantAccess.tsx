"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { LeaseWizardModal, type LeaseSpec } from "@/components/leases/LeaseWizard";
import { Notice } from "@/components/Notice";
import { Icon, type IconName } from "@/components/portal/icons";
import { UnitPrivateAccess } from "@/components/property/UnitPrivateAccess";
import { type AccessCodeState, type Lease } from "@/lib/console";

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

/**
 * The way into preparing an agreement for an accepted request.
 *
 * It used to navigate to `/record/lease-new`, which took the provider away from the
 * request they had just accepted. The wizard opens in place now: handed to the
 * modal the request is already in (`onOpen`), or in a sheet of its own when the
 * request is on its own page. `/record/lease-new` still works for a direct link.
 */
export function LeasePreparationForm({
  unitId,
  bedId,
  tenantId,
  source,
  initialRentMinor = 0,
  initialAdvanceMonths = 1,
  context,
  lease,
  label = "Prepare agreement",
  icon = "leases",
  variant = "primary",
  onOpen,
  onDone,
}: {
  unitId: string;
  bedId: string | null;
  tenantId: string;
  source: { kind: "join_request" | "application"; id: string; listingId?: string };
  initialRentMinor?: number;
  initialAdvanceMonths?: number;
  context?: LeaseSpec["context"];
  lease?: Lease | null;
  label?: string;
  icon?: IconName;
  variant?: "primary" | "secondary";
  onOpen?: (spec: LeaseSpec) => void;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const spec: LeaseSpec = { unitId, bedId, tenantId, source, initialRentMinor, initialAdvanceMonths, context, lease };

  return (
    <>
      <Button variant={variant} onClick={() => (onOpen ? onOpen(spec) : setOpen(true))}>
        <Icon name={icon} />{label}
      </Button>
      {onOpen ? null : (
        <LeaseWizardModal open={open} spec={spec} onClose={() => setOpen(false)} onSent={() => onDone()} />
      )}
    </>
  );
}
