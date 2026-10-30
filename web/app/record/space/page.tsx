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
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { Icon, type IconName } from "@/components/portal/icons";
import { ListingComposer } from "@/components/property/ListingComposer";
import { UnitPrivateAccess } from "@/components/property/UnitPrivateAccess";
import { UnitLifecycleActions } from "@/components/property/UnitLifecycleActions";
import { UnitWizardModal } from "@/components/property/UnitWizard";
import {
  DetailSection,
  DetailDisclosure,
  EntityPath,
  StatusLine,
  spaceStatus,
} from "@/components/property/WorkspacePatterns";
import { RecordHeader, RecordHero, RecordSection } from "@/components/property/RecordDetail";
import { ApiFailure } from "@/lib/api";
import {
  createBed,
  getUnit,
  listMyListings,
  listingAction,
  requestUnitRecheck,
  withdrawSpaceSubmission,
  type Listing,
  type UnitDetail,
} from "@/lib/console";
import { submitForReview } from "@/lib/verification";
import { inPlace } from "@/lib/inPlace";
import { privateAccess } from "@/lib/accessCodeMeaning";

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
          (row) => row.id === unit.publication.listing_id,
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
      <div className="ws-page pd-page record-page">
        <EntityPath items={[{ label: "Properties", href: "/properties" }, { label: "Property", href: `/record/property?id=${propertyId}` }, { label: "Unavailable" }]} />
        <Notice tone="error" title={error} body="Return to the Property and try again." />
      </div>
    );
  }

  if (!space) return <div className="ws-page pd-page record-page"><LoadingRows rows={5} /></div>;

  const isHostelRoom =
    space.property.property_type === "hostel" && space.space_type === "room";
  // Served with the Unit; the fallback is an older API, which asked everything.
  const asks = space.asks ?? { bedrooms: true, bathrooms: "count", floor: true };
  const status = spaceStatus(space);
  const showAccess = privateAccess(space.access_code, {
    verified: space.verification.state === "verified",
    occupied: space.availability.state === "occupied",
  }).show;
  const photos = [space.primary_photo, ...space.media.filter((row) => row.id !== space.primary_photo?.id)]
    .filter((row): row is NonNullable<typeof row> => Boolean(row?.download_url));


  return (
    <div className="ws-page pd-page record-page">
      <RecordHeader title={space.label || "Unnamed Unit"} context={`${space.property.title} · ${space.space_type_label}${space.floor_level === null ? "" : space.floor_level === 0 ? " · Ground floor" : ` · Floor ${space.floor_level}`}`}
        path={<EntityPath items={[{ label: "Properties", href: "/properties" }, { label: space.property.title || "Property", href: `/record/property?id=${propertyId}`, mobileLabel: "Back to Property" }, { label: space.label || "Unit" }]} />}
        status={<><StatusLine label={space.verification.state === "verified" ? "Verified" : space.verification.state_label} tone={status.tone} /><StatusLine label={space.publication.state === "published" && space.publication.listing_status === "active" ? "Public" : "Private"} tone={space.publication.state === "published" && space.publication.listing_status === "active" ? "good" : "neutral"} /><StatusLine label={space.availability.label} /></>}
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

      <RecordHero key={space.id} title={space.label || "Unit"} photos={photos.map((row) => ({ id: row.id, url: row.download_url!, label: row.caption || space.label || "Unit photo" }))}>
        <WhatIsNext space={space} listing={listing} propertyId={propertyId} onChanged={load} />
        <div className="record-secondary-actions"><Link href={"/tenants#access" as never} className="btn btn-secondary record-tenancy-action"><Icon name="users" />Tenancy requests and tenancies</Link></div>
      </RecordHero>

      <RecordSection title="Overview">
      <dl className="record-fields is-overview" aria-label="Unit information">
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

      </RecordSection>

      <div className="record-detail-grid is-unit-record">
      <section className="record-section" aria-labelledby="unit-manage-heading">
        <h2 id="unit-manage-heading" className="record-section-title">Unit details</h2>


        <DetailSection title={`Amenities${space.amenities.length ? ` (${space.amenities.length})` : ""}`}>
          {space.amenities.length ? (
            <ul className="pd-chips">{space.amenities.map((row) => <li key={row.id}>{row.name}</li>)}</ul>
          ) : <p className="pd-note">None recorded.</p>}
        </DetailSection>

        <DetailSection title="Description">
          <p className="record-description">{space.description || "No description added."}</p>
        </DetailSection>

        {isHostelRoom ? (
          <DetailDisclosure title={`Beds${space.beds.length ? ` (${space.beds.length})` : ""}`}>
            <Beds space={space} onChanged={load} />
          </DetailDisclosure>
        ) : null}

        <UnitLifecycleActions unit={space} />
      </section>
      {showAccess ? <RecordSection title="Access and verification">
        <UnitPrivateAccess unitId={space.id} accessCode={space.access_code} verified={space.verification.state === "verified"} occupied={space.availability.state === "occupied"} onChanged={load} />
      </RecordSection> : null}
      </div>


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
  const [composing, setComposing] = useState(false);
  const [setupStep, setSetupStep] = useState<string | null>(null);

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
      <section className="record-workflow" data-tone="occupied">
        <span className="pd-next-kicker">Currently occupied</span>
        <h2>Someone lives here</h2>
        <p>Danpa HQ will not accept new requests while someone lives here.</p>
        <Link href={"/tenants" as never} className="btn btn-secondary">Manage in Tenants →</Link>
      </section>
    );
  }

  return (
    <section className="record-workflow" data-tone={space.verification.state !== "verified" ? "check" : (space.publication.state === "published" && space.publication.listing_status === "active") ? "public" : "private"}>
      <UnitWizardModal
        open={setupStep !== null}
        propertyId={space.property.id}
        unitId={space.id}
        startAt={setupStep}
        onClose={() => setSetupStep(null)}
        onChanged={() => void onChanged()}
        onFinished={() => { setSetupStep(null); void onChanged(); }}
      />
      <ModalSheet open={composing} onClose={() => { if (!busy) { setComposing(false); void onChanged(); } }} title="Publish to Explore" icon="units" size="sm" dismissible={false} className="compact-action-sheet">
        {composing ? <ListingComposer unitId={space.id} listing={listing} onBusyChange={setBusy} onCreated={async () => { setComposing(false); await onChanged(); }} /> : null}
      </ModalSheet>
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

          {space.verification.editable && space.permitted_actions.edit?.allowed ? (
            <Link
              href={`/record/space-new?propertyId=${propertyId}&unitId=${space.id}&step=${
                space.verification.can_submit ? "review" : "amenities"
              }` as never}
              className="btn btn-secondary"
              onClick={inPlace(() => setSetupStep(space.verification.can_submit ? "review" : "amenities"))}
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
            onSetup={setSetupStep}
          />
        </>
      ) : (
        <>
          <span className="pd-next-kicker">{(space.publication.state === "published" && space.publication.listing_status === "active") ? "Public" : "Checked"}</span>
          <h2>
            {(space.publication.state === "published" && space.publication.listing_status === "active")
              ? "Live in Explore"
              : "Share it or publish it"}
          </h2>
          <p>
            {(space.publication.state === "published" && space.publication.listing_status === "active")
              ? "Anyone can request a viewing."
              : "Share its access code, or publish it to Explore."}
          </p>

          <div className="pd-next-actions">
            {(space.publication.state === "published" && space.publication.listing_status === "active") ? (
              <>
                <Link
                  href={`/record/listing?id=${space.publication.listing_id}` as never}
                  className="btn btn-primary"
                >
                  View public listing
                </Link>
                <Button variant="destructive" className="record-withdraw-action" onClick={() => setWithdrawing((open) => !open)}>
                  {withdrawing ? "Keep it public" : "Take down…"}
                </Button>
              </>
            ) : publish?.allowed ? (
              <Button onClick={() => setComposing(true)}>Publish to Explore</Button>
            ) : null}



            {recheck?.allowed ? <Button variant="secondary" className="record-recheck-action" onClick={() => setRechecking(true)}>Change what was checked</Button> : null}
          </div>


          {!publish?.allowed && publish?.message ? (
            <Notice tone="info" title="This cannot be published" body={publish.message} />
          ) : null}

          <ModalSheet open={withdrawing && Boolean(listing)} onClose={() => { if (!busy) setWithdrawing(false); }} title="Remove it from Explore?" icon="units" size="sm" className="compact-action-sheet">
            <div className="compact-form"><p className="record-hint">Records stay. You can publish it again while it is available.</p><div className="compact-form-actions"><Button variant="quiet" disabled={busy} onClick={() => setWithdrawing(false)}>Cancel</Button><Button variant="destructive" busy={busy} busyLabel="Taking down…" onClick={() => listing && run(async () => { await listingAction(space.publication.listing_id ?? listing.id, "withdraw", "Taken down by the provider"); setWithdrawing(false); })}>Take it down</Button></div></div>
          </ModalSheet>

          <ModalSheet open={rechecking} onClose={() => { if (!busy) setRechecking(false); }} title="Reopen this Unit?" icon="units" size="sm" className="compact-action-sheet">
            <div className="compact-form"><p className="record-hint">A re-check takes it out of Explore. Your details stay saved and editable, then need checking again.</p><div className="compact-form-actions"><Button variant="quiet" disabled={busy} onClick={() => setRechecking(false)}>Cancel</Button><Button variant="destructive" busy={busy} onClick={() => run(async () => { await requestUnitRecheck(space.id, "Reopened to change the Unit."); setRechecking(false); })}>Reopen this Unit</Button></div></div>
          </ModalSheet>

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
  onSetup,
}: {
  space: UnitDetail;
  propertyId: string;
  busy: boolean;
  onSubmit: () => void;
  onWithdraw: () => void;
  onSetup: (step: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const submit = space.permitted_actions.submit_for_verification;
  const { state, required_outstanding, required_total, can_submit } = space.verification;

  // With a reviewer: no submit, and a way to take it back — the same shape the
  // property page uses, because it is the same act one level down.
  if (state === "submitted" || state === "under_review") {
    const withdraw = space.permitted_actions.withdraw_submission;
    if (!withdraw?.allowed) return null;
    return (
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Button variant="quiet" busy={busy} busyLabel="Withdrawing…" onClick={() => setConfirming(true)}>
          Withdraw submission
        </Button>
        <span className="type-caption" style={{ alignSelf: "center" }}>
          {withdraw.message}
        </span>
        <ModalSheet open={confirming} onClose={() => setConfirming(false)} icon="verification" title="Withdraw submission?" size="sm">
          <p>Your Unit stays saved and editable. You can submit it again later.</p>
          <Button variant="destructive" busy={busy} onClick={() => { onWithdraw(); setConfirming(false); }}>Withdraw submission</Button>
          <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>Keep submitted</Button>
        </ModalSheet>
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
          <Link href={`/record/property?id=${propertyId}` as never} className="btn btn-secondary">Get the property checked</Link>
        ) : required_outstanding > 0 && space.verification.editable && space.permitted_actions.edit?.allowed ? (
          <Link className="btn btn-secondary" href={`/record/space-new?propertyId=${propertyId}&unitId=${space.id}&step=photos` as never} onClick={inPlace(() => onSetup("photos"))}>Add the photos</Link>
        ) : null}

        {/* Complete on its own terms but refused by the policy: offering the
            call is what turns a silent refusal into a stated one. */}
        {can_submit && !waitingOnProperty ? (
          <Button variant="quiet" busy={busy} busyLabel="Sending…" onClick={onSubmit}>
            Try sending anyway
          </Button>
        ) : null}
      </div>
    </>
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
