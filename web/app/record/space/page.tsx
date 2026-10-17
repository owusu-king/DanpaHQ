"use client";

/**
 * One rentable space, and everything that happens to it.
 *
 * The page is organised around the three lifecycles rather than around the
 * database: what the space *is*, whether it has been **checked**, and — once it
 * has — whether it is kept **private** or **published**. Those are separate
 * decisions taken at different times, and the old property page collapsed them
 * into a row of buttons that implied one led to the next.
 *
 * Two rules the layout enforces:
 *
 * * **What to do next comes first.** A provider opening this page has one
 *   question, and the answer is at the top rather than found among six panels.
 * * **A refusal is never a disabled button with no explanation.** Everything
 *   gated reads `permitted_actions` from the backend and shows the blocker it
 *   returns — the same decision the API enforces, said before the work rather
 *   than after it.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { Icon, type IconName } from "@/components/portal/icons";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpaceLifecycle } from "@/components/property/SpaceLifecycle";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import { UnitPrivateAccess } from "@/components/property/UnitPrivateAccess";
import { UnitLifecycleActions } from "@/components/property/UnitLifecycleActions";
import {
  DetailDisclosure,
  EntityPath,
  StatusLine,
  spaceStatus,
} from "@/components/property/WorkspacePatterns";
import { WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  createBed,
  getUnit,
  listMyListings,
  listingAction,
  requestUnitRecheck,
  updateUnit,
  withdrawSpaceSubmission,
  type Listing,
  type UnitDetail,
} from "@/lib/console";
import { submitForReview } from "@/lib/verification";

export default function SpaceWorkspacePage() {
  const search = useSearchParams();
  const router = useRouter();
  const propertyId = search.get("propertyId") ?? "";
  const spaceId = search.get("spaceId") ?? "";

  const [space, setSpace] = useState<UnitDetail | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [unit, listings] = await Promise.all([getUnit(spaceId), listMyListings()]);
      setSpace(unit);
      setListing(
        listings.find(
          (row) => row.unit === spaceId && row.status !== "rejected",
        ) ?? null,
      );
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this Unit.",
      );
    }
  }, [spaceId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !space) {
    return (
      <div className="ws-page pd-page">
        <EntityPath items={[{ label: "Properties", href: "/properties" }, { label: "Property", href: `/record/property?id=${propertyId}` }, { label: "Unavailable" }]} />
        <Notice tone="error" title={error} body="Return to the Property and try again." />
      </div>
    );
  }

  if (!space) return <div className="ws-page pd-page"><LoadingRows rows={5} /></div>;

  const where = [
    space.property.title,
    space.floor_level === null ? "" : space.floor_level === 0 ? "Ground floor" : `Floor ${space.floor_level}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const isHostelRoom =
    space.property.property_type === "hostel" && space.space_type === "room";
  // Served with the Unit; the fallback is an older API, which asked everything.
  const asks = space.asks ?? { bedrooms: true, bathrooms: "count", floor: true };
  const status = spaceStatus(space);
  const photos = [space.primary_photo, ...space.media.filter((row) => row.id !== space.primary_photo?.id)]
    .filter((row): row is NonNullable<typeof row> => Boolean(row?.download_url));
  const photo = photos[0]?.download_url ?? null;

  return (
    <div className="ws-page pd-page">
      <WorkspaceHead
        icon="units"
        title={space.label || "Unnamed Unit"}
        path={(
          <EntityPath items={[
            { label: "Properties", href: "/properties" },
            {
              label: space.property.title || "Property",
              href: `/record/property?id=${propertyId}`,
              mobileLabel: "Back to Property",
            },
            { label: space.label || "Unit" },
          ]} />
        )}
        summary={(
          <>
            <StatusLine label={status.label} tone={status.tone} />
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {space.space_type_label}
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {where}
          </>
        )}
      />

      {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
      {space.billing_access && space.billing_access.state !== "full" ? (
        <Notice
          tone={space.billing_access.state === "wind_down" ? "warning" : "info"}
          title={
            space.billing_access.state === "wind_down"
              ? "Winding down on your current plan"
              : "Read-only on your current plan"
          }
          body={`${space.billing_access.message} Manage this in Settings → Plan & billing.`}
        />
      ) : null}

      {/* What it looks like, beside the one thing to do next. */}
      <div className="pd-top">
        <figure className="pd-gallery">
          <div className="pd-gallery-lead">
            {/* Signed media URLs are supplied at runtime by the API and are not
                stable Next image-loader resources. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo ? <img src={photo} alt={space.label || "Unit"} /> : <span><Icon name="photos" />No photo yet</span>}
          </div>
        </figure>

        <div className="pd-side">
          <WhatIsNext space={space} listing={listing} propertyId={propertyId} onChanged={load} />
          {/* The code belongs to this Unit, so it is managed from this Unit.
              It used to be reachable only through the Portfolio summary,
              which a provider holding a Property directly is not in. */}
          <UnitPrivateAccess
            unitId={space.id}
            accessCode={space.access_code}
            verified={space.verification.state === "verified"}
            occupied={space.availability.state === "occupied"}
            onChanged={load}
          />
        </div>
      </div>

      <dl className="pd-facts" aria-label="Unit information">
        <Fact icon="units" label="Type" value={space.space_type_label} />
        {/* Only facts that fit this kind of space: a shop shows no bedrooms. */}
        {asks.bedrooms ? <Fact icon="bed" label="Bedrooms" value={String(space.bedrooms)} /> : null}
        {asks.bathrooms === "count" ? (
          <Fact icon="bath" label="Bathrooms" value={String(space.bathrooms)} />
        ) : asks.bathrooms === "yes_no" ? (
          <Fact icon="bath" label="Own bathroom" value={space.bathrooms > 0 ? "Yes" : "No"} />
        ) : null}
        {space.space_type === "land" ? null : (
          <Fact icon="sofa" label="Furnished" value={space.is_furnished ? "Yes" : "No"} />
        )}
        {asks.floor && space.floor_level !== null ? <Fact icon="properties" label="Floor" value={space.floor_level === 0 ? "Ground" : String(space.floor_level)} /> : null}
        {space.floor_area_sqm ? <Fact icon="details" label="Area" value={`${space.floor_area_sqm} m²`} /> : null}
      </dl>

      <section className="pd-panel" aria-labelledby="unit-manage-heading">
        <h2 id="unit-manage-heading" className="pd-panel-title">Manage this Unit</h2>
        <DetailDisclosure title={`Photos${space.photo_count ? ` (${space.photo_count})` : ""}`} open={space.verification.state !== "verified"}>
          <p className="pd-note">
            {space.availability.state === "occupied"
              ? "Locked while occupied."
              : space.verification.state === "verified"
                ? "Checked photos. Re-check to change them."
                : "The first photo leads."}
          </p>
          <SpacePhotos unitId={space.id} editable={Boolean(space.permitted_actions.edit?.allowed)} onChanged={load} />
        </DetailDisclosure>

        <DetailDisclosure title={`Amenities${space.amenities.length ? ` (${space.amenities.length})` : ""}`}>
          {space.permitted_actions.edit?.allowed ? (
            <SpaceAmenities scope="unit" id={space.id} onSaved={load} />
          ) : space.amenities.length ? (
            <ul className="pd-chips">{space.amenities.map((row) => <li key={row.id}>{row.name}</li>)}</ul>
          ) : <p className="pd-note">None recorded.</p>}
        </DetailDisclosure>

        <DetailDisclosure title="Details and entrance directions">
          <SpaceDetails space={space} onSaved={load} />
        </DetailDisclosure>

        {isHostelRoom ? (
          <DetailDisclosure title={`Beds${space.beds.length ? ` (${space.beds.length})` : ""}`}>
            <Beds space={space} onChanged={load} />
          </DetailDisclosure>
        ) : null}

        <DetailDisclosure title="Verification and publication details">
          <SpaceLifecycle verification={space.verification} publication={space.publication} availability={space.availability} />
          {space.verification.decision_note ? <Notice tone="info" title="Review note" body={space.verification.decision_note} /> : null}
        </DetailDisclosure>

        <UnitLifecycleActions unit={space} />
      </section>

      <Link href={"/tenants#access" as never} className="pd-link">
        <span className="pd-link-mark" aria-hidden="true"><Icon name="users" /></span>
        <span>Tenancy requests and tenancies</span>
        <span aria-hidden="true">→</span>
      </Link>
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

// --- the one thing to do next -------------------------------------------------

function WhatIsNext({
  space,
  listing,
  propertyId,
  onChanged,
}: {
  space: UnitDetail;
  listing: Listing | null;
  propertyId: string;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rechecking, setRechecking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const publish = space.permitted_actions.publish;
  const recheck = space.permitted_actions.recheck;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (space.availability.state === "occupied") {
    return (
      <section className="pd-next" data-tone="occupied">
        <span className="pd-next-kicker">Currently occupied</span>
        <h2>Someone lives here</h2>
        <p>Danpa HQ will not accept new requests while someone lives here.</p>
        <Link href={"/tenants" as never} className="ws-action">Manage in Tenants →</Link>
      </section>
    );
  }

  return (
    <section className="pd-next" data-tone={space.verification.state !== "verified" ? "check" : space.publication.state === "published" ? "public" : "private"}>
      {space.verification.decision_note ? (
        <Notice
          tone={space.verification.state === "verified" ? "info" : "warning"}
          title="From our review team"
          body={space.verification.decision_note}
        />
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {space.verification.state !== "verified" ? (
        <>
          <span className="pd-next-kicker">Next step</span>
          <h2>
            {space.verification.state === "submitted" || space.verification.state === "under_review"
              ? "With our review team"
              : "Get it checked"}
          </h2>
          <p>
            {space.verification.state === "submitted" ||
            space.verification.state === "under_review"
              ? "Nothing to do now. We will tell you the outcome."
              : "Needed before you share or advertise it."}
          </p>

          {space.verification.state === "draft" ||
          space.verification.state === "ready_for_submission" ? (
            <Link
              href={`/record/space-new?propertyId=${propertyId}&unitId=${space.id}&step=${
                space.verification.can_submit ? "review" : "amenities"
              }` as never}
              className="button-link secondary"
            >
              Continue setup
            </Link>
          ) : null}

          <SubmitForChecking
            space={space}
            propertyId={propertyId}
            busy={busy}
            onSubmit={() => run(() => submitForReview("unit", space.id))}
            onWithdraw={() =>
              run(() => withdrawSpaceSubmission(space.id, "Withdrawn by the provider."))
            }
          />
        </>
      ) : (
        <>
          <span className="pd-next-kicker">{space.publication.state === "published" ? "Public" : "Checked"}</span>
          <h2>
            {space.publication.state === "published"
              ? "Live in Explore"
              : "Share it or publish it"}
          </h2>
          <p>
            {space.publication.state === "published"
              ? "Anyone can request a viewing."
              : "Share its access code, or publish it to Explore."}
          </p>

          <div className="pd-next-actions">
            {space.publication.state === "published" ? (
              <>
                <Link
                  href={`/record/listing?id=${listing?.id}` as never}
                  className="button-link secondary"
                >
                  View public listing
                </Link>
                <Button variant="quiet" onClick={() => setWithdrawing((open) => !open)}>
                  {withdrawing ? "Keep it public" : "Take down…"}
                </Button>
              </>
            ) : listing && publish?.allowed ? (
              <Button
                busy={busy}
                busyLabel="Publishing…"
                onClick={() => run(() => listingAction(listing.id, "publish"))}
              >
                Publish to Explore
              </Button>
            ) : !listing && publish?.allowed ? (
              <Link href={`/record/space-listing?propertyId=${propertyId}&spaceId=${space.id}` as never} className="button-link">
                Publish to Explore
              </Link>
            ) : null}

            {recheck?.allowed ? (
              <Button variant="quiet" onClick={() => setRechecking((open) => !open)}>
                {rechecking ? "Never mind" : "Change what was checked"}
              </Button>
            ) : null}
          </div>

          {!publish?.allowed && publish?.message ? (
            <Notice tone="info" title="This cannot be published" body={publish.message} />
          ) : null}

          {withdrawing && listing ? (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <Notice tone="warning" title="Remove it from Explore?" body="Records stay. You can publish it again." />
              <div><Button variant="destructive" busy={busy} busyLabel="Taking down…" onClick={() => run(async () => {
                await listingAction(listing.id, "withdraw", "Taken down by the provider");
                setWithdrawing(false);
              })}>Take it down</Button></div>
            </div>
          ) : null}

          {rechecking ? (
            <>
              <Notice
                tone="warning"
                title="A re-check takes it out of Explore"
                body="It returns to draft for editing, then needs checking again."
              />
              <div>
                <Button
                  variant="destructive"
                  busy={busy}
                  onClick={() =>
                    run(async () => {
                      await requestUnitRecheck(space.id, "Reopened to change the Unit.");
                      setRechecking(false);
                    })
                  }
                >
                  Reopen this Unit
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Sending a space for checking, and saying why when that is not possible.
 *
 * This is where a saved draft used to die quietly. The button rendered only when
 * `permitted_actions.submit_for_verification` allowed it, and when it did not,
 * what appeared instead was a button labelled "Send for checking" that scrolled
 * the page — plus a line reading "0 of 1 still needed", because the fallback
 * counted photographs and the actual refusal was about something else entirely.
 * A provider clicked, the page moved, and nothing told them anything.
 *
 * Three rules now:
 *
 * 1. **A refusal is always stated**, from the decision's own message rather than
 *    from a count this screen guessed at.
 * 2. **A refusal that has somewhere to go, goes there.** The property not being
 *    verified is fixed on the property page, so that is a link, not a sentence.
 * 3. **The button is offered whenever the space's own evidence is complete**,
 *    even if the policy refuses — so a click produces the server's refusal in
 *    the error area rather than silence. Hiding a control is a courtesy;
 *    the server is the boundary (ADR 0021), and the courtesy is what failed
 *    here.
 */
function SubmitForChecking({
  space,
  propertyId,
  busy,
  onSubmit,
  onWithdraw,
}: {
  space: UnitDetail;
  propertyId: string;
  busy: boolean;
  onSubmit: () => void;
  onWithdraw: () => void;
}) {
  const submit = space.permitted_actions.submit_for_verification;
  const { state, required_outstanding, required_total, can_submit } = space.verification;

  // With a reviewer: no submit, and a way to take it back — the same shape the
  // property page uses, because it is the same act one level down.
  if (state === "submitted" || state === "under_review") {
    const withdraw = space.permitted_actions.withdraw_submission;
    if (!withdraw?.allowed) return null;
    return (
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Button variant="quiet" busy={busy} busyLabel="Withdrawing…" onClick={onWithdraw}>
          Withdraw submission
        </Button>
        <span className="type-caption" style={{ alignSelf: "center" }}>
          {withdraw.message}
        </span>
      </div>
    );
  }

  if (submit?.allowed) {
    return (
      <div>
        <Button busy={busy} busyLabel="Sending…" onClick={onSubmit}>
          Send for checking
        </Button>
      </div>
    );
  }

  // The property is the thing outstanding: say so, and offer the way to fix it.
  const waitingOnProperty = submit?.blockers?.some((blocker) =>
    blocker.kind.startsWith("verification_"),
  );

  return (
    <>
      <Notice
        tone="info"
        title={
          waitingOnProperty
            ? "The entire property has to be verified first"
            : "This cannot be sent yet"
        }
        body={
          submit?.message ??
          (required_outstanding > 0
            ? `${required_outstanding} of ${required_total} photos still needed.`
            : "")
        }
      />
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        {waitingOnProperty ? (
          <Link href={`/record/property?id=${propertyId}` as never}>
            <Button variant="secondary">Get the property checked</Button>
          </Link>
        ) : required_outstanding > 0 ? (
          <Button variant="secondary" onClick={() => scrollToPhotos()}>
            Add the photos
          </Button>
        ) : null}

        {/* Complete on its own terms but refused by the policy: offering the
            call is what turns a silent refusal into a stated one. */}
        {can_submit ? (
          <Button variant="quiet" busy={busy} busyLabel="Sending…" onClick={onSubmit}>
            Try sending anyway
          </Button>
        ) : null}
      </div>
    </>
  );
}

function scrollToPhotos() {
  document.getElementById("photos")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- details ------------------------------------------------------------------

function SpaceDetails({ space, onSaved }: { space: UnitDetail; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(space.label);
  const [description, setDescription] = useState(space.description);
  const [entrance, setEntrance] = useState(space.entrance_note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fullEditable = Boolean(space.permitted_actions.edit?.allowed);
  const operationalEditable = Boolean(space.permitted_actions.edit_operational?.allowed);

  if (!fullEditable && !operationalEditable) {
    return (
      <dl style={{ display: "grid", gap: "var(--space-3)", margin: 0 }}>
        <Row term="Name" value={space.label || "Not named"} />
        <Row term="Type" value={space.space_type_label} />
        {space.description ? <Row term="Description" value={space.description} /> : null}
        {space.entrance_note ? <Row term="Entrance" value={space.entrance_note} /> : null}
        <p className="type-caption" style={{ margin: 0, color: "var(--color-ink-500)" }}>
          {space.permitted_actions.edit?.message ?? "These cannot be changed at the moment."}
        </p>
      </dl>
    );
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await updateUnit(space.id, {
        entrance_note: entrance,
        ...(fullEditable ? { label, description } : {}),
      });
      setSaved(true);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {fullEditable ? <Field
        label="Name"
        value={label}
        onChange={(event) => {
          setSaved(false);
          setLabel(event.target.value);
        }}
      /> : <Row term="Called" value={space.label || "Not named"} />}
      {!fullEditable ? (
        <Notice
          tone="info"
          title="Checked details are protected"
          body={space.permitted_actions.edit?.message}
        />
      ) : null}
      {fullEditable ? <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>
          Description
        </span>
        <textarea
          value={description}
          rows={4}
          maxLength={1500}
          onChange={(event) => {
            setSaved(false);
            setDescription(event.target.value);
          }}
          className="type-body"
          style={TEXTAREA}
        />
      </label> : null}
      <Field
        label="Entrance directions"
        hint="Never shown publicly."
        value={entrance}
        onChange={(event) => {
          setSaved(false);
          setEntrance(event.target.value);
        }}
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        <Button variant="secondary" onClick={save} busy={busy} busyLabel="Saving…">
          Save details
        </Button>
        {saved ? (
          <span className="type-caption" style={{ color: "var(--color-kola-600)" }}>
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

// --- beds ---------------------------------------------------------------------

function Beds({ space, onChanged }: { space: UnitDetail; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const addBed = space.permitted_actions.add_bed;

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <p className="pd-note">Let the room whole, or bed by bed.</p>
      {space.beds.length ? (
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {space.beds.map((bed) => (
            <li key={bed.id} className="type-body">
              {bed.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-caption" style={{ margin: 0 }}>
          No beds yet.
        </p>
      )}
      {error ? <Notice tone="error" title={error} /> : null}
      {!addBed?.allowed ? (
        <Notice tone="info" title="Beds cannot be added" body={addBed?.message} />
      ) : null}
      {addBed?.allowed ? <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end" }}>
        <div style={{ flex: 1, maxWidth: "18rem" }}>
          <Field
            label="Bed label"
            hint="Bed A, or Lower bunk."
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          busy={busy}
          disabled={!label.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await createBed(space.id, { label: label.trim() });
              setLabel("");
              await onChanged();
            } catch (cause) {
              setError(
                cause instanceof ApiFailure ? cause.error.message : "Could not add that bed.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Add bed
        </Button>
      </div> : null}
    </div>
  );
}

// --- layout -------------------------------------------------------------------

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "10rem 1fr", gap: "var(--space-4)" }}>
      <dt className="type-caption" style={{ color: "var(--color-ink-500)" }}>
        {term}
      </dt>
      <dd className="type-body" style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}

const TEXTAREA: React.CSSProperties = {
  padding: "var(--space-3)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-300)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-ink-900)",
  resize: "vertical",
};
