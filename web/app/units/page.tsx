"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { AddUnitButton } from "@/components/property/AddUnitChooser";
import { Icon } from "@/components/portal/icons";
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
  listPortfolioUnits,
  type Unit,
} from "@/lib/console";
import { useSession } from "@/lib/session";

type View = "all" | "available" | "public" | "occupied" | "attention";
type Sort = "property" | "label" | "state";

const SORTS: { value: Sort; label: string }[] = [
  { value: "property", label: "Property" },
  { value: "label", label: "Unit name" },
  { value: "state", label: "Needs attention first" },
];

/** Where someone was when they opened a Unit, so Back lands them there. */
const RETURN_KEY = "units.return";
const RETURN_WINDOW_MS = 30 * 60 * 1000;
type ReturnPoint = { view: View; query: string; propertyId: string; sort: Sort; id: string; y: number; at: number };

/**
 * On Explore right now — not merely offered to it.
 *
 * `publication.state` says the provider is offering this space publicly, but
 * that is true of a listing waiting in the review queue, one a reviewer has
 * flagged, and one Management has suspended. Public search shows none of them:
 * it filters on `status == "active"`. Reading both fields is what makes the
 * count on this tab the same set a tenant can actually find.
 */
const isPublic = (unit: Unit) =>
  unit.publication.state === "published" &&
  unit.publication.listing_status === "active";

/**
 * Every Unit in the Portfolio, in one place.
 *
 * Property → Units answers "what is inside this building". This answers
 * "where is Room 4", which is the question a provider with multiple
 * Properties actually has. It sits in the shared workspace frame: the stages
 * as a segmented control, then one panel whose head finds a Unit (search,
 * Property, order) and whose canvas holds the photo-led cards.
 */
export default function UnitsPage() {
  const { activeContext } = useSession();

  const [units, setUnits] = useState<Unit[] | null>(null);
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<Sort>("property");
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [returnedTo, setReturnedTo] = useState<string | null>(null);
  const pendingReturn = useRef<ReturnPoint | null>(null);

  const activeId = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";

  const load = useCallback(async () => {
    try {
      const organizations = await listOrganizations();

      setHasPortfolio(organizations.length > 0);

      const chosen =
        organizations.find((row) => row.id === activeId) ??
        organizations[0];

      setUnits(
        chosen ? await listPortfolioUnits(chosen.id) : [],
      );

      setError("");
    } catch (cause) {
      setUnits((current) => current ?? []);
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not load your Units.",
      );
    }
  }, [activeId]);

  useEffect(() => {
    // Restored in an effect rather than initial state, so the server render and
    // the first client render agree.
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) ?? "null") as ReturnPoint | null;
      window.sessionStorage.removeItem(RETURN_KEY);
      if (saved && Date.now() - saved.at < RETURN_WINDOW_MS) {
        pendingReturn.current = saved;
        setView(saved.view);
        setQuery(saved.query);
        setPropertyId(saved.propertyId);
        setSort(saved.sort);
      }
    } catch {
      // Storage can be unavailable; the page simply opens at the top.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const properties = useMemo(() => {
    const seen = new Map<string, string>();

    for (const unit of units ?? []) {
      seen.set(unit.property_id, unit.property_title);
    }

    return [...seen].sort((a, b) =>
      a[1].localeCompare(b[1], "en-GH"),
    );
  }, [units]);

  // Counts follow the Property filter, so the stages always describe the
  // Units the person is actually looking at.
  const scoped = useMemo(
    () => (units ?? []).filter((unit) => !propertyId || unit.property_id === propertyId),
    [units, propertyId],
  );

  const counts = useMemo(
    () => ({
      all: scoped.length,
      available: scoped.filter(
        (unit) => unit.availability.state === "available",
      ).length,
      public: scoped.filter(isPublic).length,
      occupied: scoped.filter(
        (unit) => unit.availability.state === "occupied",
      ).length,
      attention: scoped.filter(needsAttention).length,
    }),
    [scoped],
  );

  const totals = useMemo(() => ({
    all: units?.length ?? 0,
    available: (units ?? []).filter((unit) => unit.availability.state === "available").length,
    occupied: (units ?? []).filter((unit) => unit.availability.state === "occupied").length,
    attention: (units ?? []).filter(needsAttention).length,
  }), [units]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");

    return scoped
      .filter(
        (unit) =>
          view === "all" ||
          (view === "attention"
            ? needsAttention(unit)
            : view === "public"
              ? isPublic(unit)
              : unit.availability.state === view),
      )
      .filter(
        (unit) =>
          !needle ||
          `${unit.label} ${unit.property_title} ${unit.space_type_label}`
            .toLocaleLowerCase("en-GH")
            .includes(needle),
      )
      .sort((a, b) => {
        if (sort === "label") {
          return a.label.localeCompare(b.label, "en-GH");
        }

        if (sort === "state") {
          return (
            (needsAttention(b) ? 1 : 0) -
              (needsAttention(a) ? 1 : 0) ||
            a.availability.state.localeCompare(
              b.availability.state,
            )
          );
        }

        return (
          a.property_title.localeCompare(
            b.property_title,
            "en-GH",
          ) || a.label.localeCompare(b.label, "en-GH")
        );
      });
  }, [scoped, view, query, sort]);

  // If the stage being shown disappears (the last flagged Unit was fixed), fall
  // back to All rather than showing an empty tab nobody can select.
  useEffect(() => {
    if (view === "attention" && units && !counts.attention) setView("all");
  }, [counts.attention, units, view]);

  // Coming back from a Unit: the same filters, the same place, and a brief
  // mark on the card that was opened so the eye finds its way back.
  useLayoutEffect(() => {
    const saved = pendingReturn.current;
    if (!saved || !units) return;
    pendingReturn.current = null;
    window.scrollTo({ top: saved.y, behavior: "instant" });
    setReturnedTo(saved.id);
    document.querySelector<HTMLAnchorElement>(`[data-unit-id="${CSS.escape(saved.id)}"]`)?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setReturnedTo(null), 1600);
    return () => window.clearTimeout(timer);
  }, [units]);

  function remember(unit: Unit) {
    try {
      const point: ReturnPoint = { view, query, propertyId, sort, id: unit.id, y: window.scrollY, at: Date.now() };
      window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(point));
    } catch {
      // Without storage, Back simply opens Units at the top.
    }
  }

  async function retry() {
    setRetrying(true);
    await load();
    setRetrying(false);
  }

  function clearFilters() {
    setQuery("");
    setPropertyId("");
    setView("all");
  }

  const loading = units === null && !error;
  const failed = Boolean(error) && !(units?.length);
  const noUnits = !loading && !failed && (hasPortfolio === false || totals.all === 0);
  const hasUnits = Boolean(units?.length);

  const segments = [
    { key: "all" as const, label: "All", count: counts.all },
    { key: "available" as const, label: "Available", count: counts.available },
    { key: "public" as const, label: "Public", count: counts.public },
    { key: "occupied" as const, label: "Occupied", count: counts.occupied },
    // A filter nobody can act on is noise: Attention appears only when it exists.
    ...(counts.attention ? [{ key: "attention" as const, label: "Attention", count: counts.attention }] : []),
  ];

  return (
    <div className="ws-page units-workspace">
      <WorkspaceHead
        icon="units"
        title="Units"
        summary={hasUnits ? (
          <>
            <strong>{totals.all} {totals.all === 1 ? "Unit" : "Units"}</strong>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.available} available
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.occupied} occupied
            {totals.attention ? (
              <>
                <span className="ws-summary-sep" aria-hidden="true">·</span>
                <span data-tone="warning">{totals.attention} need{totals.attention === 1 ? "s" : ""} attention</span>
              </>
            ) : null}
          </>
        ) : null}
        actions={hasUnits ? (
          <AddUnitButton className="ws-action">
            <PlusGlyph />Add Unit
          </AddUnitButton>
        ) : null}
      />

      {loading || hasUnits ? (
        <SegmentedControl
          label="Unit state"
          value={view}
          disabled={loading}
          options={segments}
          onChange={setView}
        />
      ) : null}

      <section className={`ws-panel${hasUnits && visible.length ? " is-canvas" : ""}`} aria-label="Units" aria-busy={loading || undefined}>
        {hasUnits ? (
          <div className="ws-panel-head units-panel-head">
            <div className="ws-panel-tools">
              <PanelSearch label="Search Units" placeholder="Search Unit or Property" value={query} onChange={setQuery} />
              {properties.length > 1 ? (
                <FilterMenu
                  label="Property"
                  icon="properties"
                  value={propertyId || "any"}
                  active={Boolean(propertyId)}
                  options={[
                    { value: "any", label: "All Properties" },
                    ...properties.map(([id, title]) => ({
                      value: id,
                      label: title,
                      count: (units ?? []).filter((unit) => unit.property_id === id).length,
                    })),
                  ]}
                  onChange={(value) => setPropertyId(value === "any" ? "" : value)}
                />
              ) : null}
              <FilterMenu label="Sort" icon="filters" prefix="Sort" value={sort} options={SORTS} onChange={setSort} />
            </div>
            <p className="ws-range">
              <strong>{visible.length}</strong> of {counts.all}
            </p>
          </div>
        ) : null}

        {error && hasUnits ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" />
            <span>{error}</span>
            <button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "Retrying…" : "Try again"}</button>
          </div>
        ) : null}

        {loading ? <UnitCardsSkeleton /> : null}

        {failed ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Units didn’t load"
            body={error}
            action={<Button variant="secondary" size="sm" busy={retrying} busyLabel="Retrying…" onClick={() => void retry()}>Try again</Button>}
          />
        ) : null}

        {noUnits ? (
          <PanelState
            icon="units"
            title="No Units yet"
            body="Units are the rentable spaces inside a Property — a room, a flat, a shop."
            action={(
              <span className="units-empty-actions">
                <AddUnitButton className="btn btn-secondary btn-sm">Add Unit</AddUnitButton>
                <Link href="/properties" className="btn btn-quiet btn-sm">Open Properties</Link>
              </span>
            )}
          />
        ) : null}

        {hasUnits && !visible.length ? (
          <PanelState
            icon="units"
            title={query.trim() ? `No Unit matches “${query.trim()}”` : "No matching Unit"}
            body="Try another name, Property or filter."
            action={<Button variant="quiet" size="sm" onClick={clearFilters}>Clear filters</Button>}
          />
        ) : null}

        {hasUnits && visible.length ? (
          <div className="ws-canvas units-canvas" key={`${view}-${propertyId}-${sort}-${query.trim() ? "q" : ""}`} onKeyDown={moveUnitFocus}>
            <ul className="units-grid">
              {visible.map((unit, index) => (
                <UnitCard
                  key={unit.id}
                  unit={unit}
                  order={index}
                  returned={returnedTo === unit.id}
                  onOpen={remember}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/**
 * A Unit, recognized the way a person recognizes a room: its photograph first,
 * then its name and building, then whether it is free. Anything more belongs to
 * the Unit itself; the card raises a flag only when something is wrong.
 */
function UnitCard({
  unit,
  order,
  returned,
  onOpen,
}: {
  unit: Unit;
  order: number;
  returned: boolean;
  onOpen: (unit: Unit) => void;
}) {
  const photo =
    unit.primary_photo?.download_url ?? null;

  const flag = attentionLabel(unit);

  return (
    <li
      className={`unit-card-item${returned ? " is-returned" : ""}`}
      style={{ "--unit-order": Math.min(order, 12) } as React.CSSProperties}
    >
      <Link
        href={
          `/record/space?propertyId=${unit.property_id}&spaceId=${unit.id}` as never
        }
        className="unit-card"
        data-unit-id={unit.id}
        data-flagged={flag ? "" : undefined}
        onClick={() => onOpen(unit)}
        aria-label={`${unit.label}, ${unit.property_title}. ${unit.availability.label}.${flag ? ` ${flag}.` : ""}`}
      >
        <span className="unit-card-photo">
          {photo ? (
            // Short-lived signed URL from the files service,
            // not a static asset.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" loading="lazy" />
          ) : (
            <span className="unit-card-nophoto" aria-hidden="true">
              <Icon name="photos" />
              <small>No photo yet</small>
            </span>
          )}
          <span
            className={`unit-card-state is-${unit.availability.state}`}
          >
            <i aria-hidden="true" />
            {unit.availability.label}
          </span>
        </span>

        <span className="unit-card-body">
          <span className="unit-card-title">
            <strong>{unit.label}</strong>
            <small>{unit.space_type_label}</small>
          </span>

          <span className="unit-card-where">
            <Icon name="properties" />
            <span>{unit.property_title}</span>
          </span>

          {flag ? (
            <span className="unit-card-flag">
              <Icon name="warning" />
              {flag}
            </span>
          ) : null}

          <span className="unit-card-open" aria-hidden="true">
            Open
            <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
              <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Loading keeps the cards' shape, so nothing jumps when the Units land. */
function UnitCardsSkeleton() {
  return (
    <div className="ws-canvas units-canvas" aria-busy="true" aria-label="Loading Units">
      <ul className="units-grid">
        {Array.from({ length: 8 }).map((_, index) => (
          <li key={index} className="unit-card-item" style={{ "--unit-order": index } as React.CSSProperties}>
            <div className="unit-card is-skeleton">
              <span className="unit-card-photo"><span className="ws-skeleton-block unit-skeleton-photo" /></span>
              <span className="unit-card-body">
                <span className="ws-skeleton-block" style={{ width: "46%" }} />
                <span className="ws-skeleton-block is-thin" style={{ width: "68%" }} />
              </span>
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
const moveUnitFocus = gridKeyNavigation(".unit-card");

/**
 * Something is wrong or waiting on somebody.
 *
 * A private Unit is a normal, deliberate state and
 * should not be treated as an attention state.
 */
function needsAttention(unit: Unit) {
  return (
    [
      "changes_requested",
      "rejected",
      "suspended",
      "expired",
    ].includes(unit.verification.state) ||
    unit.availability.state === "expired"
  );
}

function attentionLabel(unit: Unit) {
  if (
    unit.verification.state === "changes_requested"
  ) {
    return "Changes requested";
  }

  if (unit.verification.state === "rejected") {
    return "Rejected";
  }

  if (unit.verification.state === "suspended") {
    return "Suspended";
  }

  if (unit.verification.state === "expired") {
    return "Verification expired";
  }

  if (unit.availability.state === "expired") {
    return "Listing expired";
  }

  return "";
}
