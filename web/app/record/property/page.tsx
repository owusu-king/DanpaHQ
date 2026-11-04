"use client";


import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { PropertyWizardModal } from "@/components/property/PropertyWizard";
import { Notice } from "@/components/Notice";
import { usePageTitle } from "@/components/PageTitle";
import { Empty, LoadingRows } from "@/components/portal/PageHeader";
import { Icon, type IconName } from "@/components/portal/icons";
import { PropertyLifecycle, PropertyMore } from "@/components/property/PropertyLifecycle";
import { EditPropertyModal } from "@/components/property/EditPropertyModal";
import { UnitWizardModal } from "@/components/property/UnitWizard";
import { SalePanel } from "@/components/property/SalePanel";
import {
  EntityPath,
  StatusLine,
  propertyStatus,
  spaceStatus,
} from "@/components/property/WorkspacePatterns";
import { RecordHeader, RecordHero, RecordSection } from "@/components/property/RecordDetail";
import { ApiFailure } from "@/lib/api";
import {
  getProperty,
  getPropertyAmenities,
  listUnits,
  type Property,
  type SpaceAmenity,
  type Unit,
} from "@/lib/console";
import { inPlace } from "@/lib/inPlace";
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
  // Setup and Add Unit open over this page (owner, 2026-10-20), held in state.
  const [sheet, setSheet] = useState<{ kind: "property"; step?: string } | { kind: "unit" } | { kind: "setup" } | null>(null);
  usePageTitle(property ? property.title || "Untitled property" : null);

  const load = useCallback(async () => {
    if (!id) return;
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

  if (!id) {
    return (
      <div className="ws-page pd-page record-page">
        <EntityPath items={[{ label: "Properties", href: "/properties" }, { label: "Choose a property" }]} />
        <Notice tone="info" title="Choose a property first" body="Open a property from your Portfolio to see its record." />
      </div>
    );
  }

  if (error && !property) {
    return (
      <div className="ws-page pd-page record-page">
        <EntityPath items={[{ label: "Properties", href: "/properties" }, { label: "Unavailable" }]} />
        <Notice tone="error" title={error} body="Return to Properties and try again." />
      </div>
    );
  }

  if (!property) return <div className="ws-page pd-page record-page"><LoadingRows rows={5} /></div>;

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

  const locationSection = (
    <RecordSection title="Location">
          <dl className="record-fields"><Fact icon="pin" label="Address" value={fullAddress || "Not recorded"} />{address?.digital_address ? <Fact icon="map" label="Digital address" value={address.digital_address} /> : null}{address?.landmark ? <Fact icon="landmark" label="Landmark" value={address.landmark} /> : null}</dl>
        </RecordSection>
  );

  return (
    <div className="ws-page pd-page record-page">
      <RecordHeader title={property.title || "Untitled property"}
        path={<EntityPath items={[{ label: "Properties", href: "/properties" }, { label: property.title || "Property" }]} />}
        context={`${propertyTypeLabel(property.property_type)} · ${address?.locality_name || fullAddress}`}
        status={<><StatusLine label={status.label} tone={status.tone} />{selling ? <StatusLine label={sale?.is_public ? "Public" : "Private"} tone={sale?.is_public ? "good" : "neutral"} /> : null}</>}
      />

      {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
      {access && restricted ? (
        <Notice
          tone={access.state === "wind_down" ? "warning" : "info"}
          title={access.state === "wind_down" ? "Winding down on your current plan" : "Read-only on your current plan"}
          body={`${access.message} Manage this in Settings → Plan & billing.`}
        />
      ) : null}
      <RecordHero key={property.id} title={property.title || "Property"} photos={property.cover_url ? [{ id: property.id, url: property.cover_url, label: property.title || "Property" }] : []}>
        <PropertyLifecycle property={property} steps={steps} onChanged={load} compact onEdit={() => setSheet({ kind: "property" })} onSetup={() => setSheet({ kind: "setup" })} />
        {selling ? sale ? <SalePanel propertyId={property.id} sale={sale} verified={property.verification.review_state === "verified"} onChanged={load} /> : null : <>
          <h2 className="record-action-title">Property management</h2>
          <dl className="record-metrics"><div><dt>Units</dt><dd>{units.length}</dd></div><div><dt>Occupied</dt><dd>{units.filter((unit) => unit.availability.state === "occupied").length}</dd></div><div><dt>Available</dt><dd>{units.filter((unit) => unit.availability.state === "available").length}</dd></div></dl>
          {primary ? <div className="record-action-group"><Link href={primary.href as never} className="btn btn-primary" onClick={inPlace(() => setSheet({ kind: "unit" }))}><Icon name="plus" />{primary.label}</Link></div> : null}
        </>}
      </RecordHero>

      <div className="record-detail-grid">
        <div className="record-side-sections">
        {land ? <div className="record-side-sections">{locationSection}{property.notes ? <RecordSection title="Description"><p className="record-description">{property.notes}</p></RecordSection> : null}</div> : <RecordSection title="Overview" actions={edit?.allowed ? <Button type="button" variant="quiet" onClick={() => setSheet({ kind: "property" })}><Icon name="pencil" />Edit</Button> : undefined}>
          <dl className="record-fields">
            <Fact icon="properties" label="Type" value={propertyTypeLabel(property.property_type)} />
            {land ? null : <><Fact icon="water" label="Water" value={property.water_source_label} /><Fact icon="power" label="Power meter" value={property.power_meter_label} /><Fact icon="home" label="Compound" value={property.compound_label} /></>}
          </dl>
          {property.notes ? <p className="record-description">{property.notes}</p> : null}
          {land ? null : <div className="record-amenities"><h3>Shared amenities</h3>{amenities === null ? <LoadingRows rows={1} /> : amenities.length ? <ul className="pd-chips">{amenities.map((amenity) => <li key={amenity.id}>{amenity.name}</li>)}</ul> : <p className="record-hint">None recorded.</p>}{edit?.allowed ? <Button type="button" variant="quiet" onClick={() => setSheet({ kind: "property", step: "amenities" })}>Edit amenities</Button> : null}</div>}
        </RecordSection>}
      {!selling ? (
      <section className="record-section record-property-units" aria-labelledby="units-heading">
        <div className="record-section-head">
          <h2 id="units-heading" className="record-section-title">Units <span>{units.length}</span></h2>
          {canAddUnit && !primary ? (
            <Link href={`/record/space-new?propertyId=${property.id}` as never} className="btn btn-secondary" onClick={inPlace(() => setSheet({ kind: "unit" }))}>Add Unit</Link>
          ) : null}
        </div>

        {units.length === 0 ? (
          <Empty
            title="No Units yet"
          />
        ) : (
          <ul className="record-unit-list" aria-label={`Units at ${property.title}`}>
            {units.map((unit) => <UnitTile key={unit.id} propertyId={property.id} unit={unit} />)}
          </ul>
        )}

      </section>
      ) : null}
        </div>
        <div className="record-side-sections">
        {land ? null : locationSection}
        <div className="record-support-grid"><PropertyMore property={property} /></div>
        </div>
      </div>

      <EditPropertyModal
        open={sheet?.kind === "property"}
        property={property}
        amenitiesOnly={sheet?.kind === "property" && sheet.step === "amenities"}
        onClose={() => setSheet(null)}
        onSaved={() => void load()}
      />
      <PropertyWizardModal
        open={sheet?.kind === "setup"}
        propertyId={property.id}
        onClose={() => setSheet(null)}
        onChanged={() => void load()}
        onFinished={() => undefined}
      />
      <UnitWizardModal
        open={sheet?.kind === "unit"}
        propertyId={property.id}
        onClose={() => setSheet(null)}
        onChanged={() => void load()}
        onFinished={() => undefined}
      />
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
      <Link href={`/record/space?propertyId=${propertyId}&spaceId=${unit.id}` as never} className="record-unit-row">
        <span className="record-unit-photo">
          {/* Signed media URLs are supplied at runtime by the API and are not
              stable Next image-loader resources. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt="" /> : <span>No photo</span>}
        </span>
        <span className="record-unit-copy">
          <strong>{unit.label || "Unnamed Unit"}</strong>
          <span className="record-unit-meta">{unit.space_type_label} · {rooms}</span>

        </span>
        <StatusLine label={status.label} tone={status.tone} />
        <span className="record-row-arrow" aria-hidden="true">→</span>
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
