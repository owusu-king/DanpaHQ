"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { UnitWizardModal } from "./UnitWizard";
import { inPlace } from "@/lib/inPlace";
import { ApiFailure } from "@/lib/api";
import { listOrganizations, listOrganizationProperties, type Property } from "@/lib/console";
import { useSession } from "@/lib/session";

/** One creation sheet: choose an eligible Property here, or preselect it from its record. */
export function AddUnitButton({ className, children, propertyId: initialProperty = null, onChanged }: {
  className: string; children: ReactNode; propertyId?: string | null; onChanged?: () => void;
}) {
  const choices = usePropertyChoices();
  const [open, setOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const opening = useRef(0);
  useEffect(() => () => { opening.current += 1; }, []);

  const close = () => {
    opening.current += 1;
    setOpen(false);
  };

  async function start() {
    const request = ++opening.current;
    setSelectedProperty(initialProperty);
    setOpen(true);
    if (initialProperty) return;
    const eligible = await choices.load();
    if (request !== opening.current) return;
    // One eligible Property is not a choice. Go straight to the flow.
    if (eligible.length === 1) {
      setSelectedProperty(eligible[0]!.id);
      return;
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void start()}>
        {children}
      </button>
      <UnitWizardModal
        open={open}
        propertyId={selectedProperty}
        propertyPicker={<PropertyChoices choices={choices} onChoose={(property) => setSelectedProperty(property.id)} />}
        onClose={close}
        onChanged={onChanged}
        onFinished={() => undefined}
      />
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
    setProperties(null);
    setError("");
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
    .filter((property) => !property.billing_access || property.billing_access.state === "full")
    .sort((a, b) => a.title.localeCompare(b.title, "en-GH"));
}

export function PropertyChoices({ choices, onChoose }: { choices: Choices; onChoose?: (property: Property) => void }) {
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
              <Link href={`/record/space-new?propertyId=${property.id}` as never} className="unit-property-row" onClick={onChoose ? inPlace(() => onChoose(property)) : undefined}>
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
