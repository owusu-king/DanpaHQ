"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows } from "@/components/portal/PageHeader";
import { Icon, type IconName } from "@/components/portal/icons";
import { PropertyLifecycle, PropertyMore } from "@/components/property/PropertyLifecycle";
import { SalePanel } from "@/components/property/SalePanel";
import {
  EntityPath,
  StatusLine,
  propertyStatus,
  spaceStatus,
} from "@/components/property/WorkspacePatterns";
import { WorkspaceHead } from "@/components/workspace/Workspace";
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
import { getSellerSale, type SellerSale } from "@/lib/sales";
import { getVerification, type VerificationProgress } from "@/lib/verification";

export default function PropertyDetailPage() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get("id") ?? "";
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [sale, setSale] = useState<SellerSale | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [prop, unitList, progress, amenityState] = await Promise.all([
        getProperty(id),
        listUnits(id),
        getVerification("property", id),
        getPropertyAmenities(id),
      ]);
      // Sold whole, a sale has no Units; its price and terms are its own record.
      setSale(prop.purpose === "sale" ? await getSellerSale(id) : null);
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
      <div className="ws-page pd-page">
        <EntityPath items={[{ label: "Properties", href: "/properties" }, { label: "Unavailable" }]} />
        <Notice tone="error" title={error} body="Return to Properties and try again." />
      </div>
    );
  }

  if (!property) return <div className="ws-page pd-page"><LoadingRows rows={5} /></div>;

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
      sale ? sale.missing.length : null,
    ),
  );
  const selling = property.purpose === "sale";
  const land = selling && property.property_type === "land";
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
  // A sale is sold whole, so it is never offered a Unit.
  const primary = !selling && !lifecycleOwnsPrimary && canAddUnit
    ? { href: `/record/space-new?propertyId=${property.id}`, label: "Add Unit" }
    : null;

  return (
    <div className="ws-page pd-page">
      <WorkspaceHead
        icon="properties"
        title={property.title || "Untitled property"}
        path={<EntityPath items={[{ label: "Properties", href: "/properties" }, { label: property.title || "Property" }]} />}
        mark={property.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pd-cover" src={property.cover_url} alt="" />
        ) : undefined}
        summary={(
          <>
            <StatusLine label={status.label} tone={status.tone} />
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {selling ? `${propertyTypeLabel(property.property_type)} · For sale` : propertyTypeLabel(property.property_type)}
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {fullAddress}
          </>
        )}
        actions={primary ? <Link href={primary.href as never} className="ws-action is-primary"><Icon name="plus" />{primary.label}</Link> : undefined}
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

      {selling ? (
        sale ? (
          <SalePanel
            propertyId={property.id}
            sale={sale}
            verified={property.verification.review_state === "verified"}
            onChanged={load}
          />
        ) : null
      ) : (
      <section className="pd-panel" aria-labelledby="units-heading">
        <div className="pd-panel-head">
          <h2 id="units-heading" className="pd-panel-title">Units <span>{units.length}</span></h2>
          {canAddUnit && primary?.label !== "Add Unit" ? (
            <Link href={`/record/space-new?propertyId=${property.id}` as never} className="ws-action">Add Unit</Link>
          ) : null}
        </div>

        {units.length === 0 ? (
          <Empty
            title="No Units yet"
            body="Add a room, flat, shop or other space to rent."
          />
        ) : (
          <ul className="unit-columns" aria-label={`Units at ${property.title}`}>
            {units.map((unit) => <UnitTile key={unit.id} propertyId={property.id} unit={unit} />)}
          </ul>
        )}
        {units.length ? (
          <Link href={"/tenants" as never} className="pd-link is-inline">
            <span className="pd-link-mark" aria-hidden="true"><Icon name="users" /></span>
            <span>Manage tenant access and tenancies</span>
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </section>
      )}

      {/* What the property is, said once and in view: no disclosure to open. */}
      <section className="pd-panel" aria-labelledby="about-property-heading">
        <div className="pd-panel-head">
          <h2 id="about-property-heading" className="pd-panel-title">About this Property</h2>
          {edit?.allowed ? <Link href={`/record/property-setup?propertyId=${property.id}` as never} className="ws-action"><Icon name="pencil" />Edit</Link> : null}
        </div>
        <dl className="pd-facts is-compact">
          <Fact icon="properties" label="Type" value={propertyTypeLabel(property.property_type)} />
          <Fact icon="pin" label="Address" value={fullAddress} />
          {address?.digital_address ? <Fact icon="map" label="Digital address" value={address.digital_address} /> : null}
          {address?.landmark ? <Fact icon="landmark" label="Landmark" value={address.landmark} /> : null}
          {land ? null : (
            <>
              <Fact icon="water" label="Water" value={valueLabel(property.water_source)} />
              <Fact icon="power" label="Power meter" value={valueLabel(property.power_meter_type)} />
              <Fact icon="home" label="Compound" value={valueLabel(property.compound_type)} />
              <Fact icon="shield" label="Security" value={property.has_security ? "On site" : "Not recorded"} />
            </>
          )}
        </dl>
        {land ? null : (
          <div className="pd-amenities">
            <span className="pd-amenities-label">Shared amenities</span>
            {amenities === null ? <LoadingRows rows={1} /> : amenities.length ? (
              <ul className="pd-chips">{amenities.map((amenity) => <li key={amenity.id}>{amenity.name}</li>)}</ul>
            ) : <span className="pd-note">None recorded.</span>}
            {edit?.allowed ? <Link href={`/record/property-setup?propertyId=${property.id}&step=amenities` as never} className="pd-edit">Edit</Link> : null}
          </div>
        )}
      </section>

      <PropertyMore property={property} />
    </div>
  );
}

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="pd-fact">
      <span className="pd-fact-mark" aria-hidden="true"><Icon name={icon} /></span>
      <span>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </span>
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
      <Link href={`/record/space?propertyId=${propertyId}&spaceId=${unit.id}` as never} className="unit-card">
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
