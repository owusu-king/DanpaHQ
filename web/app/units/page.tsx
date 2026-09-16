"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  listOrganizations,
  listPortfolioUnits,
  type Unit,
} from "@/lib/console";
import { useSession } from "@/lib/session";

type View = "all" | "available" | "public" | "occupied" | "attention";
type Sort = "property" | "label" | "state";

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
 * Properties actually has.
 */
const SORTS = [
  ["property", "Property"],
  ["label", "Unit name"],
  ["state", "Needs attention first"],
] as const;

export default function UnitsPage() {
  const { activeContext } = useSession();

  const [units, setUnits] = useState<Unit[] | null>(null);
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<Sort>("property");
  const [error, setError] = useState("");

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
      setUnits([]);
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not load your Units.",
      );
    }
  }, [activeId]);

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

  const counts = useMemo(
    () => ({
      all: units?.length ?? 0,
      available: (units ?? []).filter(
        (unit) => unit.availability.state === "available",
      ).length,
      public: (units ?? []).filter(isPublic).length,
      occupied: (units ?? []).filter(
        (unit) => unit.availability.state === "occupied",
      ).length,
      attention: (units ?? []).filter(needsAttention).length,
    }),
    [units],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");

    return (units ?? [])
      .filter(
        (unit) =>
          !propertyId || unit.property_id === propertyId,
      )
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
  }, [units, propertyId, view, query, sort]);

  /*
   * Loading
   */
  if (units === null && !error) {
    return (
      <div className="units-workspace">
        <PageHeader
          title="Units"
          description="Units and rentable spaces in this Portfolio."
        />

        <LoadingRows rows={4} />
      </div>
    );
  }

  /*
   * Empty portfolio / no units
   */
  if (hasPortfolio === false || counts.all === 0) {
    return (
      <div className="units-workspace">
        <PageHeader
          title="Units"
          description={`${counts.all} ${
            counts.all === 1 ? "Unit" : "Units"
          } in this Portfolio.`}
        />

        {error ? (
          <Notice tone="error" title={error} />
        ) : null}

        <Empty
          icon="units"
          title="No Units yet"
          body="Units are the rentable spaces inside a Property — a room, a flat, a shop."
          action={
            <Link
              href="/properties"
              className="button-link"
            >
              Open Properties
            </Link>
          }
        />
      </div>
    );
  }

  /*
   * Main page
   */
  return (
    <div className="units-workspace">
      <PageHeader
        title="Units"
        description={`${counts.all} ${
          counts.all === 1 ? "Unit" : "Units"
        } in this Portfolio.`}
        actions={
          <Link
            href={"/units/new" as never}
            className="button-link"
          >
            Add Unit
          </Link>
        }
      />

      {error ? (
        <Notice tone="error" title={error} />
      ) : null}

      <div className="units-controls">
        <label className="units-search">
          <span className="sr-only">Search Units</span>

          <input
            type="search"
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Search Unit or Property"
          />
        </label>

        {properties.length > 1 ? (
          <Select
            compact
            label="Property"
            value={propertyId}
            onChange={setPropertyId}
            options={[["", "All Properties"] as const, ...properties]}
          />
        ) : null}

        <Select
          compact
          label="Sort"
          value={sort}
          onChange={(value) => setSort(value as Sort)}
          options={SORTS}
        />
      </div>

      <div
        className="units-tabs"
        role="tablist"
        aria-label="Unit state"
      >
        <Tab
          selected={view === "all"}
          onSelect={() => setView("all")}
        >
          All <span>{counts.all}</span>
        </Tab>

        <Tab
          selected={view === "available"}
          onSelect={() => setView("available")}
        >
          Available <span>{counts.available}</span>
        </Tab>

        <Tab
          selected={view === "public"}
          onSelect={() => setView("public")}
        >
          Public <span>{counts.public}</span>
        </Tab>

        <Tab
          selected={view === "occupied"}
          onSelect={() => setView("occupied")}
        >
          Occupied <span>{counts.occupied}</span>
        </Tab>

        {counts.attention ? (
          <Tab
            selected={view === "attention"}
            onSelect={() => setView("attention")}
          >
            Attention <span>{counts.attention}</span>
          </Tab>
        ) : null}
      </div>

      {visible.length ? (
        <>
          <p className="units-count">
            {visible.length} of {counts.all}
          </p>

          <ul className="units-grid">
            {visible.map((unit) => (
              <UnitCard
                key={unit.id}
                unit={unit}
              />
            ))}
          </ul>
        </>
      ) : (
        <Empty
          icon="units"
          title="No matching Unit"
          body="Try another name, Property or filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setPropertyId("");
                setView("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}
    </div>
  );
}

function UnitCard({ unit }: { unit: Unit }) {
  const photo =
    unit.primary_photo?.download_url ?? null;

  const flag = attentionLabel(unit);

  return (
    <li>
      <Link
        href={
          `/properties/${unit.property_id}/spaces/${unit.id}` as never
        }
        className="unit-card"
      >
        <span className="unit-card-photo">
          {photo ? (
            // Short-lived signed URL from the files service,
            // not a static asset.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" />
          ) : (
            <span>No photo</span>
          )}
        </span>

        <span className="unit-card-body">
          <strong>{unit.label}</strong>

          <span className="unit-card-where">
            {unit.property_title}
          </span>

          <span
            className={`unit-card-state is-${unit.availability.state}`}
          >
            <i />
            {unit.availability.label}
          </span>

          {flag ? (
            <span className="unit-card-flag">
              {flag}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function Tab({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className="units-tab type-body-strong"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight"
        ) {
          return;
        }

        const tabs = Array.from(
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
            "[role=tab]",
          ) ?? [],
        );

        const current = tabs.indexOf(
          event.currentTarget,
        );

        const next =
          tabs[
            (current +
              (event.key === "ArrowRight" ? 1 : -1) +
              tabs.length) %
              tabs.length
          ];

        event.preventDefault();
        next?.focus();
        next?.click();
      }}
    >
      {children}
    </button>
  );
}

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
