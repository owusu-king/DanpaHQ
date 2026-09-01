"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getOrganizationPortfolio,
  listGrantedLeases,
  listOrganizationProperties,
  listOrganizations,
  listPortfolioUnits,
  type Lease,
  type OrganizationPortfolio,
  type Property,
  type Unit,
} from "@/lib/console";

import { Icon, type IconName } from "./icons";

/**
 * Portfolio search, in the application header.
 *
 * It lives in the shell rather than on Home because it is a way of getting
 * anywhere, not a feature of one page — the same reason the navigation is in
 * the shell.
 *
 * It covers the four things a provider actually goes looking for by name:
 * Properties, Units, the people renting them, and agreements. Each row carries
 * enough context to tell two similar names apart — a Unit says which Property
 * it is in, a tenant says where they live, an agreement says its state.
 *
 * **Nothing is fetched until somebody uses it.** The index is loaded once, on
 * first focus, so a provider who never searches never pays for it and every
 * other page keeps the request count it had. The filtering is client-side over
 * that index; the API clients are the existing ones, so no lookup logic is
 * duplicated here and nothing decides access — every destination re-checks on
 * the server, exactly as it would from a link.
 */

type Row = { id: string; label: string; meta: string; href: string; icon: IconName };

export function PortalSearch({ organizationId }: { organizationId: string | null }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (index !== null || loading) return;
    setLoading(true);
    try {
      const orgId = organizationId ?? (await listOrganizations().catch(() => []))[0]?.id ?? null;
      if (!orgId) {
        setIndex([]);
        return;
      }
      const [properties, units, portfolio, leases] = await Promise.all([
        listOrganizationProperties(orgId).catch(() => [] as Property[]),
        listPortfolioUnits(orgId).catch(() => [] as Unit[]),
        getOrganizationPortfolio(orgId).catch(() => null as OrganizationPortfolio | null),
        listGrantedLeases().catch(() => [] as Lease[]),
      ]);
      setIndex([
        ...properties.map((property) => ({
          id: `property-${property.id}`,
          label: property.title,
          meta: [property.address?.locality_name, "Property"].filter(Boolean).join(" · "),
          href: `/properties/${property.id}`,
          icon: "properties" as const,
        })),
        ...units.map((unit) => ({
          id: `unit-${unit.id}`,
          label: unit.label || unit.space_type_label,
          meta: `${unit.property_title} · Unit`,
          href: `/properties/${unit.property_id}/spaces/${unit.id}`,
          icon: "units" as const,
        })),
        ...(portfolio?.tenants ?? []).map((tenant) => ({
          id: `tenant-${tenant.occupancy_id}`,
          label: tenant.name,
          meta: `${tenant.property_title} · ${tenant.unit_label} · Tenant`,
          // A tenancy record where there is one; the roster otherwise, rather
          // than a link to a page that would 404.
          href: tenant.tenancy_id ? `/tenancies/${tenant.tenancy_id}` : "/tenants",
          icon: "users" as const,
        })),
        ...leases.map((lease) => ({
          id: `lease-${lease.id}`,
          label: `${lease.tenant_name} · ${lease.unit_label}`,
          meta: `${lease.property_title} · Agreement ${lease.status_display.toLocaleLowerCase("en-GH")}`,
          href: `/leases/${lease.id}`,
          icon: "leases" as const,
        })),
      ]);
    } finally {
      setLoading(false);
    }
  }, [index, loading, organizationId]);

  // A Portfolio switch invalidates the index rather than serving another
  // Portfolio's Properties from memory.
  useEffect(() => {
    setIndex(null);
    setQuery("");
  }, [organizationId]);

  const needle = query.trim().toLocaleLowerCase("en-GH");
  const results = useMemo(() => {
    if (!needle || !index) return [];
    return index
      .filter((row) => `${row.label} ${row.meta}`.toLocaleLowerCase("en-GH").includes(needle))
      .slice(0, 7);
  }, [index, needle]);

  // Clicking away closes the panel; the field keeps what was typed so coming
  // back does not mean typing it again.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const showPanel = open && needle.length > 0;

  return (
    <div className="portal-search" ref={container}>
      <span className="portal-search-field">
        <Icon name="explore" />
        <label htmlFor="portal-search-input" className="sr-only">
          Search this Portfolio
        </label>
        <input
          id="portal-search-input"
          type="search"
          value={query}
          placeholder="Search Properties, Units, tenants or agreements"
          autoComplete="off"
          role="combobox"
          aria-controls="portal-search-results"
          aria-expanded={showPanel}
          onFocus={() => {
            setOpen(true);
            void load();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.currentTarget.blur();
            }
          }}
        />
      </span>

      {showPanel ? (
        <div className="portal-search-results" id="portal-search-results" role="listbox">
          {results.length ? (
            <ul>
              {results.map((row) => (
                <li key={row.id}>
                  <Link
                    href={row.href as never}
                    onClick={() => {
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <span>
                      <Icon name={row.icon} />
                    </span>
                    <span>
                      <strong>{row.label}</strong>
                      <small>{row.meta}</small>
                    </span>
                    <b aria-hidden="true">›</b>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>{index === null ? "Looking…" : "Nothing matches that."}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
