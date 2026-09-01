"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader, Section } from "@/components/portal/PageHeader";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { ApiFailure } from "@/lib/api";
import { getOrganizationPortfolio, listOrganizations, type ProviderTenant } from "@/lib/console";
import { formatMoney } from "@/lib/money";
import { useSession } from "@/lib/session";

export default function ProviderTenancyPage() {
  const { tenancyId } = useParams<{ tenancyId: string }>();
  const { activeContext } = useSession();
  const [tenant, setTenant] = useState<ProviderTenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const organizations = await listOrganizations();
        const preferredId = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
        const ordered = [...organizations].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
        for (const organization of ordered) {
          const portfolio = await getOrganizationPortfolio(organization.id);
          const match = portfolio.tenants.find((row) => row.tenancy_id === tenancyId || row.occupancy_id === tenancyId);
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
  }, [activeContext, tenancyId]);

  if (loading) return <><PageHeader title="Tenancy" /><LoadingRows rows={4} /></>;
  if (error) return <Notice tone="error" title={error} />;
  if (!tenant) return <><PageHeader title="Tenancy not found" /><p><Link href="/tenants">Back to Tenants</Link></p></>;

  const currency = tenant.lease_rent_currency ?? "GHS";
  const tenancyStatus = tenant.tenancy_status === "pending_lease" || !tenant.lease_id ? "Agreement needed" : tenant.tenancy_status === "upcoming" ? "Upcoming tenancy" : "Active tenancy";
  const rentStatus = tenant.rent.status === "current" ? "Paid up" : tenant.rent.status === "overdue" ? "Overdue" : "Outstanding";

  return (
    <div>
      <EntityPath items={[{ label: "Tenants", href: "/tenants", mobileLabel: "Back to Tenants" }, { label: tenant.name }]} />
      <PageHeader title={tenant.name} description={`${tenancyStatus} · ${tenant.property_title}`} />
      <div className="tenancy-detail-grid">
        <div>
          {tenancyStatus === "Agreement needed" ? <Notice tone="warning" title="This occupancy needs a Rooomly agreement" body="Prepare the agreement from the approved request before treating this as an active platform tenancy." /> : null}
          {tenant.rent.status === "overdue" ? <Notice tone="warning" title={`${formatMoney({ minor: tenant.rent.overdue_minor, currency })} is overdue`} body={tenant.rent.next_due_on ? `The next due date recorded is ${formatDate(tenant.rent.next_due_on)}.` : "Open the agreement to review the rent record."} /> : null}

          <Section title="Tenancy">
            <dl className="tenancy-facts">
              <Fact label="Status" value={tenancyStatus} />
              <Fact label="Home" value={`${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`} />
              <Fact label="Starts" value={tenant.lease_starts_on ? formatDate(tenant.lease_starts_on) : "Not recorded"} />
              <Fact label="Ends" value={tenant.lease_ends_on ? formatDate(tenant.lease_ends_on) : "Open-ended / not recorded"} />
            </dl>
          </Section>

          <div style={{ marginTop: "var(--space-8)" }}>
            <Section title="Agreement and rent">
              <dl className="tenancy-facts">
                <Fact label="Agreement" value={tenant.lease_status ? humanize(tenant.lease_status) : "Not prepared"} />
                <Fact label="Rent" value={tenant.lease_rent_minor === null ? "Not recorded" : `${formatMoney({ minor: tenant.lease_rent_minor, currency })} per ${tenant.lease_rent_period === "yearly" ? "year" : "month"}`} />
                <Fact label="Rent position" value={rentStatus} />
                <Fact label="Outstanding" value={formatMoney({ minor: tenant.rent.outstanding_minor, currency })} />
              </dl>
            </Section>
          </div>
        </div>

        <aside aria-label="Related records">
          <Section title="Related records">
            <ul className="tenancy-quick-links">
              <li><Link href={`/properties/${tenant.property_id}` as never}><span>{tenant.property_title}</span><span aria-hidden="true">›</span></Link></li>
              <li><Link href={`/properties/${tenant.property_id}/spaces/${tenant.unit_id}` as never}><span>{tenant.unit_label}{tenant.bed_label ? ` · ${tenant.bed_label}` : ""}</span><span aria-hidden="true">›</span></Link></li>
              {tenant.lease_id ? <li><Link href={`/leases/${tenant.lease_id}` as never}><span>Agreement and rent</span><span aria-hidden="true">›</span></Link></li> : null}
            </ul>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="tenancy-fact"><dt className="type-caption">{label}</dt><dd className="type-body-strong">{value}</dd></div>;
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
