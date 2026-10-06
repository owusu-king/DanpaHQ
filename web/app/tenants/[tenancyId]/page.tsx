"use client";

/**
 * One tenancy, at its own address — what the tenancy sheet on Tenants opens
 * into ("Open the tenancy page").
 *
 * Drawn in the workspace's vocabulary, the same as the sheet so the two read as
 * one record: the person in the head with where they live and how the tenancy
 * stands; a tinted card with the rent and where it stands, beside how far
 * through the lease they are; then the facts, and the records that hang off
 * the tenancy. Colour carries meaning only — laterite for overdue, harmattan
 * for money due or an agreement still needed, kola for paid up.
 *
 * The agreement opens over the page (a manager reading a tenant reads their
 * agreement without leaving them); their payments are a page of their own.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { LeaseModal } from "@/components/leases/LeaseModal";
import { Avatar, Icon, type IconName } from "@/components/portal/icons";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { getOrganizationPortfolio, listOrganizations, type ProviderTenant } from "@/lib/console";
import { formatMoney } from "@/lib/money";
import { useSession } from "@/lib/session";
import { leaseProgress, shortDate, tenancyState, tenantHome } from "@/lib/tenancyDisplay";

export default function ProviderTenancyPage() {
  const { tenancyId } = useParams<{ tenancyId: string }>();
  const { activeContext } = useSession();
  const [tenant, setTenant] = useState<ProviderTenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // The lease opens over this page: a manager reading a tenant reads their
  // agreement without leaving them. Local state, not the address, so Back
  // never brings it up again.
  const [leaseOpen, setLeaseOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const organizations = await listOrganizations();
        const preferredId = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
        const ordered = [...organizations].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
        for (const organization of ordered) {
          const portfolio = await getOrganizationPortfolio(organization.id);
          // A past tenant's record opens from the Archive too.
          const match = [...portfolio.tenants, ...(portfolio.past_tenants ?? [])]
            .find((row) => row.tenancy_id === tenancyId || row.occupancy_id === tenancyId);
          if (match) {
            if (!cancelled) setTenant(match);
            return;
          }
        }
        if (!cancelled) setTenant(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this tenancy.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeContext, tenancyId, attempt]);

  const path = (label: string) => (
    <EntityPath items={[{ label: "Tenants", href: "/tenants", mobileLabel: "Back to Tenants" }, { label }]} />
  );

  if (loading && !tenant) {
    return (
      <div className="ws-page tenancy-record">
        <WorkspaceHead icon="users" title="Tenancy" path={path("Tenancy")} />
        <section className="ws-panel" aria-busy="true" aria-label="Tenancy"><PanelSkeleton rows={4} round /></section>
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="ws-page tenancy-record">
        <WorkspaceHead icon="users" title={error ? "Tenancy" : "Tenancy not found"} path={path(error ? "Tenancy" : "Not found")} />
        <section className="ws-panel" aria-label="Tenancy">
          {error ? (
            <PanelState
              tone="error"
              icon="warning"
              title="This tenancy didn’t load"
              body={error}
              action={<button type="button" className="ws-action" onClick={() => setAttempt((current) => current + 1)}>Try again</button>}
            />
          ) : (
            <PanelState
              icon="users"
              title="This tenancy isn’t in your Portfolios"
              body="It may have ended, or it belongs to a Portfolio you no longer operate."
              action={<Link href="/tenants" className="ws-action is-primary">Back to Tenants</Link>}
            />
          )}
        </section>
      </div>
    );
  }

  const currency = tenant.lease_rent_currency ?? "GHS";
  const money = (minor: number) => formatMoney({ minor, currency });
  const state = tenancyState(tenant);
  const home = tenantHome(tenant);
  const progress = leaseProgress(tenant);
  const needsAgreement = state.key === "pending";
  const owed = tenant.rent.status === "overdue" ? tenant.rent.overdue_minor : tenant.rent.outstanding_minor;
  const position = tenant.rent.status === "current" ? "Paid up" : tenant.rent.status === "overdue" ? "Overdue" : "Payment due";

  return (
    <div className="ws-page tenancy-record tn-page">
      <WorkspaceHead
        icon="users"
        title={tenant.name}
        path={path(tenant.name)}
        mark={<span className="tenant-avatar is-large" aria-hidden="true"><Avatar name={tenant.name} size={44} photoUrl={tenant.avatar_url ?? null} /></span>}
        summary={(
          <>
            <span className="tenant-state" data-state={state.key}>{state.label}</span>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {tenant.property_title}
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {home}
          </>
        )}
        actions={tenant.lease_id ? (
          <>
            <Link href={`/payments/${tenant.lease_id}` as never} className="ws-action"><Icon name="payments" />Payments</Link>
            <button type="button" className="ws-action is-primary" aria-haspopup="dialog" onClick={() => setLeaseOpen(tenant.lease_id)}><Icon name="leases" />Open agreement</button>
          </>
        ) : null}
      />

      {needsAgreement ? (
        <Callout tone="warning" icon="leases" title="This tenancy needs a Rooomly agreement">
          Prepare the agreement from the approved request before treating this as an active platform tenancy.
        </Callout>
      ) : null}
      {tenant.rent.status === "overdue" ? (
        <Callout tone="critical" icon="warning" title={`${money(tenant.rent.overdue_minor)} is overdue`}>
          {tenant.rent.next_due_on ? `The next due date recorded is ${shortDate(tenant.rent.next_due_on)}.` : "Open their payments to review the rent record."}
        </Callout>
      ) : null}

      {/* The rent and where it stands, beside how far through the lease they are. */}
      <section className="tn-hero" data-tone={tenant.rent.status} aria-label="Rent and lease">
        <div className="tn-rent">
          <small>Rent</small>
          <strong>
            {tenant.lease_rent_minor === null ? "Not recorded" : money(tenant.lease_rent_minor)}
            {tenant.lease_rent_minor === null ? null : <span> / {tenant.lease_rent_period === "yearly" ? "year" : "month"}</span>}
          </strong>
          <span className="tn-position"><i aria-hidden="true" />{position}</span>
          <dl className="tn-figures">
            <div data-tone={tenant.rent.status === "current" ? undefined : tenant.rent.status}>
              <dt>{tenant.rent.status === "overdue" ? "Overdue" : "Owed"}</dt>
              <dd>{tenant.rent.status === "current" ? "Nothing" : money(owed)}</dd>
            </div>
            <div>
              <dt>Next due</dt>
              <dd>{tenant.rent.next_due_on ? shortDate(tenant.rent.next_due_on) : "Not scheduled"}</dd>
            </div>
          </dl>
        </div>
        <div className="tn-lease">
          <header>
            <small>Lease</small>
            <strong>
              {progress
                ? progress.ended ? "Ended" : !progress.started ? "Not started" : `${progress.monthsLeft} month${progress.monthsLeft === 1 ? "" : "s"} left`
                : tenant.lease_id ? "Open-ended" : "No agreement yet"}
            </strong>
          </header>
          {progress ? (
            <>
              <span className="tn-lease-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress.share * 100)}%` }} /></span>
              <span className="tn-lease-ends">
                <span>{shortDate(tenant.lease_starts_on!)}</span>
                <span>{shortDate(tenant.lease_ends_on!)}</span>
              </span>
            </>
          ) : (
            <p>{tenant.lease_id ? "Dates not recorded on the agreement." : "Prepare it from the approved request."}</p>
          )}
        </div>
      </section>

      <div className="tn-grid">
        <section className="tn-panel" aria-labelledby="tenancy-facts">
          <h2 className="tn-panel-title" id="tenancy-facts">Tenancy</h2>
          <dl className="tn-facts">
            <Fact icon="users" label="Status" value={state.label} />
            <Fact icon="leases" label="Agreement" value={tenant.lease_status ? humanize(tenant.lease_status) : "Not prepared"} />
            <Fact icon="clock" label="Starts" value={tenant.lease_starts_on ? shortDate(tenant.lease_starts_on) : "Not recorded"} />
            <Fact icon="clock" label="Ends" value={tenant.lease_ends_on ? shortDate(tenant.lease_ends_on) : "Open-ended"} />
            <Fact icon="payments" label="Rent" value={tenant.lease_rent_minor === null ? "Not recorded" : `${money(tenant.lease_rent_minor)} per ${tenant.lease_rent_period === "yearly" ? "year" : "month"}`} />
            <Fact icon="units" label="Home" value={`${tenant.property_title} · ${home}`} />
          </dl>
        </section>

        <aside className="tn-panel" aria-labelledby="tenancy-related">
          <h2 className="tn-panel-title" id="tenancy-related">Related records</h2>
          {/* The agreement and the payments are the head's two acts; listing
              them here as well would be the same action twice. */}
          <ul className="tn-links">
            <RelatedLink href={`/properties/${tenant.property_id}/spaces/${tenant.unit_id}`} icon="units" label={home} detail="Unit" />
            <RelatedLink href={`/properties/${tenant.property_id}`} icon="properties" label={tenant.property_title} detail="Property" />
            <RelatedLink href="/maintenance" icon="wrench" label="Maintenance" detail="Repairs reported across your Portfolio" />
          </ul>
        </aside>
      </div>

      <LeaseModal
        leaseId={leaseOpen}
        onClose={() => setLeaseOpen(null)}
        onChanged={() => setAttempt((current) => current + 1)}
      />
    </div>
  );
}

function Callout({ tone, icon, title, children }: { tone: "warning" | "critical"; icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <div className="tn-callout" data-tone={tone} role={tone === "critical" ? "alert" : "status"}>
      <span className="tn-callout-mark" aria-hidden="true"><Icon name={icon} /></span>
      <div>
        <p className="tn-callout-title">{title}</p>
        <p className="tn-callout-body">{children}</p>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="tn-fact">
      <dt><Icon name={icon} />{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LinkBody({ icon, label, detail }: { icon: IconName; label: string; detail: string }) {
  return (
    <>
      <span className="tn-link-mark" aria-hidden="true"><Icon name={icon} /></span>
      <span className="tn-link-text"><strong>{label}</strong><small>{detail}</small></span>
      <svg className="tn-link-go" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
}

function RelatedLink({ href, icon, label, detail }: { href: string; icon: IconName; label: string; detail: string }) {
  return (
    <li>
      <Link href={href as never} className="tn-link">
        <LinkBody icon={icon} label={label} detail={detail} />
      </Link>
    </li>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
