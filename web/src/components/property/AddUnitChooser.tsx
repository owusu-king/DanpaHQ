"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { listOrganizations, listOrganizationProperties, type Property } from "@/lib/console";
import { useSession } from "@/lib/session";

/**
 * "Add Unit" from outside a Property: one small modal to choose which Property
 * it goes in, then the creation flow that already exists (owner, 2026-10-05: a
 * whole page for one choice was too much).
 *
 * Nothing here creates anything. From Property → Add Unit the Property is
 * already known and this is skipped.
 */
export function AddUnitButton({ className, children }: { className: string; children: ReactNode }) {
  const router = useRouter();
  const choices = usePropertyChoices();
  const [open, setOpen] = useState(false);

  async function start() {
    const eligible = await choices.load();
    // One eligible Property is not a choice. Go straight to the flow.
    if (eligible.length === 1) {
      router.push(`/properties/${eligible[0]!.id}/spaces/new` as never);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void start()}>
        {children}
      </button>
      <ModalSheet
        open={open}
        onClose={() => setOpen(false)}
        icon="units"
        title="Add Unit"
        meta="Choose its Property."
        size="sm"
      >
        <PropertyChoices choices={choices} />
      </ModalSheet>
    </>
  );
}

type Choices = ReturnType<typeof usePropertyChoices>;

/** The Properties a Unit may be added to, loaded on demand. */
export function usePropertyChoices() {
  const { activeContext } = useSession();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState("");

  const activeId = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";

  const load = useCallback(async (): Promise<Property[]> => {
    try {
      const organizations = await listOrganizations();
      const chosen = organizations.find((row) => row.id === activeId) ?? organizations[0];
      const rows = chosen ? await listOrganizationProperties(chosen.id) : [];
      setProperties(rows);
      setError("");
      return eligibleOf(rows);
    } catch (cause) {
      setProperties([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Properties.");
      return [];
    }
  }, [activeId]);

  return { properties, error, load };
}

/**
 * Only Properties this person may actually add a Unit to. The backend refuses
 * the rest anyway; offering them would be a menu of dead ends.
 */
function eligibleOf(properties: Property[]) {
  return properties
    .filter((property) => property.capabilities.private_inventory?.allowed)
    // A property for sale is sold whole and takes no Units (`assert_is_for_letting`).
    .filter((property) => property.purpose !== "sale")
    .sort((a, b) => a.title.localeCompare(b.title, "en-GH"));
}

export function PropertyChoices({ choices }: { choices: Choices }) {
  const { properties, error } = choices;
  const [query, setQuery] = useState("");

  const eligible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return eligibleOf(properties ?? []).filter((property) => !needle
      || `${property.title} ${property.address?.locality_name ?? ""}`.toLocaleLowerCase("en-GH").includes(needle));
  }, [properties, query]);

  if (error) return <Notice tone="error" title={error} />;
  if (properties === null) return <LoadingRows rows={3} />;

  return (
    <div className="unit-chooser">
      {eligibleOf(properties).length > 6 ? (
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
      {eligible.length ? (
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
      ) : (
        <p className="type-caption unit-chooser-empty">
          {query
            ? "No Property matches that name or area."
            : "No Property can take a Unit yet. Confirm one as yours to let first."}{" "}
          {query ? null : <Link href="/properties">Open Properties</Link>}
        </p>
      )}
    </div>
  );
}
