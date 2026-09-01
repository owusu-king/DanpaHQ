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
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
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
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = params.id;
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
        href={`/properties/${propertyId}`}
        className="type-caption"
        style={{ color: "var(--color-kola-600)" }}
      >
        ← {property.title || "This property"}
      </Link>

      <header style={{ marginTop: "var(--space-4)" }}>
        <h1 className="type-display-2" style={{ margin: 0 }}>
          Add Unit
        </h1>
        <p
          className="type-body"
          style={{ color: "var(--color-ink-700)", margin: "var(--space-2) 0 0", maxWidth: "58ch" }}
        >
          A Unit is the space a tenant actually rents — {property.property_type === "hostel"
            ? "one hostel room or one bed space"
            : "one flat, room, shop or other rentable space"}. It sits inside {property.title || "this property"} and takes its
          address, its location and its checks from it.
        </p>
      </header>

      <Progress current={step} reached={space ? STEPS.indexOf(step) : 0} />

      {step === "Details" ? (
        <DetailsStep
          property={property}
          existing={space}
          onDone={(created) => {
            setSpace(created);
            setStep("Amenities");
          }}
          onSaved={(created) =>
            router.push(`/properties/${propertyId}/spaces/${created.id}` as never)
          }
        />
      ) : null}

      {step === "Amenities" && space ? (
        <section style={CARD}>
          <StepHeading
            title="What does this Unit have?"
            body={`Only what belongs to ${
              space.label || "this Unit"
            } itself. Anything the whole compound shares — a borehole, a guard, parking — is recorded once on the property.`}
          />
          <SpaceAmenities
            scope="unit"
            id={space.id}
            saveLabel="Save and continue"
            onSaved={() => setStep("Photos")}
            saveForLaterLabel="Save for later"
            onSavedForLater={() =>
              router.push(`/properties/${propertyId}/spaces/${space.id}` as never)
            }
          />
          <StepFooter
            back={() => setStep("Details")}
            skip={() => setStep("Photos")}
            skipLabel="Skip for now"
          />
        </section>
      ) : null}

      {step === "Photos" && space ? (
        <section style={CARD}>
          <StepHeading
            title="Show the Unit"
            body="Add the main view, then one clear photo of every amenity you selected. Two further context views are optional. These are also the photos a tenant sees."
          />
          <SpacePhotos unitId={space.id} editable onChanged={reload} />
          <StepFooter
            back={() => setStep("Amenities")}
            next={() => setStep("Review")}
            saveLater={() => router.push(`/properties/${propertyId}/spaces/${space.id}` as never)}
          />
        </section>
      ) : null}

      {step === "Review" && space ? (
        <ReviewStep
          space={space}
          propertyId={propertyId}
          onBack={() => setStep("Photos")}
          onSent={() => router.push(`/properties/${propertyId}/spaces/${space.id}` as never)}
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
  const [bedrooms, setBedrooms] = useState(String(existing?.bedrooms ?? 1));
  const [bathrooms, setBathrooms] = useState(String(existing?.bathrooms ?? 1));
  const [floor, setFloor] = useState(
    existing?.floor_level === null || existing?.floor_level === undefined
      ? ""
      : String(existing.floor_level),
  );
  const [wing, setWing] = useState(existing?.wing ?? "");
  const [entrance, setEntrance] = useState(existing?.entrance_note ?? "");
  const [buildingId, setBuildingId] = useState(existing?.building_id ?? "");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [options, setOptions] = useState<SpaceTypeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
  // Land has nothing to count. Asking invites a record claiming a plot has two
  // bathrooms, which the backend refuses anyway.
  const countsApply = chosen?.has_interior !== false;

  async function submit(saveForLater = false) {
    setBusy(true);
    setError("");
    try {
      const created = await createUnit(property.id, {
        label,
        space_type: spaceType,
        description,
        bedrooms: countsApply ? Number(bedrooms || 0) : 0,
        bathrooms: countsApply ? Number(bathrooms || 0) : 0,
        floor_level: floor === "" ? null : Number(floor),
        wing,
        entrance_note: entrance,
        ...(buildingId ? { building_id: buildingId } : {}),
      });
      if (saveForLater) onSaved(created);
      else onDone(created);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={CARD}>
      <StepHeading
        title="What is being let here?"
        body="Only what is true of this Unit. The address, the area and who holds the Property come from the Property itself."
      />

      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Select
          label="What is let here?"
          hint={
            options.length
              ? "Only what this kind of property can contain is offered."
              : "Loading the options for this property…"
          }
          value={spaceType}
          onChange={setSpaceType}
          options={[
            ["", "Choose one"] as const,
            ...options.map((option) => [option.value, option.label] as const),
          ]}
        />

        <Field
          label="What do you call it?"
          hint="Flat A, Room 3, Ground floor shop. How you refer to it."
          value={label}
          autoFocus
          onChange={(event) => setLabel(event.target.value)}
        />

        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>
            Describe it
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={1500}
            placeholder="Two bedrooms, both facing the yard. Prepaid meter of its own."
            className="type-body"
            style={TEXTAREA}
          />
          <span className="type-caption" style={{ color: "var(--color-ink-500)" }}>
            This stays with the space. A tenant using private access never sees a
            listing, and this is what they read.
          </span>
        </label>

        {countsApply ? (
          <div style={GRID}>
            <Field
              label="Bedrooms"
              hint="0 for a single room."
              inputMode="numeric"
              value={bedrooms}
              onChange={(event) => setBedrooms(event.target.value.replace(/\D/g, ""))}
            />
            <Field
              label="Bathrooms"
              inputMode="numeric"
              value={bathrooms}
              onChange={(event) => setBathrooms(event.target.value.replace(/\D/g, ""))}
            />
          </div>
        ) : null}

        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <legend
            className="type-label"
            style={{ color: "var(--color-ink-500)", textTransform: "uppercase", padding: 0 }}
          >
            Where inside the property
          </legend>
          <p className="type-caption" style={{ margin: "var(--space-2) 0 var(--space-3)" }}>
            Only what differs between two spaces at this address. All optional.
          </p>
          <div style={GRID}>
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
              label="Floor"
              hint="0 for ground."
              inputMode="numeric"
              value={floor}
              onChange={(event) => setFloor(event.target.value.replace(/[^0-9-]/g, ""))}
            />
            <Field
              label="Wing"
              hint="Where one is named."
              value={wing}
              onChange={(event) => setWing(event.target.value)}
            />
          </div>
          <div style={{ marginTop: "var(--space-4)" }}>
            <Field
              label="How to find the door"
              hint="Shared only after a viewing is confirmed, never on a public page."
              placeholder="Blue door at the top of the outside stairs"
              value={entrance}
              onChange={(event) => setEntrance(event.target.value)}
            />
          </div>
        </fieldset>

        {chosen?.accepts_bed_spaces ? (
          <Notice
            tone="info"
            title="You can add bed spaces to this room"
            body="Save the room first, then add each bed. A bed can be let on its own, or you can let the whole room."
          />
        ) : null}

        {error ? <Notice tone="error" title={error} /> : null}

        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Button onClick={() => void submit(false)} busy={busy} busyLabel="Saving…" disabled={!spaceType}>
            Save and continue
          </Button>
          <Button variant="quiet" onClick={() => void submit(true)} busy={busy} disabled={!spaceType}>
            Save for later
          </Button>
        </div>
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
        title="Send it for checking"
        body="Our team looks at the photo against what you have said the space is. Until that passes, private access and advertising stay unavailable."
      />

      <dl style={{ display: "grid", gap: "var(--space-3)", margin: 0 }}>
        <Row term="What is let" value={space.space_type_label} />
        <Row term="Called" value={space.label || "Not named"} />
        {space.description ? <Row term="Described as" value={space.description} /> : null}
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
          title="What sending this does"
          body="It goes to our team with the photos attached. You can keep working on the rest of the property meanwhile — nothing else waits on this."
        />
      ) : waitingOnProperty ? (
        <Notice
          tone="info"
          title="The entire property has to be verified first"
          body={
            permitted?.message ??
            "This Unit can be sent once the Property's documents and photographs are approved together."
          }
        />
      ) : (
        <Notice
          tone="warning"
          title={`${space.verification.required_outstanding} photo still needed`}
          body="Go back a step and add the main interior view. It is the one thing photographs of the building cannot show."
        />
      )}

      {error ? <Notice tone="error" title={error} /> : null}

      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Button onClick={send} busy={busy} busyLabel="Sending…" disabled={!ready}>
          Send for checking
        </Button>
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
        <Link
          href={`/properties/${propertyId}/spaces/${space.id}` as never}
          className="type-caption"
          style={{ alignSelf: "center", color: "var(--color-kola-600)" }}
        >
          Save for later →
        </Link>
        {waitingOnProperty ? (
          <Link
            href={`/properties/${propertyId}` as never}
            className="type-caption"
            style={{ alignSelf: "center", color: "var(--color-kola-600)" }}
          >
            Get the property checked →
          </Link>
        ) : null}
      </div>
    </section>
  );
}

// --- small pieces -------------------------------------------------------------

function Progress({ current, reached }: { current: Step; reached: number }) {
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
      />
    </div>
  );
}

function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <h2 className="type-title-2" style={{ margin: 0 }}>
        {title}
      </h2>
      <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
        {body}
      </p>
    </div>
  );
}

function StepFooter({
  back,
  next,
  skip,
  skipLabel,
  saveLater,
}: {
  back: () => void;
  next?: () => void;
  skip?: () => void;
  skipLabel?: string;
  saveLater?: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
      {next ? <Button onClick={next}>Continue</Button> : null}
      {skip ? (
        <Button variant="secondary" onClick={skip}>
          {skipLabel ?? "Skip"}
        </Button>
      ) : null}
      <Button variant="quiet" onClick={back}>
        Back
      </Button>
      {saveLater ? (
        <Button variant="quiet" onClick={saveLater}>
          Save for later
        </Button>
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
};

const TEXTAREA: React.CSSProperties = {
  padding: "var(--space-3)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-300)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-ink-900)",
  resize: "vertical",
};
