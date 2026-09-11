"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows } from "@/components/portal/PageHeader";
import { PropertyLifecycle, PropertyMore } from "@/components/property/PropertyLifecycle";
import {
  DetailDisclosure,
  EntityHeader,
  EntityPath,
  StatusLine,
  propertyStatus,
  spaceStatus,
} from "@/components/property/WorkspacePatterns";
import { ApiFailure } from "@/lib/api";
import {
  getProperty,
  getPropertyAmenities,
  listUnits,
  type Property,
  type SpaceAmenity,
  type Unit,
} from "@/lib/console";
import { describePropertySetup, toSetupInput } from "@/lib/propertySetup";
import { getVerification, type VerificationProgress } from "@/lib/verification";

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [prop, unitList, progress, amenityState] = await Promise.all([
        getProperty(id),
        listUnits(id),
        getVerification("property", id),
        getPropertyAmenities(id),
      ]);
      setProperty(prop);
      setUnits(unitList);
      setPhotos(progress);
      setAmenities(amenityState.chosen);
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Property.");
    }
  }, [id, router]);

  useEffect(() => { void load(); }, [load]);

  if (error && !property) {
    return (
      <div>
        <EntityPath items={[{ label: "Properties", href: "/properties" }, { label: "Unavailable" }]} />
        <Notice tone="error" title={error} body="Return to Properties and try again." />
      </div>
    );
  }

  if (!property) return <LoadingRows rows={5} />;

  const address = property.address;
  const fullAddress = address
    ? [address.house_number, address.street, address.locality_name, address.district_name]
        .filter(Boolean)
        .join(", ")
    : "No address recorded";
  const steps = describePropertySetup(
    toSetupInput(
      property,
      photos,
      amenities !== null && property.amenities_confirmed_at ? amenities.length : null,
    ),
  );
  const status = propertyStatus(property);
  // A property above its Portfolio's plan allowance takes no new units. The API
  // refuses regardless; this only stops offering what it would refuse.
  const access = property.billing_access;
  const restricted = Boolean(access && access.state !== "full");
  const canAddUnit = (property.capabilities.private_inventory?.allowed ?? false) && !restricted;
  const edit = property.permitted_actions.edit;
  // Unfinished and exceptional states own their next action in the lifecycle
  // band beside the explanation. The entity header becomes operational only
  // once management can continue, avoiding two identical primary controls.
  const lifecycleOwnsPrimary = !["verified", "pending_verification"].includes(
    property.verification.review_state,
  );
  const primary = !lifecycleOwnsPrimary && canAddUnit
    ? { href: `/properties/${property.id}/spaces/new`, label: "Add Unit" }
    : null;

  return (
    <div>
      <EntityPath items={[{ label: "Properties", href: "/properties" }, { label: property.title || "Property" }]} />
      <EntityHeader
        eyebrow={propertyTypeLabel(property.property_type)}
        title={property.title || "Untitled property"}
        subtitle={fullAddress}
        status={<StatusLine label={status.label} tone={status.tone} />}
        actions={primary ? <Link href={primary.href as never} className="button-link">{primary.label}</Link> : undefined}
      />

      {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
      {access && restricted ? (
        <Notice
          tone={access.state === "wind_down" ? "warning" : "info"}
          title={access.state === "wind_down" ? "Winding down on your current plan" : "Read-only on your current plan"}
          body={`${access.message} Manage this in Settings → Plan & billing.`}
        />
      ) : null}
      <PropertyLifecycle property={property} steps={steps} onChanged={load} compact />

      <section className="workspace-section" aria-labelledby="units-heading">
        <div className="workspace-section-head">
          <h2 id="units-heading">Units <span style={{ color: "var(--color-ink-500)", fontWeight: 400 }}>({units.length})</span></h2>
          {canAddUnit && primary?.label !== "Add Unit" ? (
            <Link href={`/properties/${property.id}/spaces/new` as never}>Add Unit</Link>
          ) : null}
        </div>

        {units.length === 0 ? (
          <Empty
            title="No Units yet"
            body="Add the room, apartment, shop or other space a tenant can rent."
          />
        ) : (
          <ul className="unit-columns" aria-label={`Units at ${property.title}`}>
            {units.map((unit) => <UnitTile key={unit.id} propertyId={property.id} unit={unit} />)}
          </ul>
        )}
        {units.length ? (
          <p style={{ margin: "var(--space-4) 0 0" }}>
            <Link href={"/tenants" as never} className="quiet-link">
              Manage tenant access and tenancies →
            </Link>
          </p>
        ) : null}
      </section>

      <section className="workspace-section" aria-labelledby="about-property-heading">
        <div className="workspace-section-head"><h2 id="about-property-heading">About this Property</h2></div>
        <DetailDisclosure title="Property information">
          <dl className="fact-grid">
            <div><dt>Type</dt><dd>{propertyTypeLabel(property.property_type)}</dd></div>
            <div><dt>Address</dt><dd>{fullAddress}</dd></div>
            {address?.digital_address ? <div><dt>Digital address</dt><dd style={{ fontFamily: "var(--font-mono)" }}>{address.digital_address}</dd></div> : null}
            {address?.landmark ? <div><dt>Landmark</dt><dd>{address.landmark}</dd></div> : null}
            <div><dt>Water</dt><dd>{valueLabel(property.water_source)}</dd></div>
            <div><dt>Power meter</dt><dd>{valueLabel(property.power_meter_type)}</dd></div>
            <div><dt>Compound</dt><dd>{valueLabel(property.compound_type)}</dd></div>
            <div><dt>Security</dt><dd>{property.has_security ? "Security recorded" : "Not recorded"}</dd></div>
          </dl>
          {edit?.allowed ? <p style={{ margin: "var(--space-5) 0 0" }}><Link href={`/properties/${property.id}/setup` as never} className="quiet-link">Edit Property information →</Link></p> : null}
        </DetailDisclosure>
        <DetailDisclosure title={`Shared amenities${amenities?.length ? ` (${amenities.length})` : ""}`}>
          {amenities === null ? <LoadingRows rows={2} /> : amenities.length ? (
            <p className="type-body" style={{ margin: 0 }}>{amenities.map((amenity) => amenity.name).join(" · ")}</p>
          ) : <p className="type-caption" style={{ margin: 0 }}>No shared amenities recorded.</p>}
          {edit?.allowed ? <p style={{ margin: "var(--space-4) 0 0" }}><Link href={`/properties/${property.id}/setup?step=amenities` as never} className="quiet-link">Edit shared amenities →</Link></p> : null}
        </DetailDisclosure>
      </section>

      <PropertyMore property={property} />
    </div>
  );
}

/**
 * A Unit inside its Property, five across.
 *
 * One per line put a hostel's fortieth room a long way below the fold, and a
 * row is mostly the whitespace between four short facts. Units are told apart
 * by sight before they are told apart by name, so the photograph leads.
 *
 * Bath count moves to the Unit itself: at this width the meta line is one
 * ellipsised line, and the two facts that identify a Unit here are what kind of
 * space it is and how big.
 */
function UnitTile({ propertyId, unit }: { propertyId: string; unit: Unit }) {
  const status = spaceStatus(unit);
  const photo = unit.primary_photo?.download_url;
  const rooms = unit.bedrooms === 0
    ? "Single room"
    : `${unit.bedrooms} bed${unit.bedrooms === 1 ? "" : "s"}`;

  return (
    <li>
      <Link href={`/properties/${propertyId}/spaces/${unit.id}` as never} className="unit-card">
        <span className="unit-card-photo">
          {/* Signed media URLs are supplied at runtime by the API and are not
              stable Next image-loader resources. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt="" /> : <span>No photo</span>}
        </span>
        <span className="unit-card-body">
          <strong>{unit.label || "Unnamed Unit"}</strong>
          <span className="unit-card-where">{unit.space_type_label} · {rooms}</span>
          <StatusLine label={status.label} tone={status.tone} />
        </span>
      </Link>
    </li>
  );
}

function valueLabel(value: string): string {
  if (!value || value === "unknown") return "Not recorded";
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function propertyTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    residential: "Residential Property",
    commercial: "Commercial Property",
    hostel: "Hostel",
    mixed_use: "Mixed-use Property",
    land: "Land",
  };
  return labels[value] ?? valueLabel(value);
}
