"use client";

/**
 * A tenancy opened from its card, over the Tenants page.
 *
 * The card already showed the person; this does not show them again as a card.
 * One quiet line says who and where, then what the card left out, in the order
 * a manager reads it: anything that needs doing, the rent in three figures, how
 * far through the lease they are, and the home it is for. The two things done
 * from here are at the foot, and both leave for their own page: the tenant's
 * payments, and the tenancy page (which holds the agreement). Nothing opens a
 * second sheet, or a view inside this one.
 *
 * Colour is kept for meaning: gold for money outstanding, red for overdue, the
 * brand green for the one primary action. Everything else is ink on glass.
 */

import Link from "next/link";
import { useState } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import type { ProviderTenant } from "@/lib/console";
import { formatMoney } from "@/lib/money";
import { initialsOf, leaseProgress, shortDate, tenancyState, tenantHome } from "@/lib/tenancyDisplay";

export function TenantModal({
  tenant,
  onClose,
}: {
  tenant: ProviderTenant | null;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [shown, setShown] = useState<ProviderTenant | null>(tenant);
  // Held while closing, so the sheet plays its exit with what it showed.
  if (tenant && tenant !== shown) setShown(tenant);
  const current = tenant ?? shown;
  if (!current) return null;

  return (
    <ModalSheet
      open={Boolean(tenant)}
      onClose={onClose}
      size="sm"
      icon="users"
      title="Tenancy"
      meta={`${current.property_title} · ${tenantHome(current)}`}
      className="tenant-sheet"
      closeLabel="Close tenancy"
    >
      <TenancyBody tenant={current} />
    </ModalSheet>
  );
}

function TenancyBody({ tenant }: { tenant: ProviderTenant }) {
  const state = tenancyState(tenant);
  const currency = tenant.lease_rent_currency ?? "GHS";
  const home = tenantHome(tenant);
  const progress = leaseProgress(tenant);
  const owed = tenant.rent.status === "overdue" ? tenant.rent.overdue_minor : tenant.rent.outstanding_minor;
  const needsAgreement = tenant.tenancy_status === "pending_lease" || !tenant.lease_id;
  const id = tenant.tenancy_id ?? tenant.occupancy_id;

  return (
    <div className="tm">
      <section className="tm-who" aria-label="Tenant">
        <span className="tm-avatar" aria-hidden="true">{initialsOf(tenant.name)}</span>
        <span className="tm-who-copy">
          <strong>{tenant.name}</strong>
          <span className="tenant-state" data-state={state.key}>{state.label}</span>
        </span>
      </section>

      {needsAgreement ? (
        <p className="tm-alert" data-tone="warning"><Icon name="leases" /><span><strong>Agreement needed</strong>Prepare it from the approved request.</span></p>
      ) : null}
      {tenant.rent.status === "overdue" ? (
        <p className="tm-alert" data-tone="critical"><Icon name="warning" /><span><strong>{formatMoney({ minor: tenant.rent.overdue_minor, currency })} overdue</strong>{tenant.rent.next_due_on ? `Next due ${shortDate(tenant.rent.next_due_on)}.` : "Review their payments."}</span></p>
      ) : null}

      <dl className="tm-figures">
        <div>
          <dt>Rent</dt>
          <dd>
            {tenant.lease_rent_minor === null ? "Not set" : formatMoney({ minor: tenant.lease_rent_minor, currency })}
            {tenant.lease_rent_minor === null ? null : <small> /{tenant.lease_rent_period === "yearly" ? "yr" : "mo"}</small>}
          </dd>
        </div>
        <div data-tone={tenant.rent.status}>
          <dt>{tenant.rent.status === "overdue" ? "Overdue" : "Owed"}</dt>
          <dd>{tenant.rent.status === "current" ? "Nothing" : formatMoney({ minor: owed, currency })}</dd>
        </div>
        <div>
          <dt>Next due</dt>
          <dd>{tenant.rent.next_due_on ? shortDate(tenant.rent.next_due_on) : "—"}</dd>
        </div>
      </dl>

      <section className="tm-lease" aria-label="Lease">
        <header>
          <strong>Lease</strong>
          {progress ? (
            <span>{progress.ended ? "Ended" : !progress.started ? "Not started" : `${progress.monthsLeft} month${progress.monthsLeft === 1 ? "" : "s"} left`}</span>
          ) : null}
        </header>
        {progress ? (
          <>
            <span className="tm-lease-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress.share * 100)}%` }} /></span>
            <span className="tm-lease-ends">
              <span>{shortDate(tenant.lease_starts_on!)}</span>
              <span>{shortDate(tenant.lease_ends_on!)}</span>
            </span>
          </>
        ) : (
          <p className="tm-quiet">{tenant.lease_id ? "Open-ended, or dates not recorded." : "No agreement yet."}</p>
        )}
      </section>

      <ul className="tm-links" aria-label="Home">
        <li>
          {/* No close first: leaving the page takes the sheet with it. */}
          <Link className="tm-link" href={`/record/space?propertyId=${tenant.property_id}&spaceId=${tenant.unit_id}` as never}>
            <LinkBody icon="units" label={home} detail="Unit" />
          </Link>
        </li>
        <li>
          <Link className="tm-link" href={`/record/property?id=${tenant.property_id}` as never}>
            <LinkBody icon="properties" label={tenant.property_title} detail="Property" />
          </Link>
        </li>
      </ul>

      {/* Two ways on, both to their own page — no close first: leaving the
          page takes the sheet with it. */}
      <div className="tm-actions">
        {tenant.lease_id ? (
          <Link className="btn btn-primary" href={`/record/payment?leaseId=${tenant.lease_id}` as never}>
            <Icon name="payments" />View payments
          </Link>
        ) : null}
        <Link className={`btn ${tenant.lease_id ? "btn-secondary" : "btn-primary"}`} href={`/record/tenant?tenancyId=${id}` as never}>
          <Icon name="users" />Open the tenancy page
        </Link>
      </div>
    </div>
  );
}

function LinkBody({ icon, label, detail }: { icon: IconName; label: string; detail: string }) {
  return (
    <>
      <span className="tm-link-mark" aria-hidden="true"><Icon name={icon} /></span>
      <span className="tm-link-copy"><strong>{label}</strong><small>{detail}</small></span>
      <svg className="tm-link-go" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
}
