"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { StatusLine, propertyStatus } from "@/components/property/WorkspacePatterns";
import { ApiFailure } from "@/lib/api";
import {
  listOrganizations,
  listProperties,
  type Organization,
  type Property,
} from "@/lib/console";
import { propertyNextStep } from "@/lib/providerSetup";
import { useSession } from "@/lib/session";

function PropertiesContent() {
  const search = useSearchParams();
  const justCreated = Boolean(search.get("created"));
  const { state, activeContext } = useSession();
  const provider = state.status === "signed_in" ? state.me.capabilities.provider : null;
  const canCreateProperty = provider?.can_create_property ?? false;
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [rows, orgs] = await Promise.all([
        listProperties(),
        listOrganizations().catch(() => [] as Organization[]),
      ]);
      setProperties(rows);
      setOrganizations(orgs);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load properties.");
      setProperties([]);
      setOrganizations([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const organizationId =
    organizations?.find((organization) => organization.id === preferred)?.id
    ?? organizations?.[0]?.id
    ?? "";
  const loading = properties === null || organizations === null;
  const next = propertyNextStep({
    canCreateProperty,
    hasWorkspace: (organizations?.length ?? 0) > 0,
    organizationId,
  });

  return (
    <div>
      <PageHeader
        title="Properties"
        description={
          loading
            ? "Buildings and rentable spaces in this Portfolio."
            : `${properties.length} ${properties.length === 1 ? "Property" : "Properties"} in this Portfolio.`
        }
        actions={
          loading || !canCreateProperty
            ? null
            : <Link href={next.href as never} className="button-link">Add property</Link>
        }
      />

      {provider && !canCreateProperty ? (
        <Notice
          tone="info"
          title="Property creation is not available yet"
          body="You can review this Portfolio while your provider verification is in progress."
        />
      ) : null}
      {justCreated ? (
        <Notice tone="success" title="Property added" body="It is private until you choose to verify and publish its Units." />
      ) : null}
      {error ? <Notice tone="error" title={error} body="Try loading the Portfolio again." /> : null}

      {loading ? <LoadingRows rows={4} /> : null}
      {!loading && properties.length === 0 ? (
        <Empty
          title={organizations.length ? "No Properties yet" : "Add your first Property"}
          body={next.reason}
          action={
            canCreateProperty
              ? <Link href={next.href as never} className="button-link">Add property</Link>
              : undefined
          }
        />
      ) : null}

      {!loading && properties.length ? (
        <ul className="inventory-list" aria-label="Properties">
          {properties.map((property) => <PropertyRow key={property.id} property={property} />)}
        </ul>
      ) : null}
    </div>
  );
}

export default function PropertiesPage() {
  return (
    <Suspense fallback={<LoadingRows rows={4} />}>
      <PropertiesContent />
    </Suspense>
  );
}

function PropertyRow({ property }: { property: Property }) {
  const status = propertyStatus(property);
  const location = property.address
    ? `${property.address.locality_name}, ${property.address.district_name}`
    : "Address unavailable";
  const units = `${property.unit_count} ${property.unit_count === 1 ? "Unit" : "Units"}`;
  const occupancy = property.unit_count
    ? `${property.occupied_unit_count} occupied · ${property.vacant_unit_count} available`
    : "No Units added";

  return (
    <li className="inventory-row">
      <Link
        href={`/properties/${property.id}` as never}
        className="inventory-row-link inventory-row-with-media inventory-row-with-stat"
      >
        <div className="inventory-thumb">
          {/* Signed media URLs are supplied at runtime by the API and are not
              stable Next image-loader resources. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {property.cover_url ? <img src={property.cover_url} alt="" /> : <span>No photo</span>}
        </div>
        <div>
          <p className="inventory-row-title">{property.title || "Untitled property"}</p>
          <p className="inventory-row-meta">{location}</p>
        </div>
        <div className="inventory-row-status">
          <StatusLine label={status.label} tone={status.tone} />
        </div>
        <div className="inventory-row-stat">
          <strong style={{ color: "var(--color-ink-900)", fontWeight: 600 }}>{units}</strong>
          <br />
          {occupancy}
        </div>
        <span className="inventory-row-arrow" aria-hidden="true">›</span>
      </Link>
    </li>
  );
}
