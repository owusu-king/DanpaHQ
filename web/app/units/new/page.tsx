"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { listOrganizations, listOrganizationProperties, type Property } from "@/lib/console";
import { useSession } from "@/lib/session";

/**
 * The one step a Unit needs before the existing creation flow can start: which
 * Property it belongs to.
 *
 * Coming from Property → Add Unit, this screen is skipped entirely — the
 * Property is already known. Nothing here creates anything; it chooses, then
 * hands over to the flow that already exists.
 */
export default function AddUnitPage() {
  const router = useRouter();
  const { activeContext } = useSession();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const activeId = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";

  const load = useCallback(async () => {
    try {
      const organizations = await listOrganizations();
      const chosen = organizations.find((row) => row.id === activeId) ?? organizations[0];
      setProperties(chosen ? await listOrganizationProperties(chosen.id) : []);
      setError("");
    } catch (cause) {
      setProperties([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Properties.");
    }
  }, [activeId]);

  useEffect(() => { void load(); }, [load]);

  // Only Properties this person may actually add a Unit to. The backend refuses
  // the rest anyway; offering them would be a menu of dead ends.
  const eligible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (properties ?? [])
      .filter((property) => property.capabilities.private_inventory?.allowed)
      .filter((property) => !needle
        || `${property.title} ${property.address?.locality_name ?? ""}`.toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title, "en-GH"));
  }, [properties, query]);

  // One eligible Property is not a choice. Go straight to the flow.
  useEffect(() => {
    if (properties && !query && eligible.length === 1) {
      router.replace(`/properties/${eligible[0]!.id}/spaces/new` as never);
    }
  }, [properties, query, eligible, router]);

  return (
    <div className="units-workspace">
      <PageHeader
        title="Add Unit"
        description="Choose the Property it belongs to."
        actions={<Link href={"/units" as never}>Back to Units</Link>}
      />

      {error ? <Notice tone="error" title={error} /> : null}
      {properties === null ? <LoadingRows rows={4} /> : null}

      {properties && eligible.length === 0 ? (
        <Empty
          title={query ? "No matching Property" : "No Property can take a Unit yet"}
          body={query
            ? "Try another name or area."
            : "A Property has to be confirmed as yours to let before you can add Units to it."}
          action={<Link href="/properties" className="button-link">Open Properties</Link>}
        />
      ) : null}

      {properties && eligible.length ? (
        <>
          {properties.length > 6 ? (
            <label className="units-search">
              <span className="sr-only">Search Properties</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Property"
              />
            </label>
          ) : null}
          <ul className="unit-property-list">
            {eligible.map((property) => (
              <li key={property.id}>
                <Link href={`/properties/${property.id}/spaces/new` as never} className="unit-property-row">
                  <span>
                    <strong className="type-body-strong">{property.title}</strong>
                    <br />
                    <span>{property.address?.locality_name ?? property.property_type}</span>
                  </span>
                  <span>{property.unit_count} {property.unit_count === 1 ? "Unit" : "Units"} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
