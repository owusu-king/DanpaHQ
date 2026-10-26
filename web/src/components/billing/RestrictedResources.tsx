"use client";

import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/billing/CurrentPlan";
import type { PortfolioBilling, RestrictedResource } from "@/lib/billing";
import { accessStatusOf, allowanceLine } from "@/lib/billingPresentation";

/**
 * What this Portfolio holds above its plan's allowance, and the way back.
 *
 * Restricted is not removed. Every row keeps its records, and one winding down
 * keeps its running tenancies to their end. Reactivating is the deliberate step
 * an upgrade or a freed place makes possible: the button appears only where the
 * server says there is room, and the server decides again when it is pressed.
 */
export function RestrictedResources({
  billing,
  busyId,
  onReactivate,
}: {
  billing: PortfolioBilling;
  busyId: string | null;
  onReactivate: (resource: RestrictedResource) => void;
}) {
  const access = billing.resource_access;
  if (!access?.restricted.length) return null;

  const room = { property: access.properties.available, unit: access.units.available };
  const hasRoom = (kind: RestrictedResource["kind"]) => room[kind] === null || (room[kind] ?? 0) > 0;
  const canChange = billing.viewer.can_change_plan;
  const anyRoom = access.restricted.some((resource) => hasRoom(resource.kind));

  return (
    <section className="billing-section billing-restricted" aria-labelledby="billing-restricted-title">
      <div className="billing-restricted-head">
        <h3 id="billing-restricted-title">Above your plan&apos;s limits</h3>
        <p>
          {allowanceLine(access.properties, "Properties")} · {allowanceLine(access.units, "Units")}
        </p>
      </div>
      <ul className="billing-restricted-list">
        {access.restricted.map((resource) => {
          const status = accessStatusOf(resource.state);
          return (
            <li key={`${resource.kind}:${resource.id}`} className="billing-restricted-row">
              <div className="billing-restricted-what">
                <p className="billing-restricted-name">
                  {resource.name}
                  {resource.kind === "unit" ? <span> · {resource.property_name}</span> : null}
                </p>
                <p className="billing-restricted-meta">
                  {resource.state === "wind_down"
                    ? "Existing tenancies continue · no new rental activity"
                    : "Records stay available · no new rental activity"}
                </p>
              </div>
              <StatusBadge tone={status.tone} label={status.label} />
              <div className="billing-restricted-action">
                {canChange && hasRoom(resource.kind) ? (
                  <Button
                    variant="secondary"
                    busy={busyId === resource.id}
                    busyLabel="Reactivating…"
                    disabled={busyId !== null}
                    onClick={() => onReactivate(resource)}
                  >
                    Reactivate
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canChange && !anyRoom ? (
        <p className="billing-restricted-note">
          To reactivate one, upgrade — or archive something that is fully active to free its place.
        </p>
      ) : null}
    </section>
  );
}
