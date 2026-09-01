"use client";

/**
 * Creating a property, as one guided journey.
 *
 * Details → Documents → Photos → Amenities → Review → **Create property**.
 *
 * ### Creating is not submitting
 *
 * The last step creates the property and returns to the properties list. It
 * sends nothing to anybody. Whether to ask for verification is a separate
 * decision the provider makes afterwards, from the property itself.
 *
 * This flow used to end by submitting. Worse, it had already submitted: the
 * Documents step showed "Send this claim for review" and filed it, so the final
 * button had only photographs left and read "Send the photographs" — a wizard
 * for creating a property ending in a photo submission. Both halves are now
 * *recorded* as you go and go to the queue together, later, when you say so.
 *
 * ### Why this is a checklist and the space flow is a wizard
 *
 * The space flow is strictly sequential because its steps genuinely are: the
 * space has to exist before an amenity can attach to it or a photograph has
 * anywhere to go. A property's do not. The record exists from the moment it is
 * created, and the documents, the photographs and the amenities are three
 * independent piles of work on it — so every step here is reachable in any
 * order, and a provider holding the indenture but sitting in an office can do
 * that one first and photograph the building on Saturday.
 *
 * The order is still not arbitrary. **Details comes before Photos because it
 * decides what Photos asks for**: a borehole or sachet water supply makes the
 * water source a required view, and a family compound or estate adds the
 * compound. Filling the details later would change the checklist under
 * somebody who had already finished it.
 *
 * ### Leaving and coming back
 *
 * Every step writes to the server as it is completed — the details are a PATCH,
 * the document is a draft claim, the photographs attach to an open review, the
 * amenities are a PUT. Nothing is held in this component that a reload would
 * lose, which is what makes "save for later" a link rather than a feature.
 *
 * ### Once it has been sent
 *
 * There is nothing left to guide, so this redirects to the property page. A
 * wizard offering "continue" over something a reviewer is holding is the
 * complaint one level up from the one it was built to answer.
 */

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { CheckChip } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { AuthorityClaim } from "@/components/property/AuthorityClaim";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { PropertySummary } from "@/components/property/PropertySummary";
import {
  SetupProgress,
  SetupSteps,
  StepPanel,
} from "@/components/property/SetupSteps";
import { VerificationPanel } from "@/components/property/VerificationPanel";
import { ApiFailure } from "@/lib/api";
import {
  getProperty,
  getPropertyAmenities,
  updateProperty,
  type Property,
  type SpaceAmenity,
} from "@/lib/console";
import {
  describePropertySetup,
  isSetupComplete,
  resumeAt,
  toSetupInput,
  type SetupStep,
} from "@/lib/propertySetup";
import { loadPropertyVocabulary, type PropertyVocabulary } from "@/lib/propertyTypes";
import { getVerification, type VerificationProgress } from "@/lib/verification";

const STEP_KEYS = ["basics", "details", "documents", "photos", "amenities", "review"] as const;
type StepKey = (typeof STEP_KEYS)[number];

export default function PropertySetupPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const propertyId = params.id;
  // Where the property page sends somebody who pressed a specific action —
  // "Submit for verification" should land on Review, not wherever the resume
  // rule would otherwise put them.
  const requested = search.get("step");

  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [vocabulary, setVocabulary] = useState<PropertyVocabulary | null>(null);
  const [step, setStep] = useState<StepKey>("details");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [prop, progress, amenityState] = await Promise.all([
        getProperty(propertyId),
        getVerification("property", propertyId),
        getPropertyAmenities(propertyId),
      ]);
      setProperty(prop);
      setPhotos(progress);
      setAmenities(amenityState.chosen);
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this property.",
      );
    }
  }, [propertyId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadPropertyVocabulary().then(setVocabulary).catch(() => setVocabulary(null));
  }, []);

  const steps = useMemo<SetupStep[]>(
    () =>
      property
        ? describePropertySetup(
            toSetupInput(
              property,
              photos,
              amenities !== null && property.amenities_confirmed_at
                ? amenities.length
                : null,
            ),
          )
        : [],
    [property, photos, amenities],
  );

  // This page exists to change a property, so whether it may be opened is the
  // same question as whether it may be changed — read from the backend rather
  // than from a list of states kept here, which would drift the first time the
  // policy moved. With a reviewer, or verified, the answer is no.
  const past = property ? property.permitted_actions.edit?.allowed === false : false;
  useEffect(() => {
    if (past) router.replace(`/properties/${propertyId}` as never);
  }, [past, propertyId, router]);

  // Open on the first thing still outstanding rather than always at the top.
  // Somebody returning to a half-finished property is coming back *to* the
  // unfinished part, and making them find it is the whole complaint about the
  // page this replaces.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !steps.length) return;
    landed.current = true;
    const asked = STEP_KEYS.includes(requested as StepKey) ? (requested as StepKey) : null;
    setStep(asked ?? (resumeAt(steps) as StepKey));
  }, [steps, requested]);

  if (error && !property) {
    return (
      <main style={SHELL}>
        <Notice tone="error" title={error} />
        <p style={{ marginTop: "var(--space-4)" }}>
          <Link href="/properties" className="type-caption" style={LINK}>
            ← All properties
          </Link>
        </p>
      </main>
    );
  }

  if (!property || !steps.length) {
    return (
      <main style={SHELL}>
        <p className="type-caption">Loading this property…</p>
      </main>
    );
  }

  const active = steps.find((row) => row.key === step) ?? steps[0]!;
  const readyToFinish = isSetupComplete(steps);
  // Been to our team and come back: this is a correction, not a first pass, so
  // the copy stops talking about creating and the review step stops insisting
  // everything is finished before it will let go.
  const settled = ["changes_requested", "rejected", "expired"].includes(
    property.verification.state,
  );

  return (
    <main style={SHELL}>
      <Link href={`/properties/${propertyId}`} className="type-caption" style={LINK}>
        ← {property.title || "This property"}
      </Link>

      <header style={{ marginTop: "var(--space-4)" }}>
        <h1 className="type-display-2" style={{ margin: 0 }}>
          {property.title || "Untitled property"}
        </h1>
        <p
          className="type-body"
          style={{ color: "var(--color-ink-700)", margin: "var(--space-2) 0 0", maxWidth: "58ch" }}
        >
          {settled
            ? "Change what is still yours to change. Anything our team checked is fixed."
            : readyToFinish
              ? "Everything needed is here."
              : "Everything saves as you go. Do them in any order."}
        </p>
      </header>

      <div style={{ marginTop: "var(--space-6)" }}>
        <SetupProgress steps={steps} current={step} />
      </div>

      <div style={LAYOUT}>
        <aside style={SIDEBAR}>
          <SetupSteps
            steps={steps}
            current={active.key}
            onSelect={(key) => setStep(key as StepKey)}
          />
          <div style={{ padding: "var(--space-3)" }}>
            <Link
              href="/properties"
              className="type-caption"
              style={{ ...LINK, fontWeight: 600 }}
            >
              Save and finish later →
            </Link>
          </div>
        </aside>

        <div style={CONTENT}>
          {step === "basics" ? (
            <BasicsStep property={property} onSaved={load} />
          ) : null}

          {step === "details" ? (
            <DetailsStep
              property={property}
              vocabulary={vocabulary}
              onSaved={async () => {
                await load();
                setStep("documents");
              }}
            />
          ) : null}

          {step === "documents" ? (
            <DocumentsStep
              property={property}
              onChanged={load}
              onDone={() => setStep("photos")}
            />
          ) : null}

          {step === "photos" ? (
            <PhotosStep
              propertyId={propertyId}
              progress={photos}
              onChanged={load}
              onDone={() => setStep("amenities")}
            />
          ) : null}

          {step === "amenities" ? (
            <AmenitiesStep
              propertyId={propertyId}
              onChanged={load}
              onDone={() => setStep("review")}
            />
          ) : null}

          {step !== "review" ? (
            <StepFooter
              steps={STEP_KEYS}
              current={step}
              onGo={(key) => setStep(key as StepKey)}
            />
          ) : null}

          {step === "review" ? (
            <ReviewStep
              property={property}
              steps={steps}
              settled={settled}
              onGoTo={(key) => setStep(key as StepKey)}
              onFinished={() =>
                router.push("/properties?created=" + encodeURIComponent(propertyId) as never)
              }
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

/**
 * Back and next, so the journey can be walked as one.
 *
 * The steps are individually reachable — a property's work is genuinely
 * independent, which is why the sidebar lists them all — but somebody creating
 * a property for the first time is walking them in order and should not have to
 * aim at a sidebar to do it.
 */
function StepFooter({
  steps,
  current,
  onGo,
}: {
  steps: readonly string[];
  current: string;
  onGo: (key: string) => void;
}) {
  const at = steps.indexOf(current);
  const previous = at > 0 ? steps[at - 1]! : null;
  const next = at >= 0 && at < steps.length - 1 ? steps[at + 1]! : null;

  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-3)",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      {previous ? (
        <Button variant="quiet" onClick={() => onGo(previous)}>
          ← Back
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button variant="quiet" onClick={() => onGo(next)}>
          Skip to {next === "review" ? "review" : next} →
        </Button>
      ) : null}
    </div>
  );
}

// --- 0. the property itself ---------------------------------------------------

/**
 * What it is called and what kind it is, for a property that already exists.
 *
 * The same fields `/properties/new` collects, which is deliberate: that page is
 * this step before the record exists, and a provider who wants to rename a
 * property later comes here rather than to a create form.
 *
 * The address is shown and not editable. Moving a property to another address
 * makes it a different property, and the evidence already reviewed was reviewed
 * about the old one.
 */
function BasicsStep({
  property,
  onSaved,
}: {
  property: Property;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(property.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const address = property.address;

  return (
    <StepPanel
      title="The property"
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field
          label="Property name"
          hint="Your own label — tenants see the listing headline, not this."
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div>
          <p className="type-caption" style={{ margin: "0 0 var(--space-1)", color: "var(--color-ink-500)" }}>
            Kind
          </p>
          <p className="type-body" style={{ margin: 0 }}>
            {property.property_type.replace(/_/g, " ")}
          </p>
        </div>
        <div>
          <p className="type-caption" style={{ margin: "0 0 var(--space-1)", color: "var(--color-ink-500)" }}>
            Where it is
          </p>
          <p className="type-body" style={{ margin: 0 }}>
            {address
              ? [address.house_number, address.street, address.locality_name, address.district_name]
                  .filter(Boolean)
                  .join(", ")
              : "No address recorded"}
          </p>
          <p className="type-caption" style={{ margin: "var(--space-1) 0 0" }}>
            A property is one address. Moving it would make it a different one.
          </p>
        </div>

        {error ? <Notice tone="error" title={error} /> : null}

        <div>
          <Button
            busy={busy}
            busyLabel="Saving…"
            disabled={!title.trim() || title === property.title}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await updateProperty(property.id, { title: title.trim() });
                await onSaved();
              } catch (cause) {
                setError(
                  cause instanceof ApiFailure ? cause.error.message : "That did not save.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Save name
          </Button>
        </div>
      </div>
    </StepPanel>
  );
}

// --- 1. details ---------------------------------------------------------------

function DetailsStep({
  property,
  vocabulary,
  onSaved,
}: {
  property: Property;
  vocabulary: PropertyVocabulary | null;
  onSaved: () => Promise<void>;
}) {
  const [water, setWater] = useState(property.water_source);
  const [power, setPower] = useState(property.power_meter_type);
  const [compound, setCompound] = useState(property.compound_type);
  const [security, setSecurity] = useState(property.has_security);
  const [gated, setGated] = useState(property.is_gated);
  const [notes, setNotes] = useState(property.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const missing = water === "unknown" || power === "unknown";

  async function save() {
    setBusy(true);
    setError("");
    try {
      await updateProperty(property.id, {
        has_security: security,
        is_gated: gated,
        notes,
        water_source: water,
        power_meter_type: power,
        compound_type: compound,
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepPanel
      title="Property details"
    >
      {!vocabulary ? (
        <p className="type-caption" style={{ margin: 0 }}>
          Loading the options…
        </p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <div style={GRID}>
            <Select
              label="What is the water source?"
              value={water}
              onChange={setWater}
              options={vocabulary.water_sources.map((row) => [row.value, row.label] as const)}
            />
            <Select
              label="How is the electricity metered?"
              value={power}
              onChange={setPower}
              options={vocabulary.power_meter_types.map(
                (row) => [row.value, row.label] as const,
              )}
            />
            <Select
              label="What kind of compound?"
              value={compound}
              onChange={setCompound}
              options={vocabulary.compound_types.map((row) => [row.value, row.label] as const)}
            />
          </div>

          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend className="type-label" style={LEGEND}>
              Security
            </legend>
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <Toggle label="Someone on the gate" on={security} onChange={setSecurity} />
              <Toggle label="Walled and gated" on={gated} onChange={setGated} />
            </div>
          </fieldset>

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>
              Anything else worth recording
            </span>
            <textarea
              value={notes}
              rows={3}
              maxLength={1000}
              onChange={(event) => setNotes(event.target.value)}
              className="type-body"
              style={TEXTAREA}
            />
          </label>

          {missing ? (
            <Notice
              tone="info"
              title="Left unknown, the photo checklist guesses — and guesses short"
            />
          ) : null}
          {error ? <Notice tone="error" title={error} /> : null}

          <div>
            <Button onClick={save} busy={busy} busyLabel="Saving…" disabled={missing}>
              Save and continue
            </Button>
          </div>
        </div>
      )}
    </StepPanel>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (value: boolean) => void;
}) {
  return <CheckChip label={label} checked={on} onChange={onChange} />;
}

// --- 2. documents -------------------------------------------------------------

function DocumentsStep({
  property,
  onChanged,
  onDone,
}: {
  property: Property;
  onChanged: () => Promise<void>;
  onDone: () => void;
}) {
  // The document half of the property's own verification, not `authority_state`
  // — that collapses through `display_state` and cannot tell a document saved
  // during creation from one that was never added.
  const document = property.verification.authority.state;
  const recorded = document !== "draft";

  return (
    <StepPanel
      title="Documents"
      summary="What shows this property is yours to let."
    >
      {document === "verified" ? (
        <Notice tone="success" title="Confirmed as yours to let" />
      ) : document === "submitted" || document === "under_review" ? (
        <Notice tone="info" title="Your claim is with our team" />
      ) : recorded ? (
        <Notice tone="success" title="Saved. Nobody has seen it yet." />
      ) : null}

      {document === "verified" || document === "submitted" || document === "under_review" ? null : (
        <AuthorityClaim
          propertyId={property.id}
          onSubmitted={async () => {
            await onChanged();
            onDone();
          }}
        />
      )}

      {recorded ? (
        <div>
          <Button variant="secondary" onClick={onDone}>
            Continue
          </Button>
        </div>
      ) : null}
    </StepPanel>
  );
}

// --- 3. photos ----------------------------------------------------------------

function PhotosStep({
  propertyId,
  progress,
  onChanged,
  onDone,
}: {
  propertyId: string;
  progress: VerificationProgress | null;
  onChanged: () => Promise<void>;
  onDone: () => void;
}) {
  return (
    <StepPanel
      title="Photos"
    >
      {/* `showSubmit={false}`: the send lives at Review, with the claim, because
          somebody standing in front of a building has both in the same trip. */}
      <VerificationPanel
        subject="property"
        id={propertyId}
        title="This property"
        showSubmit={false}
        onState={() => void onChanged()}
      />
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={onDone}>
          Continue
        </Button>
        {progress && progress.required_outstanding > 0 ? (
          <span className="type-caption" style={{ alignSelf: "center" }}>
            {progress.required_outstanding} still needed before this can be sent.
          </span>
        ) : null}
      </div>
    </StepPanel>
  );
}

// --- 4. amenities -------------------------------------------------------------

function AmenitiesStep({
  propertyId,
  onChanged,
  onDone,
}: {
  propertyId: string;
  onChanged: () => Promise<void>;
  onDone: () => void;
}) {
  return (
    <StepPanel
      title="Shared amenities"
      summary="Shared by everything inside — what one flat has of its own goes on that space."
    >
      <SpaceAmenities
        scope="property"
        id={propertyId}
        saveLabel="Confirm and continue"
        onSaved={async () => {
          await onChanged();
          onDone();
        }}
      />
    </StepPanel>
  );
}

// --- 5. review ----------------------------------------------------------------

/**
 * The last step of creating a property.
 *
 * It creates and returns to the list. It sends nothing. The property exists
 * with its verification not submitted, which is a real and useful state: the
 * provider can add the spaces inside it, share no private access yet, and ask for
 * verification when they are ready.
 */
function ReviewStep({
  property,
  steps,
  settled,
  onGoTo,
  onFinished,
}: {
  property: Property;
  steps: SetupStep[];
  /** Already decided on by our team — this is an edit, not a creation. */
  settled: boolean;
  onGoTo: (key: string) => void;
  onFinished: () => void;
}) {
  const outstanding = steps.filter(
    (row) => row.key !== "review" && !row.optional && row.status !== "done",
  );
  const ready = outstanding.length === 0;

  return (
    <StepPanel
      title="Review"
      summary="Nothing here has been sent to anybody."
    >
      {/* The property, as a property. This was a definition list of step names
          against their status — the last thing somebody saw before creating a
          building they had just photographed was a progress table. */}
      <PropertySummary property={property} onEdit={onGoTo} />

      {/* Only what is still owed, and only when something is. A list of six
          rows saying "Done" is not a review; it is the checklist again. */}
      {settled ? null : outstanding.length ? (
        <div className="property-summary-outstanding">
          <p className="type-caption">Still to finish</p>
          <ul>
            {outstanding.map((row) => (
              <li key={row.key}>
                <button type="button" onClick={() => onGoTo(row.key)}>
                  {row.title}
                  {row.detail ? <span>{row.detail}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="type-caption">
          It stays private until you send it for verification, from the property itself.
        </p>
      )}

      <div>
        <Button disabled={!ready && !settled} onClick={onFinished}>
          {settled ? "Done" : "Create property"}
        </Button>
      </div>
    </StepPanel>
  );
}

// --- layout -------------------------------------------------------------------

const SHELL: React.CSSProperties = {
  maxWidth: "64rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-5)",
};

/**
 * Wraps to one column on a narrow screen, without a media query.
 *
 * A two-column grid computed to `279px 0px` at phone width — the step list took
 * its minimum and the panel beside it collapsed to nothing, so the flow was
 * unusable on exactly the device this product is built for first. Flex with
 * `wrap` solves it intrinsically: each child asks for a basis, and when the two
 * bases no longer fit the row they stack. The content's huge `flex-grow` is what
 * keeps the sidebar at its natural width when they do fit.
 */
const LAYOUT: React.CSSProperties = {
  marginTop: "var(--space-6)",
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-6)",
  alignItems: "flex-start",
};

const SIDEBAR: React.CSSProperties = {
  flex: "1 1 15rem",
  maxWidth: "100%",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-200)",
  borderRadius: "var(--radius-md)",
  overflow: "hidden",
};

/** Grows far harder than the sidebar, so the sidebar keeps its size when both
 *  fit and the panel takes the whole row when they do not. */
const CONTENT: React.CSSProperties = {
  flex: "999 1 22rem",
  minWidth: 0,
  display: "grid",
  gap: "var(--space-4)",
};

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
  gap: "var(--space-4)",
};


const TEXTAREA: React.CSSProperties = {
  padding: "var(--space-3)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-300)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-ink-900)",
  resize: "vertical",
};

const LINK: React.CSSProperties = { color: "var(--color-kola-600)" };

const LEGEND: React.CSSProperties = {
  color: "var(--color-ink-500)",
  textTransform: "uppercase",
  padding: 0,
  marginBottom: "var(--space-2)",
};
