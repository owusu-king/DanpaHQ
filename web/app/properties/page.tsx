"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { UnitWizardModal } from "@/components/property/UnitWizardModal";
import { propertyStatus } from "@/components/property/WorkspacePatterns";
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
  type Property,
} from "@/lib/console";
import { propertyNextStep } from "@/lib/providerSetup";
import { propertyCardActionLabels, propertyCardPresentation } from "@/lib/propertyCard";
import { inPlace } from "@/lib/inPlace";
import { useSession } from "@/lib/session";
import { selectedPortfolio } from "@/lib/sessionPolicy";

const PropertyWizardModal = dynamic(() => import("@/components/property/PropertyWizard").then((module) => module.PropertyWizardModal));

/** Where someone was when they opened a Property, so Back lands them there. */
const RETURN_KEY = "properties.return";
const RETURN_WINDOW_MS = 30 * 60 * 1000;
type ReturnPoint = { query: string; stage: Stage; purpose: Purpose; sort: Sort; id: string; y: number; at: number };

/** Where a Property stands, in the few words a manager filters by. */
type Stage = "all" | "verified" | "review" | "attention" | "setup";
type Purpose = "any" | "letting" | "sale";
type Sort = "newest" | "name" | "units" | "occupancy" | "attention";

const STAGES: { key: Stage; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "review", label: "In review" },
  { key: "attention", label: "Needs attention" },
  { key: "setup", label: "Setup incomplete" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "units", label: "Most Units" },
  { value: "occupancy", label: "Occupancy" },
  { value: "attention", label: "Needs attention first" },
];

/**
 * The stage a Property's card sits under, from the one status the page already
 * shows — so a filter can never disagree with the card's status icon.
 */
function stageOf(property: Property): Exclude<Stage, "all"> {
  const status = propertyStatus(property);
  if (status.tone === "attention") return "attention";
  if (property.verification.review_state === "verified") return "verified";
  if (property.verification.review_state === "pending_verification") return "review";
  return "setup";
}

function creationTime(value?: string) { const time = Date.parse(value ?? ""); return Number.isFinite(time) ? time : 0; }

function occupancyOf(property: Property) {
  return property.purpose === "sale" || !property.unit_count ? -1 : property.occupied_unit_count / property.unit_count;
}

/**
 * The Portfolio's Properties, as cards.
 *
 * A Property is recognized by its picture and its name. Its status, occupancy
 * and available actions are visible at a glance. The way to add one is a card of its own,
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
  const context = selectedPortfolio(me, activeContext);
  const portfolioAccess = context?.access
    ?? me?.contexts.find((context) => context.type === "organization")?.access ?? null;
  const canCreateProperty =
    (provider?.can_create_property ?? false) || Boolean(portfolioAccess?.can.create_properties);
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [fallbackId, setFallbackId] = useState("");
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>("all");
  const [purpose, setPurpose] = useState<Purpose>("any");
  const [sort, setSort] = useState<Sort>("name");
  const [returnedTo, setReturnedTo] = useState<string | null>(null);
  // Creating opens in place (owner, 2026-10-20): a sheet over this page, held
  // in page state like every other modal here.
  const [sheet, setSheet] = useState<
    { kind: "property"; propertyId?: string } | { kind: "unit"; propertyId: string } | null
  >(null);
  const pendingReturn = useRef<ReturnPoint | null>(null);

  // The Portfolio this page is about, taken from the shared session context —
  // so switching Portfolio anywhere switches this page with it — and sent to
  // the backend, which decides the scope from the membership behind it. This
  // page used to read the account-wide list, which is how one provider's
  // personal houses turned up in a company's roster.
  const preferred = context?.organization_id;

  const load = useCallback(async (preserveContent = false) => {
    // Blank first: a switch must never leave the previous Portfolio's
    // Properties on screen while the next Portfolio's are still in flight.
    if (!preserveContent) setProperties(null);
    try {
      const id = preferred ?? (await listOrganizations())[0]?.id ?? "";
      if (!preferred) setFallbackId(id);
      setProperties(id ? await listProperties({ organization: id }) : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load properties.");
      if (!preserveContent) {
        setProperties([]);
        setFallbackId("");
      }
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

  const organizationId = preferred ?? fallbackId;
  // A role whose reach is decided by assignment has a different empty state
  // from an owner's: there is nothing for them to add, and somebody else
  // decides what they see.
  const assignedOnly = portfolioAccess ? portfolioAccess.scope !== "portfolio_wide" : false;
  const loading = properties === null;
  const next = propertyNextStep({
    canCreateProperty,
    hasWorkspace: Boolean(organizationId),
    organizationId,
  });

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
        if (sort === "newest") return creationTime(b.created_at) - creationTime(a.created_at) || byName || a.id.localeCompare(b.id);
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
  // Only the create form opens in place; anything else the next step points at
  // (an identity check, say) is a page of its own.
  const createInPlace = next.href.startsWith("/record/property-new");
  const openCreate = createInPlace ? inPlace(() => setSheet({ kind: "property" })) : undefined;
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
                  : organizationId ? "No Properties yet" : "Add your first Property"
              }
              body={assignedOnly ? undefined : next.reason || undefined}
            />
          ) : (
            // The first Property is added from the same card every later one is,
            // so the empty state is already the shape of the page to come.
            <div className="ws-canvas properties-canvas">
              <div className="properties-first">
                <h2>{organizationId ? "No Properties yet" : "Add your first Property"}</h2>
              </div>
              <ul className="property-grid">
                <li className="property-card-item"><AddPropertyCard href={next.href} onClick={openCreate} /></li>
              </ul>
            </div>
          )
        ) : null}

        {!loading && count > 0 && narrowed && !visible.length ? (
          <PanelState
            icon="properties"
            title={searching ? `No Property matches “${query.trim()}”` : "No Property in this view"}
            action={<Button variant="quiet" size="sm" onClick={() => { setQuery(""); setStage("all"); setPurpose("any"); }}>Show all Properties</Button>}
          />
        ) : null}

        {!loading && count > 0 && (visible.length > 0 || canCreateProperty) ? (
          <div className="ws-canvas properties-canvas" onKeyDown={movePropertyFocus}>
            <ul className="property-grid">
              {canCreateProperty ? (
                <li className="property-card-item" style={{ "--property-order": 0 } as React.CSSProperties}>
                  <AddPropertyCard href={next.href} onClick={openCreate} />
                </li>
              ) : null}
              {visible.map((property, index) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  order={index + 1}
                  returned={returnedTo === property.id}
                  onOpen={remember}
                  onAddUnit={() => setSheet({ kind: "unit", propertyId: property.id })}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {sheet?.kind === "property" ? <PropertyWizardModal
        open
        propertyId={sheet.propertyId ?? null}
        onClose={() => setSheet(null)}
        onChanged={() => void load(true)}
        onFinished={() => void load(true)}
      /> : null}
      {sheet?.kind === "unit" ? <UnitWizardModal
        open
        mode="create"
        propertyId={sheet.propertyId}
        onClose={() => setSheet(null)}
        onChanged={() => void load(true)}
      /> : null}
    </div>
  );
}

export default function PropertiesPage() {
  const { activeContext } = useSession();
  return (
    <Suspense fallback={<div className="ws-page properties-workspace"><WorkspaceHead icon="properties" title="Properties" /><section className="ws-panel is-canvas" aria-busy="true"><PropertyCardsSkeleton /></section></div>}>
      <PropertiesContent key={activeContext} />
    </Suspense>
  );
}

/**
 * A Property as a card: name and area, compact inventory figures, and actions.
 * Verification sits in the upper corner and the photograph in the lower one.
 * The card opens the Property; actions are siblings of that link, never nested.
 */
function PropertyCard({
  property,
  order,
  returned,
  onOpen,
  onAddUnit,
}: {
  property: Property;
  order: number;
  returned: boolean;
  onOpen: (property: Property) => void;
  onAddUnit: () => void;
}) {
  const { badge, tone, action } = propertyCardPresentation(property);
  const location = [property.address?.locality_name, property.address?.district_name].filter(Boolean).join(", ");
  const title = property.title || "Untitled property";
  const selling = property.purpose === "sale";
  const sale = property.sale;
  const saleStatus = sale?.status === "active" ? sale.is_public ? "Public" : "Not public yet" : sale?.status_label;
  const review = property.verification.review_state;
  const canAddUnit = !selling && property.capabilities.private_inventory?.allowed
    && (!property.billing_access || property.billing_access.state === "full")
    && (review === "verified" || review === "pending_verification");
  const details = "/record/property?id=" + encodeURIComponent(property.id);
  const href = {
    view: details,
    details,
    continue: "/record/property-setup?propertyId=" + encodeURIComponent(property.id),
    submit: "/record/property-verify?id=" + encodeURIComponent(property.id),
  }[action];

  return (
    <li className={`property-card-item${returned ? " is-returned" : ""}`}
      style={{ "--property-order": Math.min(order, 12) } as React.CSSProperties}>
      <article className="property-card" data-tone={tone} data-purpose={selling ? "sale" : "rent"}>
        <div className="property-card-photo" aria-hidden="true">
          {/* The API supplies signed media URLs at runtime. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {property.cover_url ? <img src={property.cover_thumbnail_url ?? property.cover_url} alt="" loading="lazy" decoding="async" /> : <Icon name="properties" />}
        </div>
        <div className="property-card-heading">
          <div className="property-card-badges">
            {selling ? <span className="property-card-sale">For sale</span> : null}
            <span className="property-card-verification" aria-label={badge} title={badge}>
              <Icon name={tone === "good" ? "verification" : "shield"} />
            </span>
          </div>
          <Link prefetch={false} href={details as never} className="property-card-link" data-property-id={property.id} onClick={() => onOpen(property)}>
            <span className="property-card-name">{title}</span>
          </Link>
          <p className="property-card-where">{location || "Address unavailable"}</p>
        </div>
        <div className="property-card-stats">
          {selling ? (
            <>
              <span className="property-card-stat is-price"><strong>{sale?.price_formatted ?? "Price not set"}</strong></span>
              {saleStatus ? <span className="property-card-stat">{saleStatus}</span> : null}
            </>
          ) : (
            <>
              <span className="property-card-stat"><strong>{property.occupied_unit_count}/{property.unit_count}</strong> occupied</span>
              <span className="property-card-stat is-available"><strong>{property.vacant_unit_count}</strong> available</span>
              <span className="property-card-occupancy" aria-hidden="true">
                <span style={{ width: `${property.unit_count ? Math.min(100, property.occupied_unit_count / property.unit_count * 100) : 0}%` }} />
              </span>
            </>
          )}
        </div>
        <div className="property-card-actions">
          {action === "continue" || action === "submit" ? (
            <Link prefetch={false} href={href as never} className="property-card-action property-card-setup">
              {propertyCardActionLabels[action]}
            </Link>
          ) : canAddUnit ? (
            <Link prefetch={false} href={("/record/space-new?propertyId=" + encodeURIComponent(property.id)) as never}
              className="property-card-action property-card-add-unit" onClick={inPlace(onAddUnit)}><Icon name="plus" />Add Unit</Link>
          ) : <span className="property-card-arrow" aria-hidden="true">→</span>}
        </div>
      </article>
    </li>
  );
}

/**
 * A quiet invitation to add the next Property beside the existing inventory.
 */
function AddPropertyCard({
  href,
  onClick,
}: {
  href: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link href={href as never} prefetch={false} className="property-add" onClick={onClick}>
      <span className="property-add-ghost" aria-hidden="true">
        <span className="property-add-ghost-line is-title" />
        <span className="property-add-ghost-line" />
        <span className="property-add-ghost-dots"><i /><i /><i /></span>
        <span className="property-add-ghost-photo" />
      </span>
      <span className="property-add-plus" aria-hidden="true"><Icon name="plus" /></span>
      <strong>Add a Property</strong>
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
              <span className="property-card-photo is-skeleton-photo" />
              <div className="property-card-heading">
                <span className="ws-skeleton-block is-thin" style={{ width: "28%" }} />
                <span className="ws-skeleton-block" style={{ width: "55%" }} />
                <span className="ws-skeleton-block is-thin" style={{ width: "40%" }} />
                <span className="ws-skeleton-block is-thin" style={{ width: "46%" }} />
              </div>
              <div className="property-card-actions"><span className="ws-skeleton-block" style={{ width: "36%", height: "var(--property-action-height)" }} /></div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Arrow keys move between cards the way the eye does. */
const movePropertyFocus = gridKeyNavigation(".property-card-link, .property-add");
