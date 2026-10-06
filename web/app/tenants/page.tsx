"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Avatar, Icon } from "@/components/portal/icons";
import { SpaceTenantAccess } from "@/components/property/SpaceTenantAccess";
import { TenantModal } from "@/components/tenants/TenantModal";
import {
  PanelSearch,
  PanelSkeleton,
  PanelState,
  SegmentedControl,
  WorkspaceHead,
  gridKeyNavigation,
} from "@/components/workspace/Workspace";
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
import { paymentHeadline, shortDate, tenancyState, tenantHome } from "@/lib/tenancyDisplay";

type TenantView = "tenants" | "access";
type TenantFilter = "all" | "active" | "overdue" | "archive";

// Plain states, not judgements (owner, 2026-10-05: "Needs attention" and
// "Paid up" read as misleading). Active is a live agreement; Archive is the
// people who have moved out. All is everyone, in those two sections.
const FILTERS: { key: TenantFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "overdue", label: "Overdue" },
  { key: "archive", label: "Archive" },
];

/** Where someone was when they opened a tenancy, so Back lands them there. */
const RETURN_KEY = "tenants.return";
const RETURN_WINDOW_MS = 30 * 60 * 1000;
type ReturnPoint = { filter: TenantFilter; query: string; id: string; y: number; at: number };

export default function ProviderTenantsPage() {
  return (
    <Suspense fallback={null}>
      <ProviderTenants />
    </Suspense>
  );
}

function ProviderTenants() {
  const { state, activeContext } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // A plain click reads the tenancy in a sheet over the cards, kept in the
  // address; the card is still a link to `/tenants/<id>` for a new tab.
  const openId = search.get("tenant") ?? "";
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
  const [retrying, setRetrying] = useState(false);
  const [returnedTo, setReturnedTo] = useState<string | null>(null);
  const pendingReturn = useRef<ReturnPoint | null>(null);

  useEffect(() => {
    const applyHash = () => {
      const next = window.location.hash.slice(1);
      if (next === "requests") window.location.replace("/applications");
      setView(next === "access" ? "access" : "tenants");
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    // Restored in an effect rather than initial state, so the server render and
    // the first client render agree.
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) ?? "null") as ReturnPoint | null;
      window.sessionStorage.removeItem(RETURN_KEY);
      if (saved && Date.now() - saved.at < RETURN_WINDOW_MS) {
        pendingReturn.current = saved;
        // A point saved before the filters were renamed falls back to All.
        setFilter(FILTERS.some((option) => option.key === saved.filter) ? saved.filter : "all");
        setQuery(saved.query);
      }
    } catch {
      // Storage can be unavailable; the page simply opens at the top.
    }
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
  }, [activeContext, state.status, reloadKey]);

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
      })
      .finally(() => { if (!cancelled) setRetrying(false); });
    return () => { cancelled = true; };
  }, [organizationId, reloadKey]);

  const tenants = useMemo(() => portfolio?.tenants ?? [], [portfolio]);
  const pastTenants = useMemo(() => portfolio?.past_tenants ?? [], [portfolio]);
  const everyone = useMemo(() => [...tenants, ...pastTenants], [tenants, pastTenants]);
  const openedTenant = openId ? tenants.find((tenant) => tenancyKey(tenant) === openId) ?? null : null;

  // `replace`, and only the one parameter: the view lives in the hash.
  const setOpenTenant = useCallback((id: string) => {
    const next = new URLSearchParams(search.toString());
    if (id) next.set("tenant", id);
    else next.delete("tenant");
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}${window.location.hash}` as never, { scroll: false });
  }, [pathname, router, search]);

  const counts = useMemo(() => ({
    all: everyone.length,
    active: tenants.filter(isActive).length,
    overdue: everyone.filter((tenant) => tenant.rent.status === "overdue").length,
    archive: pastTenants.length,
  }), [everyone, tenants, pastTenants]);

  const visibleTenants = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (filter === "active" ? tenants : filter === "archive" ? pastTenants : everyone)
      .filter((tenant) => {
        if (filter === "active") return isActive(tenant);
        if (filter === "overdue") return tenant.rent.status === "overdue";
        return true;
      })
      .filter((tenant) => !needle || [tenant.name, tenant.property_title, tenant.unit_label, tenant.bed_label]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("en-GH").includes(needle)))
      .sort((a, b) => Number(tenantNeedsAttention(b)) - Number(tenantNeedsAttention(a)) || a.name.localeCompare(b.name));
  }, [filter, tenants, pastTenants, everyone, query]);

  // Only the unfiltered, unsearched list is worth splitting: anywhere else the
  // segment or the search already says what the rows have in common.
  const groups = useMemo(() => {
    if (filter !== "all" || query.trim()) return [{ key: "results", title: null, urgent: false, rows: visibleTenants }];
    const current = visibleTenants.filter((tenant) => !tenant.ended_at);
    const past = visibleTenants.filter((tenant) => tenant.ended_at);
    return [
      { key: "current", title: "Current", urgent: false, rows: current },
      { key: "past", title: "Past tenants", urgent: false, rows: past },
    ].filter((group) => group.rows.length);
  }, [filter, query, visibleTenants]);

  // Coming back from a tenancy: the same filter, the same place, and a brief
  // mark on the row that was opened so the eye finds its way back.
  useLayoutEffect(() => {
    const saved = pendingReturn.current;
    if (!saved || !portfolio) return;
    pendingReturn.current = null;
    window.scrollTo({ top: saved.y, behavior: "instant" });
    setReturnedTo(saved.id);
    document.querySelector<HTMLAnchorElement>(`[data-tenancy-id="${CSS.escape(saved.id)}"]`)?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setReturnedTo(null), 1600);
    return () => window.clearTimeout(timer);
  }, [portfolio]);

  const loadingOrganizations = organizations === null;
  const loadingPortfolio = Boolean(organizationId) && portfolio === null && !error;
  const loading = loadingOrganizations || loadingPortfolio;
  const noPortfolio = !loadingOrganizations && organizations?.length === 0 && !error;
  const failed = Boolean(error) && !portfolio;
  const refreshPortfolio = async () => setReloadKey((current) => current + 1);

  function retry() {
    setRetrying(true);
    setError("");
    setReloadKey((current) => current + 1);
  }

  function chooseView(next: TenantView) {
    setView(next);
    window.history.replaceState(null, "", next === "tenants" ? window.location.pathname : `#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function remember(tenant: ProviderTenant) {
    try {
      const point: ReturnPoint = { filter, query, id: tenancyKey(tenant), y: window.scrollY, at: Date.now() };
      window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(point));
    } catch {
      // Without storage, Back simply opens Tenants at the top.
    }
  }

  const ready = (portfolio?.tenant_access ?? []).filter(isShareReady);

  if (view === "access") {
    return (
      <div className="ws-page tenants-workspace">
        <WorkspaceHead
          icon="verification"
          title="Private access"
          path={(
            <nav className="entity-path" aria-label="Breadcrumb">
              <span className="entity-path-entry">
                <button type="button" className="ws-crumb" onClick={() => chooseView("tenants")}>Tenants</button>
              </span>
              <span className="entity-path-entry">
                <span className="entity-path-separator" aria-hidden="true">/</span>
                <span aria-current="page">Private access</span>
              </span>
            </nav>
          )}
          summary={portfolio ? (
            <>
              <strong>{ready.length} ready to share</strong>
              <span className="ws-summary-sep" aria-hidden="true">·</span>
              A temporary code lets someone ask to join a verified, available Unit.
            </>
          ) : null}
          actions={<Link href="/units" className="ws-action">See all Units<Icon name="units" /></Link>}
        />
        <section className="ws-panel" aria-label="Units ready to share" aria-busy={loading || undefined}>
          {loading ? <PanelSkeleton rows={3} /> : null}
          {failed ? <FailedState error={error} retrying={retrying} onRetry={retry} /> : null}
          {portfolio ? <TenantAccessSection spaces={portfolio.tenant_access} onChanged={refreshPortfolio} /> : null}
        </section>
      </div>
    );
  }

  return (
    <div className="ws-page tenants-workspace">
      <WorkspaceHead
        icon="users"
        title="Tenants"
        summary={portfolio ? (
          <>
            <strong>{tenants.length} {tenants.length === 1 ? "tenancy" : "tenancies"}</strong>
            {portfolio.money.overdue_minor > 0 ? (
              <>
                <span className="ws-summary-sep" aria-hidden="true">·</span>
                <span data-tone="critical">{formatMoney({ minor: portfolio.money.overdue_minor, currency: "GHS" })} overdue</span>
              </>
            ) : null}
            {pastTenants.length > 0 ? (
              <>
                <span className="ws-summary-sep" aria-hidden="true">·</span>
                {pastTenants.length} past
              </>
            ) : null}
          </>
        ) : null}
        actions={portfolio ? (
          <button type="button" className="ws-action" onClick={() => chooseView("access")}>
            <Icon name="verification" />Private access
            {ready.length ? <span className="ws-action-count">{ready.length}</span> : null}
          </button>
        ) : null}
      />

      {loading || everyone.length ? (
        <SegmentedControl
          label="Filter tenants"
          value={filter}
          disabled={loading}
          options={FILTERS.map((option) => ({ ...option, count: counts[option.key] }))}
          onChange={setFilter}
        />
      ) : null}

      <section className={`ws-panel${portfolio && visibleTenants.length ? " is-canvas" : ""}`} aria-label="Tenancies" aria-busy={loading || undefined}>
        {portfolio && everyone.length ? (
          <div className="ws-panel-head">
            <PanelSearch label="Search tenants" placeholder="Name, Property, Unit or bed" value={query} onChange={setQuery} />
            <p className="ws-range">
              <strong>{visibleTenants.length}</strong> {visibleTenants.length === 1 ? "tenancy" : "tenancies"}
            </p>
          </div>
        ) : null}

        {loading ? <TenantCardsSkeleton /> : null}
        {failed ? <FailedState error={error} retrying={retrying} onRetry={retry} /> : null}

        {noPortfolio ? (
          <PanelState
            icon="properties"
            title="Add a Property first"
            body="Tenant operations begin with a Unit. Add the first Property in your Rooomly Portfolio."
            action={<Link href="/properties/new" className="btn btn-secondary btn-sm">Add Property</Link>}
          />
        ) : null}

        {portfolio && !everyone.length ? (
          <PanelState
            icon="users"
            title="No tenancies yet"
            body="Approved requests appear here after an agreement is accepted and activated."
            action={<Link href="/applications" className="btn btn-quiet btn-sm">Review tenancy requests</Link>}
          />
        ) : null}

        {portfolio && everyone.length > 0 && !visibleTenants.length ? (
          <PanelState
            icon="users"
            title={query.trim() ? `Nobody matches “${query.trim()}”` : filter === "archive" ? "Nobody has moved out yet" : "No tenancies in this view"}
            body="Change the search or the filter to see the rest of your tenancies."
            action={<Button variant="quiet" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>Show all tenancies</Button>}
          />
        ) : null}

        {portfolio && visibleTenants.length ? (
          <div className="ws-canvas tenants-canvas" key={`${filter}-${query.trim() ? "q" : ""}`} onKeyDown={moveTenantFocus}>
            {groups.map((group) => (
              <section
                key={group.key}
                className={`tenants-group ws-group${group.urgent ? " is-urgent" : ""}`}
                aria-labelledby={group.title ? `tenants-${group.key}` : undefined}
                aria-label={group.title ? undefined : "Matching tenancies"}
              >
                {group.title ? (
                  <h2 className="ws-group-heading" id={`tenants-${group.key}`}>{group.title}<span>{group.rows.length}</span></h2>
                ) : null}
                <ul className="tenant-grid">
                  {group.rows.map((tenant, index) => (
                    <TenantCard
                      key={tenant.occupancy_id}
                      tenant={tenant}
                      order={index}
                      returned={returnedTo === tenancyKey(tenant)}
                      onOpen={remember}
                      onPeek={() => setOpenTenant(tenancyKey(tenant))}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </section>

      <TenantModal tenant={openedTenant} onClose={() => setOpenTenant("")} onChanged={refreshPortfolio} />
    </div>
  );
}

function FailedState({ error, retrying, onRetry }: { error: string; retrying: boolean; onRetry: () => void }) {
  return (
    <PanelState
      tone="error"
      icon="warning"
      title="Tenants didn’t load"
      body={error}
      action={<Button variant="secondary" size="sm" busy={retrying} busyLabel="Retrying…" onClick={onRetry}>Try again</Button>}
    />
  );
}

/**
 * A tenancy as a portrait card: the person's mark on the top edge, their name,
 * where the tenancy stands, the home, and one chip for the rent. The rest is
 * in the tenancy's modal, which a plain click opens; hover raises a View button
 * to say so. The card stays a link to `/tenants/<id>`, so a new tab or a copied
 * link lands on the tenancy's own page.
 */
function TenantCard({
  tenant,
  order,
  returned,
  onOpen,
  onPeek,
}: {
  tenant: ProviderTenant;
  order: number;
  returned: boolean;
  onOpen: (tenant: ProviderTenant) => void;
  onPeek: () => void;
}) {
  const id = tenant.tenancy_id ?? tenant.occupancy_id;
  const href = `/tenants/${id}`;
  const state = tenancyState(tenant);
  const home = tenantHome(tenant);
  return (
    <li
      className={`tenant-card-item${returned ? " is-returned" : ""}`}
      style={{ "--tenant-order": Math.min(order, 12) } as React.CSSProperties}
    >
      <Link
        className="tenant-card"
        href={href as never}
        data-tenancy-id={tenancyKey(tenant)}
        data-rent={tenant.rent.status}
        data-state={state.key}
        data-archived={tenant.ended_at ? "" : undefined}
        aria-haspopup="dialog"
        onClick={(event) => {
          // A new tab or window goes to the tenancy's own page, as a link should.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            onOpen(tenant);
            return;
          }
          event.preventDefault();
          onPeek();
        }}
        aria-label={`${tenant.name}. ${state.label}. ${tenant.property_title}, ${home}. ${paymentHeadline(tenant)}. View tenancy.`}
      >
        {/* A plain record card (owner, 2026-10-05: the floating portrait, the lift
            and the View pill that replaced the rent line "looked fake"). Nothing
            hides on hover: the rent stays, and Open is always there, quietly. */}
        <span className="tenant-card-head">
          {/* Their photo, initials until they add one. A provider may read it while
              the person lives in a property they manage (files.can_read). */}
          <span className="tenant-card-avatar" aria-hidden="true">
            <Avatar name={tenant.name} size={44} photoUrl={tenant.avatar_url ?? null} />
          </span>
          <span className="tenant-card-who">
            <span className="tenant-card-name">{tenant.name}</span>
            <span className="tenant-state" data-state={state.key}>{state.label}</span>
          </span>
        </span>
        <span className="tenant-card-place"><Icon name="units" />{tenant.property_title} · {home}</span>
        <span className="tenant-card-foot">
          <span className="tenant-pay">
            {tenant.ended_at && tenant.rent.status === "current"
              ? `Left ${shortDate(tenant.ended_at.slice(0, 10))}`
              : paymentHeadline(tenant)}
          </span>
          <span className="tenant-card-open" aria-hidden="true">Open<span className="tenant-card-arrow">→</span></span>
        </span>
      </Link>
    </li>
  );
}

/** Loading keeps the cards' shape, so nothing jumps when the tenants land. */
function TenantCardsSkeleton() {
  return (
    <div className="ws-canvas tenants-canvas" aria-busy="true" aria-label="Loading tenants">
      <ul className="tenant-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="tenant-card-item" style={{ "--tenant-order": index } as React.CSSProperties}>
            <div className="tenant-card is-skeleton">
              <span className="tenant-card-head">
                <span className="tenant-card-avatar" />
                <span className="tenant-card-who" style={{ flex: 1 }}>
                  <span className="ws-skeleton-block" style={{ width: "62%" }} />
                  <span className="ws-skeleton-block is-thin" style={{ width: "36%" }} />
                </span>
              </span>
              <span className="ws-skeleton-block is-thin" style={{ width: "70%" }} />
              <span className="tenant-card-foot">
                <span className="ws-skeleton-block is-thin" style={{ width: "30%" }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Arrow keys move between cards the way the eye does. */
const moveTenantFocus = gridKeyNavigation(".tenant-card");

/** How many share-ready Units this view shows before handing over to Units. */
const ACCESS_PREVIEW = 6;

/**
 * Somewhere to create a code, not an inventory.
 *
 * A provider with forty share-ready Units does not want forty cards here; they
 * want the one they are about to share and a way through to the rest. Each Unit
 * carries this same section on its own page, so Units is a complete answer
 * rather than a consolation.
 */
function TenantAccessSection({ spaces, onChanged }: { spaces: ProviderTenantAccess[]; onChanged: () => Promise<void> }) {
  const ready = spaces.filter(isShareReady);
  const shown = ready.slice(0, ACCESS_PREVIEW);
  const unavailable = spaces.length - ready.length;
  if (!ready.length) {
    return (
      <PanelState
        icon="verification"
        title="No Units ready to share privately"
        body="A Unit must be verified and available before it can issue an access code."
        action={<Link href="/properties" className="btn btn-quiet btn-sm">Review Properties</Link>}
      />
    );
  }
  return (
    <>
      <div className="ws-panel-head">
        <p className="ws-range">
          <strong>{ready.length > shown.length ? `Showing ${shown.length} of ${ready.length} ready to share` : `${ready.length} ready to share`}</strong>
          {unavailable > 0 ? ` · ${unavailable} not ready yet` : ""}
        </p>
      </div>
      {/* Cards, not full-width rows (owner, 2026-10-05): each Unit is a small
          self-contained thing — its name, its code's state, one action. */}
      <ul className="tenants-access-grid">
        {shown.map((space, index) => (
          <li key={space.unit_id} className="tenants-access-card" style={{ "--tenant-order": index } as React.CSSProperties}>
            <header className="tenants-access-unit">
              <span className="tenants-access-mark" aria-hidden="true"><Icon name="units" /></span>
              <div>
                <p className="tenants-access-property">{space.property_title}</p>
                <h3>{space.unit_label}</h3>
              </div>
              <Link href={`/properties/${space.property_id}/spaces/${space.unit_id}` as never} className="tenants-access-link">View</Link>
            </header>
            <div className="tenants-access-code">
              <SpaceTenantAccess unitId={space.unit_id} accessCode={space.access_code} conditionState={space.condition_state} availabilityState={space.availability.state} onAccessCodeChanged={onChanged} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function isShareReady(space: ProviderTenantAccess) {
  return space.condition_state === "approved" && space.availability.state === "available";
}

function tenancyKey(tenant: ProviderTenant) {
  return tenant.tenancy_id ?? tenant.occupancy_id;
}

function tenantNeedsAttention(tenant: ProviderTenant) {
  return tenant.tenancy_status === "pending_lease" || !tenant.lease_id || tenant.rent.status !== "current";
}

/** A live agreement: someone living there under an active tenancy. */
function isActive(tenant: ProviderTenant) {
  return !tenant.ended_at && tenant.tenancy_status === "active";
}



