"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { StatusLine, propertyStatus } from "@/components/property/WorkspacePatterns";
import { useToast } from "@/components/toast/Toaster";
import {
  FilterMenu,
  PanelSearch,
  PanelState,
  SegmentedControl,
  WorkspaceHead,
  gridKeyNavigation,
} from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  listOrganizations,
  listProperties,
  type Organization,
  type Property,
} from "@/lib/console";
import { propertyNextStep } from "@/lib/providerSetup";
import { useSession } from "@/lib/session";

/** Where someone was when they opened a Property, so Back lands them there. */
const RETURN_KEY = "properties.return";
const RETURN_WINDOW_MS = 30 * 60 * 1000;
type ReturnPoint = { query: string; stage: Stage; purpose: Purpose; sort: Sort; id: string; y: number; at: number };

/** Where a Property stands, in the few words a manager filters by. */
type Stage = "all" | "verified" | "review" | "attention" | "setup";
type Purpose = "any" | "letting" | "sale";
type Sort = "name" | "units" | "occupancy" | "attention";

const STAGES: { key: Stage; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "review", label: "In review" },
  { key: "attention", label: "Needs attention" },
  { key: "setup", label: "Setup incomplete" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "units", label: "Most Units" },
  { value: "occupancy", label: "Occupancy" },
  { value: "attention", label: "Needs attention first" },
];

/**
 * The stage a Property's card sits under, from the one status the page already
 * shows — so a filter can never disagree with the line printed on the card.
 */
function stageOf(property: Property): Exclude<Stage, "all"> {
  const status = propertyStatus(property);
  if (status.tone === "attention") return "attention";
  if (property.verification.review_state === "verified") return "verified";
  if (property.verification.review_state === "pending_verification") return "review";
  return "setup";
}

function occupancyOf(property: Property) {
  return property.purpose === "sale" || !property.unit_count ? -1 : property.occupied_unit_count / property.unit_count;
}

/**
 * The Portfolio's Properties, as cards.
 *
 * A Property is recognized by its picture and its name, so each card leads with
 * the name and lets the photograph sit in its corner; the few numbers a
 * manager scans for sit beside dots. What can be done to a Property appears
 * when the card is reached for, and the way to add one is a card of its own,
 * shaped like the Property it will become.
 */
function PropertiesContent() {
  const search = useSearchParams();
  const justCreated = Boolean(search.get("created"));
  const { toast } = useToast();
  const { state, activeContext } = useSession();
  const me = state.status === "signed_in" ? state.me : null;
  const provider = me?.capabilities.provider ?? null;
  // Two ways to be allowed: an approved provider adding to anything of theirs,
  // or a Portfolio administrator adding to the Portfolio that invited them —
  // which its own standing and their identity check decide, on the backend.
  const portfolioAccess = me?.contexts.find(
    (context) => context.type === "organization" && context.id === activeContext,
  )?.access ?? me?.contexts.find((context) => context.type === "organization")?.access ?? null;
  const canCreateProperty =
    (provider?.can_create_property ?? false) || Boolean(portfolioAccess?.can.create_properties);
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>("all");
  const [purpose, setPurpose] = useState<Purpose>("any");
  const [sort, setSort] = useState<Sort>("name");
  const [returnedTo, setReturnedTo] = useState<string | null>(null);
  const pendingReturn = useRef<ReturnPoint | null>(null);

  // The Portfolio this page is about, taken from the shared session context —
  // so switching Portfolio anywhere switches this page with it — and sent to
  // the backend, which decides the scope from the membership behind it. This
  // page used to read the account-wide list, which is how one provider's
  // personal houses turned up in a company's roster.
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";

  const load = useCallback(async () => {
    // Blank first: a switch must never leave the previous Portfolio's
    // Properties on screen while the next Portfolio's are still in flight.
    setProperties(null);
    try {
      const orgs = await listOrganizations();
      setOrganizations(orgs);
      const scope = orgs.find((organization) => organization.id === preferred) ?? orgs[0] ?? null;
      setProperties(scope ? await listProperties({ organization: scope.id }) : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load properties.");
      setProperties([]);
      setOrganizations([]);
    }
  }, [preferred]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    // Restored in an effect rather than initial state, so the server render and
    // the first client render agree.
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) ?? "null") as ReturnPoint | null;
      window.sessionStorage.removeItem(RETURN_KEY);
      if (saved && Date.now() - saved.at < RETURN_WINDOW_MS) {
        pendingReturn.current = saved;
        setQuery(saved.query);
        setStage(saved.stage ?? "all");
        setPurpose(saved.purpose ?? "any");
        setSort(saved.sort ?? "name");
      }
    } catch {
      // Storage can be unavailable; the page simply opens at the top.
    }
  }, []);

  // Said once, as a confirmation, rather than as a banner that stays.
  useEffect(() => {
    if (justCreated) toast({ tone: "success", title: "Property added", description: "It is private until you choose to verify and publish its Units." });
  }, [justCreated, toast]);

  const activeOrganization =
    organizations?.find((organization) => organization.id === preferred)
    ?? organizations?.[0]
    ?? null;
  const organizationId = activeOrganization?.id ?? "";
  // A role whose reach is decided by assignment has a different empty state
  // from an owner's: there is nothing for them to add, and somebody else
  // decides what they see.
  const assignedOnly = portfolioAccess ? portfolioAccess.scope !== "portfolio_wide" : false;
  const loading = properties === null || organizations === null;
  const next = propertyNextStep({
    canCreateProperty,
    hasWorkspace: (organizations?.length ?? 0) > 0,
    organizationId,
  });

  const totals = useMemo(() => {
    const letting = (properties ?? []).filter((property) => property.purpose !== "sale");
    return {
      units: letting.reduce((sum, property) => sum + property.unit_count, 0),
      occupied: letting.reduce((sum, property) => sum + property.occupied_unit_count, 0),
      attention: (properties ?? []).filter((property) => propertyStatus(property).tone === "attention").length,
    };
  }, [properties]);

  // Stage counts follow the type filter, so the stages always describe the
  // Properties the person is actually looking at.
  const ofPurpose = useMemo(
    () => (properties ?? []).filter((property) => purpose === "any" || (purpose === "sale") === (property.purpose === "sale")),
    [properties, purpose],
  );

  const stageCounts = useMemo(() => {
    const counts: Record<Stage, number> = { all: ofPurpose.length, verified: 0, review: 0, attention: 0, setup: 0 };
    for (const property of ofPurpose) counts[stageOf(property)] += 1;
    return counts;
  }, [ofPurpose]);

  const saleCount = useMemo(() => (properties ?? []).filter((property) => property.purpose === "sale").length, [properties]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return ofPurpose
      .filter((property) => stage === "all" || stageOf(property) === stage)
      .filter((property) => !needle || [
        property.title,
        property.address?.locality_name,
        property.address?.district_name,
      ].filter(Boolean).join(" ").toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => {
        const byName = (a.title || "").localeCompare(b.title || "", "en-GH");
        if (sort === "units") return b.unit_count - a.unit_count || byName;
        if (sort === "occupancy") return occupancyOf(b) - occupancyOf(a) || byName;
        if (sort === "attention") {
          const rank = { attention: 0, setup: 1, review: 2, verified: 3 } as const;
          return rank[stageOf(a)] - rank[stageOf(b)] || byName;
        }
        return byName;
      });
  }, [ofPurpose, query, stage, sort]);

  // A stage that empties (the last flagged Property was fixed, or the type
  // filter moved) falls back to All rather than an empty tab nobody can pick.
  useEffect(() => {
    if (stage !== "all" && properties && !stageCounts[stage]) setStage("all");
  }, [properties, stage, stageCounts]);
  useEffect(() => {
    if (purpose !== "any" && properties && !saleCount) setPurpose("any");
  }, [properties, purpose, saleCount]);

  // Coming back from a Property: the same search, the same place, and a brief
  // mark on the card that was opened so the eye finds its way back.
  useLayoutEffect(() => {
    const saved = pendingReturn.current;
    if (!saved || !properties) return;
    pendingReturn.current = null;
    window.scrollTo({ top: saved.y, behavior: "instant" });
    setReturnedTo(saved.id);
    document.querySelector<HTMLAnchorElement>(`[data-property-id="${CSS.escape(saved.id)}"]`)?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setReturnedTo(null), 1600);
    return () => window.clearTimeout(timer);
  }, [properties]);

  function remember(property: Property) {
    try {
      const point: ReturnPoint = { query, stage, purpose, sort, id: property.id, y: window.scrollY, at: Date.now() };
      window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(point));
    } catch {
      // Without storage, Back simply opens Properties at the top.
    }
  }

  async function retry() {
    setRetrying(true);
    await load();
    setRetrying(false);
  }

  const count = properties?.length ?? 0;
  const failed = Boolean(error) && !count;
  const searching = Boolean(query.trim());
  const narrowed = searching || stage !== "all" || purpose !== "any";
  // Cards (and the first "Add a Property" card) sit on the washed canvas; the
  // plain states — loading failed, nothing assigned — stay on paper.
  const firstProperty = !loading && !failed && count === 0 && canCreateProperty && !assignedOnly;
  const onCanvas = loading || (count > 0 && !failed) || firstProperty;

  return (
    <div className="ws-page properties-workspace">
      <WorkspaceHead
        icon="properties"
        title="Properties"
        summary={loading || failed ? null : count ? (
          <>
            <strong>{count} {count === 1 ? "Property" : "Properties"}</strong>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.units} {totals.units === 1 ? "Unit" : "Units"}
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.occupied} occupied
            {totals.attention ? (
              <>
                <span className="ws-summary-sep" aria-hidden="true">·</span>
                <span data-tone="warning">{totals.attention} need{totals.attention === 1 ? "s" : ""} attention</span>
              </>
            ) : null}
          </>
        ) : `Buildings and rentable spaces in ${activeOrganization?.name ?? "this Portfolio"}.`}
        actions={!loading && canCreateProperty && count ? (
          <Link href={next.href as never} className="ws-action"><PlusGlyph />Add Property</Link>
        ) : null}
      />

      {provider && !canCreateProperty ? (
        <Notice
          tone="info"
          title="Property creation is not available yet"
          body="You can review this Portfolio while your provider verification is in progress."
        />
      ) : null}

      {loading || count > 1 ? (
        <SegmentedControl
          label="Property stage"
          value={stage}
          disabled={loading}
          // Only stages that hold something: a filter nobody can act on is noise.
          options={STAGES
            .filter((option) => option.key === "all" || stageCounts[option.key] > 0 || option.key === stage)
            .map((option) => ({ ...option, count: stageCounts[option.key] }))}
          onChange={setStage}
        />
      ) : null}

      <section className={`ws-panel${onCanvas ? " is-canvas" : ""}`} aria-label="Properties" aria-busy={loading || undefined}>
        {!loading && count > 1 ? (
          <div className="ws-panel-head properties-panel-head">
            <div className="ws-panel-tools">
              <PanelSearch label="Search Properties" placeholder="Name or area" value={query} onChange={setQuery} />
              {saleCount && saleCount < count ? (
                <FilterMenu
                  label="Type"
                  icon="properties"
                  value={purpose}
                  active={purpose !== "any"}
                  options={[
                    { value: "any", label: "All types" },
                    { value: "letting", label: "For rent", count: count - saleCount },
                    { value: "sale", label: "For sale", count: saleCount },
                  ]}
                  onChange={setPurpose}
                />
              ) : null}
              <FilterMenu label="Sort" prefix="Sort" value={sort} options={SORTS} onChange={setSort} />
            </div>
            <p className="ws-range">
              <strong>{visible.length}</strong> of {count}
            </p>
          </div>
        ) : null}

        {error && count ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" />
            <span>{error}</span>
            <button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "Retrying…" : "Try again"}</button>
          </div>
        ) : null}

        {loading ? <PropertyCardsSkeleton /> : null}

        {!loading && failed ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Properties didn’t load"
            body={error}
            action={<Button variant="secondary" size="sm" busy={retrying} busyLabel="Retrying…" onClick={() => void retry()}>Try again</Button>}
          />
        ) : null}

        {!loading && !failed && count === 0 ? (
          assignedOnly || !canCreateProperty ? (
            <PanelState
              icon="properties"
              title={
                assignedOnly
                  ? "No Property is assigned to you"
                  : organizations.length ? "No Properties yet" : "Add your first Property"
              }
              body={
                assignedOnly
                  ? `An owner or administrator of ${activeOrganization?.name ?? "this Portfolio"} decides which Properties you operate. The ones assigned to you appear here.`
                  : next.reason
              }
            />
          ) : (
            // The first Property is added from the same card every later one is,
            // so the empty state is already the shape of the page to come.
            <div className="ws-canvas properties-canvas">
              <div className="properties-first">
                <h2>{organizations.length ? "No Properties yet" : "Add your first Property"}</h2>
                <p>{next.reason}</p>
              </div>
              <ul className="property-grid">
                <li className="property-card-item"><AddPropertyCard href={next.href} /></li>
              </ul>
            </div>
          )
        ) : null}

        {!loading && count > 0 && narrowed && !visible.length ? (
          <PanelState
            icon="properties"
            title={searching ? `No Property matches “${query.trim()}”` : "No Property in this view"}
            body={searching ? "Try another name or area." : "Change the filters to see the rest of this Portfolio."}
            action={<Button variant="quiet" size="sm" onClick={() => { setQuery(""); setStage("all"); setPurpose("any"); }}>Show all Properties</Button>}
          />
        ) : null}

        {!loading && visible.length ? (
          <div className="ws-canvas properties-canvas" onKeyDown={movePropertyFocus}>
            <ul className="property-grid">
              {visible.map((property, index) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  order={index}
                  returned={returnedTo === property.id}
                  onOpen={remember}
                />
              ))}
              {canCreateProperty && !narrowed ? (
                <li className="property-card-item" style={{ "--property-order": Math.min(visible.length, 12) } as React.CSSProperties}>
                  <AddPropertyCard href={next.href} />
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function PropertiesPage() {
  return (
    <Suspense fallback={<div className="ws-page properties-workspace"><WorkspaceHead icon="properties" title="Properties" /><section className="ws-panel is-canvas" aria-busy="true"><PropertyCardsSkeleton /></section></div>}>
      <PropertiesContent />
    </Suspense>
  );
}

/**
 * A Property as a card: its name and area first, then where it stands, then
 * the few numbers a manager scans for beside dots. The photograph sits in the
 * corner. Actions wake when the card is reached for; the card itself opens the
 * Property, and the actions are siblings of that link, never nested in it.
 */
function PropertyCard({
  property,
  order,
  returned,
  onOpen,
}: {
  property: Property;
  order: number;
  returned: boolean;
  onOpen: (property: Property) => void;
}) {
  const status = propertyStatus(property);
  const location = property.address
    ? `${property.address.locality_name}, ${property.address.district_name}`
    : "Address unavailable";
  // A property for sale has no Units to count; its price and whether buyers
  // can see it are what its seller scans the list for.
  const sale = property.purpose === "sale" ? property.sale : null;
  const units = sale
    ? (sale.price_formatted ?? "For sale")
    : `${property.unit_count} ${property.unit_count === 1 ? "Unit" : "Units"}`;
  const occupancy = sale
    ? sale.status === "active"
      ? sale.is_public
        ? "For sale · public"
        : "For sale · not public yet"
      : sale.status_label
    : property.unit_count
      ? `${property.occupied_unit_count} occupied · ${property.vacant_unit_count} available`
      : "No Units added";

  // The same rule the Property's own page uses before it offers "Add Unit".
  const access = property.billing_access;
  const restricted = Boolean(access && access.state !== "full");
  const canAddUnit = !sale
    && (property.capabilities.private_inventory?.allowed ?? false)
    && !restricted
    && ["verified", "pending_verification"].includes(property.verification.review_state);
  const canEdit = property.permitted_actions.edit?.allowed ?? false;
  const occupiedShare = !sale && property.unit_count ? property.occupied_unit_count / property.unit_count : 0;

  return (
    <li
      className={`property-card-item${returned ? " is-returned" : ""}`}
      style={{ "--property-order": Math.min(order, 12) } as React.CSSProperties}
    >
      <div className="property-card" data-tone={status.tone} data-purpose={property.purpose}>
        <Link
          href={`/properties/${property.id}` as never}
          className="property-card-link"
          data-property-id={property.id}
          onClick={() => onOpen(property)}
          aria-label={`${property.title || "Untitled property"}${property.purpose === "sale" ? ", for sale" : ""}, ${location}. ${status.label}. ${units}, ${occupancy}.`}
        >
          <span className="property-card-name">{property.title || "Untitled property"}</span>
        </Link>

        {property.purpose === "sale" ? <span className="property-card-sale" aria-hidden="true">For sale</span> : null}

        <p className="property-card-where">{location}</p>

        <div className="property-card-status"><StatusLine label={status.label} tone={status.tone} /></div>

        <ul className="property-card-stats" aria-hidden="true">
          {sale ? (
            <>
              <li data-dot="gold"><strong>{units}</strong></li>
              <li data-dot={sale.is_public ? "kola" : "ink"}>{occupancy}</li>
            </>
          ) : property.unit_count ? (
            <>
              <li data-dot="kola"><strong>{property.occupied_unit_count}/{property.unit_count}</strong> Units occupied</li>
              <li data-dot="lagoon"><strong>{property.vacant_unit_count}</strong> available</li>
              {property.building_count > 1 ? <li data-dot="ink"><strong>{property.building_count}</strong> buildings</li> : null}
            </>
          ) : (
            <li data-dot="ink">No Units added</li>
          )}
        </ul>

        {!sale && property.unit_count ? (
          <span className="property-card-meter" aria-hidden="true">
            <span style={{ transform: `scaleX(${occupiedShare})` }} />
          </span>
        ) : null}

        <div className="property-card-actions">
          <span className="property-card-go" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
              <path d="M3.5 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {canAddUnit ? (
            <Link href={`/properties/${property.id}/spaces/new` as never} className="property-card-action">
              <PlusGlyph />Add Unit
            </Link>
          ) : null}
          {canEdit ? (
            <Link href={`/properties/${property.id}/setup` as never} className="property-card-action">
              Edit details
            </Link>
          ) : null}
        </div>

        <span className="property-card-photo" aria-hidden="true">
          {/* Signed media URLs are supplied at runtime by the API and are not
              stable Next image-loader resources. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {property.cover_url ? <img src={property.cover_url} alt="" loading="lazy" /> : <Icon name="properties" />}
        </span>
      </div>
    </li>
  );
}

/**
 * The way to add a Property is a card of its own, drawn as the ghost of the
 * Property it will become. Reaching for it fills the ghost in.
 */
function AddPropertyCard({ href }: { href: string }) {
  return (
    <Link href={href as never} className="property-add">
      <span className="property-add-ghost" aria-hidden="true">
        <span className="property-add-ghost-line is-title" />
        <span className="property-add-ghost-line" />
        <span className="property-add-ghost-dots">
          <i /><i /><i />
        </span>
        <span className="property-add-ghost-photo" />
      </span>
      <span className="property-add-plus" aria-hidden="true"><PlusGlyph /></span>
      <strong>Add a Property</strong>
      <small>A compound, hostel, apartment block or house</small>
    </Link>
  );
}

function PropertyCardsSkeleton() {
  return (
    <div className="ws-canvas properties-canvas" aria-busy="true" aria-label="Loading Properties">
      <ul className="property-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="property-card-item" style={{ "--property-order": index } as React.CSSProperties}>
            <div className="property-card is-skeleton">
              <span className="ws-skeleton-block" style={{ width: "55%", height: "1.1rem" }} />
              <span className="ws-skeleton-block is-thin" style={{ width: "40%" }} />
              <span className="ws-skeleton-lines" style={{ marginTop: "var(--space-3)" }}>
                <span className="ws-skeleton-block is-thin" style={{ width: "46%" }} />
                <span className="ws-skeleton-block is-thin" style={{ width: "36%" }} />
              </span>
              <span className="property-card-photo is-skeleton-photo" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg className="portal-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Arrow keys move between cards the way the eye does. */
const movePropertyFocus = gridKeyNavigation(".property-card-link, .property-add");
