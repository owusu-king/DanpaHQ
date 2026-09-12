"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { SpaceTenantAccess } from "@/components/property/SpaceTenantAccess";
import { ApiFailure } from "@/lib/api";
import {
  getOrganizationPortfolio,
  listOrganizations,
  type Organization,
  type OrganizationPortfolio,
  type ProviderTenant,
  type ProviderTenantAccess,
} from "@/lib/console";
import { formatMoney } from "@/lib/money";
import { useSession } from "@/lib/session";

type TenantView = "tenants" | "access";
type TenantFilter = "all" | "attention" | "overdue" | "current";

export default function ProviderTenantsPage() {
  const { state, activeContext } = useSession();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [portfolio, setPortfolio] = useState<OrganizationPortfolio | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** Which Portfolio is currently painted, so a refresh does not blank it. */
  const shownPortfolio = useRef<string | null>(null);
  const [view, setView] = useState<TenantView>("tenants");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TenantFilter>("all");
  const [error, setError] = useState("");

  useEffect(() => {
    const applyHash = () => {
      const next = window.location.hash.slice(1);
      if (next === "requests") window.location.replace("/applications");
      if (next === "access") setView(next);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    if (state.status !== "signed_in") return;
    let cancelled = false;
    listOrganizations()
      .then((rows) => {
        if (cancelled) return;
        const preferred = activeContext?.startsWith("organization:")
          ? activeContext.slice("organization:".length)
          : "";
        setOrganizations(rows);
        // The header says which Portfolio this is, so this page follows it
        // rather than remembering a choice of its own. Keeping the local one
        // was how Tenants stayed on the Portfolio somebody had switched out of.
        setOrganizationId(rows.find((row) => row.id === preferred)?.id ?? rows[0]?.id ?? "");
        setError("");
      })
      .catch((cause) => {
        if (cancelled) return;
        setOrganizations([]);
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Portfolios.");
      });
    return () => { cancelled = true; };
  }, [activeContext, state.status]);

  useEffect(() => {
    if (!organizationId) {
      setPortfolio(null);
      shownPortfolio.current = null;
      return;
    }
    let cancelled = false;
    // Blank the screen only when a *different* Portfolio is being loaded.
    //
    // Clearing it on every refresh unmounted this whole branch, and unmounting
    // takes component state with it: the access code shown once after it is
    // created lives in the card's own state, so creating one made it appear and
    // then immediately vanish as the refresh it triggered tore the card down
    // and built a new one.
    if (shownPortfolio.current !== organizationId) {
      setPortfolio(null);
      shownPortfolio.current = organizationId;
    }
    getOrganizationPortfolio(organizationId)
      .then((result) => {
        if (cancelled) return;
        setPortfolio(result);
        setError("");
      })
      .catch((cause) => {
        if (cancelled) return;
        setPortfolio(null);
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not load tenants.");
      });
    return () => { cancelled = true; };
  }, [organizationId, reloadKey]);

  const visibleTenants = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (portfolio?.tenants ?? [])
      .filter((tenant) => {
        if (filter === "attention") return tenantNeedsAttention(tenant);
        if (filter === "overdue") return tenant.rent.status === "overdue";
        if (filter === "current") return tenant.rent.status === "current" && tenant.tenancy_status === "active";
        return true;
      })
      .filter((tenant) => !needle || [tenant.name, tenant.property_title, tenant.unit_label, tenant.bed_label]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("en-GH").includes(needle)))
      .sort((a, b) => Number(tenantNeedsAttention(b)) - Number(tenantNeedsAttention(a)) || a.name.localeCompare(b.name));
  }, [filter, portfolio, query]);

  const loadingOrganizations = organizations === null;
  const loadingPortfolio = Boolean(organizationId) && portfolio === null && !error;
  const refreshPortfolio = async () => setReloadKey((current) => current + 1);

  function chooseView(next: TenantView) {
    setView(next);
    window.history.replaceState(null, "", next === "tenants" ? window.location.pathname : `#${next}`);
  }

  return (
    <div>
      <PageHeader title="Tenants" description="Current rental relationships and private Unit access." />
      {error ? <Notice tone="error" title={error} /> : null}
      {loadingOrganizations ? <LoadingRows rows={3} /> : null}

      {!loadingOrganizations && organizations?.length === 0 ? (
        <Empty
          title="Add a Property first"
          body="Tenant operations begin with a Unit. Add the first Property in your Rooomly Portfolio."
          action={<Link href="/properties/new" className="type-body-strong">Add Property →</Link>}
        />
      ) : null}

      {loadingPortfolio ? <LoadingRows rows={5} /> : null}

      {portfolio ? (
        <>
          <p className="tenants-summary type-caption" aria-label="Portfolio tenancy summary">
            <span>{portfolio.tenants.length} active relationship{portfolio.tenants.length === 1 ? "" : "s"}</span>
            <span>{formatMoney({ minor: portfolio.money.overdue_minor, currency: "GHS" })} overdue</span>
          </p>

          <div className="tenants-tabs" role="tablist" aria-label="Tenant work">
            <TenantTab selected={view === "tenants"} controls="tenant-list" onClick={() => chooseView("tenants")}>Tenants</TenantTab>
            <TenantTab selected={view === "access"} controls="tenant-access" onClick={() => chooseView("access")}>Private access</TenantTab>
          </div>

          {view === "tenants" ? (
            <section id="tenant-list" role="tabpanel" aria-labelledby="tenant-list-tab">
              <div className="tenants-toolbar">
                <Field label="Search tenants" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Property, Unit or bed" />
                <label className="tenants-filter type-caption">
                  Show
                  <select value={filter} onChange={(event) => setFilter(event.target.value as TenantFilter)}>
                    <option value="all">All current relationships</option>
                    <option value="attention">Needs attention</option>
                    <option value="overdue">Rent overdue</option>
                    <option value="current">Current and paid up</option>
                  </select>
                </label>
              </div>
              <TenantList tenants={visibleTenants} hasAny={portfolio.tenants.length > 0} />
            </section>
          ) : null}
          {view === "access" ? <TenantAccessSection spaces={portfolio.tenant_access} onChanged={refreshPortfolio} /> : null}
        </>
      ) : null}
    </div>
  );
}

function TenantTab({ selected, controls, onClick, children }: { selected: boolean; controls: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      id={`${controls}-tab`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      className="tenants-tab type-body-strong"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? []);
        const current = tabs.indexOf(event.currentTarget);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(current + direction + tabs.length) % tabs.length];
        event.preventDefault();
        next?.focus();
        next?.click();
      }}
    >
      {children}
    </button>
  );
}

function TenantList({ tenants, hasAny }: { tenants: ProviderTenant[]; hasAny: boolean }) {
  if (!hasAny) return <Empty title="No active tenancies" body="Approved requests appear here after an agreement is accepted and activated." />;
  if (!tenants.length) return <Empty title="No matching tenants" body="Change the search or filter to see other relationships." />;
  return (
    <>
      <div className="tenant-table-head type-label" aria-hidden="true"><span>Tenant</span><span>Property and Unit</span><span>Rent</span><span /></div>
      <ul className="tenant-table">
        {tenants.map((tenant) => {
          const id = tenant.tenancy_id ?? tenant.occupancy_id;
          const href = `/tenants/${id}`;
          return (
            <li className="tenant-table-row" key={tenant.occupancy_id}>
              <div className="tenant-table-primary">
                <Link className="type-body-strong" href={href as never}>{tenant.name}</Link>
                <span className="tenant-table-meta type-caption">{tenancyLabel(tenant)}</span>
              </div>
              <div className="tenant-table-secondary">
                <span className="type-body">{tenant.property_title}</span>
                <span className="tenant-table-meta type-caption">{tenant.unit_label}{tenant.bed_label ? ` · ${tenant.bed_label}` : ""}</span>
              </div>
              <div className="tenant-table-rent" data-tone={tenant.rent.status}>
                <span className="type-body-strong">{rentLabel(tenant)}</span>
                {tenant.rent.next_due_on ? <span className="tenant-table-meta type-caption">Due {formatDate(tenant.rent.next_due_on)}</span> : null}
              </div>
              <span className="tenant-table-link" aria-hidden="true">›</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** How many share-ready Units this tab shows before handing over to Units. */
const ACCESS_PREVIEW = 3;

/**
 * Somewhere to create a code, not an inventory.
 *
 * A provider with forty share-ready Units does not want forty cards here; they
 * want the one they are about to share and a way through to the rest. Each Unit
 * carries this same section on its own page, so Units is a complete answer
 * rather than a consolation.
 */
function TenantAccessSection({ spaces, onChanged }: { spaces: ProviderTenantAccess[]; onChanged: () => Promise<void> }) {
  const ready = spaces.filter((space) => space.condition_state === "approved" && space.availability.state === "available");
  const shown = ready.slice(0, ACCESS_PREVIEW);
  const unavailable = spaces.length - ready.length;
  return (
    <section id="tenant-access" role="tabpanel" aria-labelledby="tenant-access-tab">
      <header style={{ marginBottom: "var(--space-5)" }}>
        <h2 className="type-title-2" style={{ margin: 0 }}>Private Unit access</h2>
        <p className="type-caption" style={{ margin: "var(--space-2) 0 0", maxWidth: "62ch" }}>Create a temporary code only when you are ready to share a verified, available Unit privately.</p>
      </header>
      {!ready.length ? <Empty title="No Units ready to share privately" body="A Unit must be verified and available before it can issue an access code." action={<Link href="/properties" className="type-body-strong">Review Properties →</Link>} /> : (
        <div className="tenant-access-grid">
          {shown.map((space) => (
            <article key={space.unit_id} className="portal-panel">
              <p className="type-label" style={{ margin: 0, color: "var(--color-ink-500)" }}>{space.property_title}</p>
              <h3 className="type-title-2" style={{ margin: "var(--space-1) 0 var(--space-4)" }}>{space.unit_label}</h3>
              <SpaceTenantAccess unitId={space.unit_id} accessCode={space.access_code} conditionState={space.condition_state} availabilityState={space.availability.state} onAccessCodeChanged={onChanged} />
              <p style={{ margin: "var(--space-4) 0 0" }}><Link href={`/properties/${space.property_id}/spaces/${space.unit_id}` as never} className="type-caption" style={ACTION}>View Unit →</Link></p>
            </article>
          ))}
        </div>
      )}
      {/* One line, one way through: how much is not on screen, and where the
          rest of it is. */}
      {ready.length > shown.length || unavailable > 0 ? (
        <p className="type-caption" style={{ marginTop: "var(--space-5)" }}>
          {ready.length > shown.length
            ? `Showing ${shown.length} of ${ready.length} ready to share. `
            : ""}
          {unavailable > 0
            ? `${unavailable} other Unit${unavailable === 1 ? " is" : "s are"} not ready yet. `
            : ""}
          <Link href="/units" style={ACTION}>See all Units \u2192</Link>
        </p>
      ) : null}
    </section>
  );
}

function tenantNeedsAttention(tenant: ProviderTenant) {
  return tenant.tenancy_status === "pending_lease" || !tenant.lease_id || tenant.rent.status !== "current";
}

function tenancyLabel(tenant: ProviderTenant) {
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return "Agreement needed";
  if (tenant.tenancy_status === "upcoming") return "Upcoming tenancy";
  return tenant.tenancy_status === "active" ? "Active tenancy" : "Tenancy";
}

function rentLabel(tenant: ProviderTenant) {
  if (tenant.rent.status === "current") return "Paid up";
  const amount = tenant.rent.status === "overdue" ? tenant.rent.overdue_minor : tenant.rent.outstanding_minor;
  return `${formatMoney({ minor: amount, currency: tenant.lease_rent_currency ?? "GHS" })} ${tenant.rent.status}`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const ACTION: React.CSSProperties = { color: "var(--color-kola-600)", fontWeight: 600 };
