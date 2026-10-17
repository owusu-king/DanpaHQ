"use client";

/**
 * Adding a rentable space, as a guided workflow rather than a form.
 *
 * Details → Amenities → Photos → Review → Send for checking.
 *
 * Why steps and not one long form: the space has to exist before amenities can
 * be attached to it and before a photograph has anywhere to go, so the work is
 * genuinely sequential — and a single form would either hide that or fake it
 * with a pile of state that half-saves when a phone drops signal. The space is
 * created at the end of step one and every later step writes to a real record,
 * so leaving and coming back loses nothing.
 *
 * The last step is a decision, not a formality: sending it for checking is what
 * lets anyone request it privately or see it advertised, and the screen says so
 * before the button rather than after it.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { CountStepper, StepActions, YesNo } from "@/components/creation/StepActions";
import {
  CheckpointJourney,
  type CreationCheckpoint,
} from "@/components/creation/CheckpointJourney";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import { ApiFailure } from "@/lib/api";
import {
  createUnit,
  getProperty,
  getUnit,
  listBuildings,
  type Building,
  type Property,
  type UnitDetail,
} from "@/lib/console";
import { loadPropertyTypes, spaceTypesFor, type SpaceTypeOption } from "@/lib/propertyTypes";
import { submitForReview } from "@/lib/verification";

const STEPS = ["Details", "Amenities", "Photos", "Review"] as const;
type Step = (typeof STEPS)[number];

export default function NewSpacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("propertyId") ?? "";
  const resumeUnitId = searchParams.get("unitId");
  const requestedStep = searchParams.get("step");

  const [property, setProperty] = useState<Property | null>(null);
  const [space, setSpace] = useState<UnitDetail | null>(null);
  const [step, setStep] = useState<Step>("Details");
  const [error, setError] = useState("");

  useEffect(() => {
    getProperty(propertyId)
      .then(setProperty)
      .catch((cause) =>
        setError(
          cause instanceof ApiFailure ? cause.error.message : "Could not load this property.",
        ),
      );
  }, [propertyId]);

  useEffect(() => {
    if (!resumeUnitId) return;
    getUnit(resumeUnitId)
      .then((saved) => {
        if (saved.property.id !== propertyId) {
          setError("That saved Unit belongs to another Property.");
          return;
        }
        setSpace(saved);
        setStep(
          requestedStep === "photos" || requestedStep === "review" ?
            (requestedStep === "photos" ? "Photos" : "Review") :
            "Amenities",
        );
      })
      .catch((cause) =>
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not reopen this Unit."),
      );
  }, [propertyId, requestedStep, resumeUnitId]);

  const reload = useCallback(async () => {
    if (!space) return;
    setSpace(await getUnit(space.id));
  }, [space]);

  if (error && !property) {
    return (
      <main style={SHELL}>
        <Notice tone="error" title={error} />
      </main>
    );
  }
  if (!property) {
    return (
      <main style={SHELL}>
        <p className="type-caption">Loading…</p>
      </main>
    );
  }

  return (
    <main style={SHELL}>
      <Link
        href={`/record/property?id=${propertyId}` as never}
        className="type-caption"
        style={{ color: "var(--color-kola-600)" }}
      >
        ← {property.title || "This property"}
      </Link>

      <header style={{ marginTop: "var(--space-4)" }}>
        <h1 className="type-display-2" style={{ margin: 0 }}>
          Add Unit
        </h1>
        <p className="type-caption" style={{ margin: "var(--space-2) 0 0" }}>
          In {property.title || "this property"}
        </p>
      </header>

      {/* The icons move between steps once the Unit exists (owner, 2026-10-05);
          before it is saved there is nothing for the later steps to hold. */}
      <Progress current={step} reached={space ? STEPS.indexOf(step) : 0} canJump={Boolean(space)} onJump={setStep} />

      {step === "Details" ? (
        <DetailsStep
          property={property}
          existing={space}
          onDone={(created) => {
            setSpace(created);
            setStep("Amenities");
          }}
          onSaved={(created) =>
            router.push(`/record/space?propertyId=${propertyId}&spaceId=${created.id}` as never)
          }
        />
      ) : null}

      {step === "Amenities" && space ? (
        <section style={CARD}>
          <StepHeading title="Amenities" body="Only this Unit’s own." />
          {/* Continuing with nothing ticked is the skip. */}
          <SpaceAmenities
            scope="unit"
            id={space.id}
            saveLabel="Continue"
            onSaved={() => setStep("Photos")}
            onBack={() => setStep("Details")}
            saveForLaterLabel="Save for later"
            onSavedForLater={() =>
              router.push(`/record/space?propertyId=${propertyId}&spaceId=${space.id}` as never)
            }
          />
        </section>
      ) : null}

      {step === "Photos" && space ? (
        <section style={CARD}>
          <StepHeading title="Photos" body="Main view, plus one per amenity." />
          <SpacePhotos unitId={space.id} editable onChanged={reload} />
          <StepActions
            primary={<Button onClick={() => setStep("Review")}>Continue</Button>}
            links={[
              { label: "Back", onClick: () => setStep("Amenities") },
              {
                label: "Save for later",
                onClick: () => router.push(`/record/space?propertyId=${propertyId}&spaceId=${space.id}` as never),
              },
            ]}
          />
        </section>
      ) : null}

      {step === "Review" && space ? (
        <ReviewStep
          space={space}
          propertyId={propertyId}
          onBack={() => setStep("Photos")}
          onSent={() => router.push(`/record/space?propertyId=${propertyId}&spaceId=${space.id}` as never)}
          onReload={reload}
        />
      ) : null}
    </main>
  );
}

// --- step one: the space itself ----------------------------------------------

function DetailsStep({
  property,
  existing,
  onDone,
  onSaved,
}: {
  property: Property;
  existing: UnitDetail | null;
  onDone: (space: UnitDetail) => void;
  onSaved: (space: UnitDetail) => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [spaceType, setSpaceType] = useState(existing?.space_type ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [bedrooms, setBedrooms] = useState(existing?.bedrooms ?? 1);
  const [bathrooms, setBathrooms] = useState(existing?.bathrooms ?? 1);
  const [floor, setFloor] = useState(existing?.floor_level ?? 0);
  const [entrance, setEntrance] = useState(existing?.entrance_note ?? "");
  const [buildingId, setBuildingId] = useState(existing?.building_id ?? "");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [options, setOptions] = useState<SpaceTypeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<{ type?: string; name?: string }>({});

  useEffect(() => {
    void loadPropertyTypes()
      .then((types) => {
        const allowed = spaceTypesFor(types, property.property_type);
        setOptions(allowed);
        // Preselected only when there is nothing to decide. A hostel offers a
        // room or a bed space, and choosing for somebody is choosing wrong half
        // the time.
        if (allowed.length === 1) setSpaceType(allowed[0]!.value);
      })
      .catch(() => setOptions([]));
    void listBuildings(property.id).then(setBuildings).catch(() => setBuildings([]));
  }, [property.id, property.property_type]);

  const chosen = options.find((option) => option.value === spaceType) ?? null;
  // Only what fits this kind of space is asked (owner, 2026-10-05): a shop is
  // asked whether it has a bathroom, never how many bedrooms; a hostel room is
  // not asked for rooms; a bed space is asked neither. The backend serves the
  // rule and clears anything a space is never asked.
  const asks = chosen?.asks ?? null;

  async function submit(saveForLater = false) {
    const problems = {
      type: spaceType ? undefined : "Choose the Unit type.",
      name: label.trim() ? undefined : "Give it a name, e.g. Flat A or Room 3.",
    };
    setMissing(problems);
    if (problems.type || problems.name) {
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await createUnit(property.id, {
        label: label.trim(),
        space_type: spaceType,
        description,
        bedrooms: asks?.bedrooms ? bedrooms : 0,
        bathrooms: asks?.bathrooms === "none" ? 0 : bathrooms,
        floor_level: asks?.floor ? floor : null,
        entrance_note: entrance,
        ...(buildingId ? { building_id: buildingId } : {}),
      });
      if (saveForLater) onSaved(created);
      else onDone(created);
    } catch (cause) {
      // The backend names the problem ("A commercial property cannot contain
      // land…"), so it is shown as it is rather than as "That did not save."
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not save: check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const counts = asks
    ? [asks.bedrooms, asks.bathrooms !== "none", asks.floor].some(Boolean)
    : false;

  return (
    <section style={CARD}>
      <StepHeading title="The Unit" />

      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <div style={GRID}>
          <Select
            label="Unit type"
            hint={options.length ? undefined : "Loading…"}
            error={missing.type}
            value={spaceType}
            onChange={(next) => {
              setSpaceType(next);
              setMissing((current) => ({ ...current, type: undefined }));
            }}
            options={[
              ["", "Choose one"] as const,
              ...options.map((option) => [option.value, option.label] as const),
            ]}
          />
          <Field
            label="Name"
            placeholder="e.g. Flat A, Room 3"
            error={missing.name}
            value={label}
            maxLength={60}
            onChange={(event) => {
              setLabel(event.target.value);
              setMissing((current) => ({ ...current, name: undefined }));
            }}
          />
        </div>

        {counts && asks ? (
          <div className="count-row">
            {asks.bedrooms ? (
              <CountStepper label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={1} />
            ) : null}
            {asks.bathrooms === "count" ? (
              <CountStepper label="Bathrooms" value={bathrooms} onChange={setBathrooms} />
            ) : asks.bathrooms === "yes_no" ? (
              <YesNo
                label="Own bathroom"
                value={bathrooms > 0}
                onChange={(yes) => setBathrooms(yes ? 1 : 0)}
              />
            ) : null}
            {asks.floor ? (
              <CountStepper
                label="Floor"
                value={floor}
                onChange={setFloor}
                max={60}
                format={(value) => (value === 0 ? "Ground" : String(value))}
              />
            ) : null}
          </div>
        ) : null}

        {buildings.length ? (
          <Select
            label="Building or block"
            value={buildingId}
            onChange={setBuildingId}
            options={[
              ["", "Not in a named block"] as const,
              ...buildings.map((row) => [row.id, row.name] as const),
            ]}
          />
        ) : null}

        <Field
          label="Entrance directions (optional)"
          hint="Shared after a confirmed viewing."
          placeholder="e.g. Blue door, top of the outside stairs"
          value={entrance}
          onChange={(event) => setEntrance(event.target.value)}
        />

        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>
            Description (optional)
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={1500}
            className="type-body"
            style={TEXTAREA}
          />
        </label>

        {chosen?.accepts_bed_spaces ? (
          <Notice tone="info" title="Add beds after saving" body="Let the room whole, or bed by bed." />
        ) : null}

        {missing.type || missing.name ? (
          <Notice
            tone="error"
            title={missing.type && missing.name ? "Two details missing" : "One detail missing"}
            body={[missing.type, missing.name].filter(Boolean).join(" ")}
          />
        ) : null}
        {error ? <Notice tone="error" title="This Unit was not saved" body={error} /> : null}

        <StepActions
          primary={
            <Button onClick={() => void submit(false)} busy={busy} busyLabel="Saving…">
              Save and continue
            </Button>
          }
          links={[{ label: "Save for later", onClick: () => void submit(true), disabled: busy }]}
        />
      </div>
    </section>
  );
}

// --- last step: what happens when this is sent -------------------------------

function ReviewStep({
  space,
  propertyId,
  onBack,
  onSent,
  onReload,
}: {
  space: UnitDetail;
  propertyId: string;
  onBack: () => void;
  onSent: () => void;
  onReload: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    try {
      await submitForReview("unit", space.id);
      await onReload();
      onSent();
    } catch (cause) {
      // The refusal names what is outstanding, so it is worth showing as-is.
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send this yet.");
    } finally {
      setBusy(false);
    }
  }

  // Two different questions, and a screen that asks only the first sends people
  // to add a photograph when the real wait is the property's own review.
  const evidenceComplete = space.verification.can_submit;
  const permitted = space.permitted_actions.submit_for_verification;
  const waitingOnProperty =
    permitted !== undefined &&
    !permitted.allowed &&
    permitted.blockers.some((blocker) => blocker.kind.startsWith("verification_"));
  const ready = evidenceComplete && permitted?.allowed !== false;

  return (
    <section style={CARD}>
      <StepHeading
        title="Send for checking"
        body="We compare the photos with your details."
      />

      <dl style={{ display: "grid", gap: "var(--space-3)", margin: 0 }}>
        <Row term="Type" value={space.space_type_label} />
        <Row term="Name" value={space.label || "Not named"} />
        <Row
          term="Amenities"
          value={
            space.amenities.length
              ? space.amenities.map((row) => row.name).join(", ")
              : "None recorded"
          }
        />
        <Row
          term="Photos"
          value={`${space.photo_count} of ${space.verification.required_total + 2}`}
        />
      </dl>

      {ready ? (
        <Notice
          tone="info"
          title="Ready to send"
          body="You can keep working meanwhile."
        />
      ) : waitingOnProperty ? (
        <Notice
          tone="info"
          title="The property must be checked first"
          body={permitted?.message}
        />
      ) : (
        <Notice
          tone="warning"
          title={`${space.verification.required_outstanding} required photo${
            space.verification.required_outstanding === 1 ? "" : "s"
          } missing`}
          body="Go back to Photos to add them."
        />
      )}

      {error ? <Notice tone="error" title={error} /> : null}

      <StepActions
        primary={
          <Button onClick={send} busy={busy} busyLabel="Sending…" disabled={!ready}>
            Send for checking
          </Button>
        }
        links={[
          { label: "Back", onClick: onBack },
          {
            label: "Save for later",
            onClick: () => router.push(`/record/space?propertyId=${propertyId}&spaceId=${space.id}` as never),
          },
          waitingOnProperty && {
            label: "Get the property checked",
            onClick: () => router.push(`/record/property?id=${propertyId}` as never),
          },
        ]}
      />
    </section>
  );
}

// --- small pieces -------------------------------------------------------------

function Progress({
  current,
  reached,
  canJump,
  onJump,
}: {
  current: Step;
  reached: number;
  canJump: boolean;
  onJump: (step: Step) => void;
}) {
  const checkpoints: CreationCheckpoint[] = STEPS.map((step, index) => ({
    key: step.toLowerCase(),
    label: step,
    icon: {
      Details: "details",
      Amenities: "amenities",
      Photos: "photos",
      Review: "verification",
    }[step] as CreationCheckpoint["icon"],
    state: step === current ? "current" : index < reached ? "completed" : "upcoming",
  }));
  return (
    <div style={{ margin: "var(--space-8) 0 var(--space-6)" }}>
      <CheckpointJourney
        checkpoints={checkpoints}
        label="BUILDING UNIT"
        ariaLabel="Unit creation checkpoints"
        onSelect={(key) => {
          const step = STEPS.find((row) => row.toLowerCase() === key);
          if (step) onJump(step);
        }}
        canSelect={(checkpoint) => canJump || checkpoint.key === "details"}
      />
    </div>
  );
}

function StepHeading({ title, body }: { title: string; body?: string }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-1)" }}>
      <h2 className="type-title-2" style={{ margin: 0 }}>
        {title}
      </h2>
      {body ? (
        <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
          {body}
        </p>
      ) : null}
    </div>
  );
}

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

const SHELL: React.CSSProperties = {
  maxWidth: "56rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-5)",
};

const CARD: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-5)",
  padding: "var(--space-6)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-200)",
  borderRadius: "var(--radius-md)",
};

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
  gap: "var(--space-4)",
  // A hint under one field must not stretch the input beside it.
  alignItems: "start",
};

const TEXTAREA: React.CSSProperties = {
  padding: "var(--space-3)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-300)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-ink-900)",
  resize: "vertical",
};
