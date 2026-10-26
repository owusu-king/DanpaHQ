"use client";

/**
 * Adding a Unit, in one modal (owner, 2026-10-20).
 *
 * The Unit → amenities → photos → review, in the same frame as creating a
 * property. The Unit is written when its details are saved, because amenities
 * and photographs need something to attach to; every later step writes to that
 * record, so closing the sheet loses only the step on screen.
 *
 * Review ends in **Send for checking** when the photographs are in and the
 * property's own check allows it, and otherwise in **Finish**: a Unit can wait
 * privately, and the review says plainly what it is waiting on.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { CountStepper, YesNo } from "@/components/creation/StepActions";
import { ChoiceTiles, ReviewLine, WizardShell, type WizardStep } from "@/components/creation/WizardShell";
import { Icon, type IconName } from "@/components/portal/icons";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import {
  createUnit,
  getProperty,
  getUnit,
  updateUnit,
  type Property,
  type UnitDetail,
} from "@/lib/console";
import { loadPropertyTypes, spaceTypesFor, type SpaceTypeOption } from "@/lib/propertyTypes";
import { submitForReview } from "@/lib/verification";

type StepKey = "details" | "amenities" | "photos" | "review";
type Commit = () => Promise<boolean>;
type CommitRef = { current: Commit | null };

const STEPS: { key: StepKey; label: string; hint: string; icon: IconName }[] = [
  { key: "details", label: "The Unit", hint: "What it is, what it is called, and its rooms.", icon: "units" },
  { key: "amenities", label: "Amenities", hint: "What this Unit has of its own.", icon: "amenities" },
  { key: "photos", label: "Photos", hint: "The main view, then one of each amenity.", icon: "photos" },
  { key: "review", label: "Review", hint: "Check it over, then send it for checking.", icon: "eye" },
];

const SPACE_GLYPHS: Record<string, IconName> = {
  apartment: "home",
  house: "home",
  studio: "sofa",
  room: "bed",
  bed_space: "bed",
  shop: "shop",
  office: "desk",
  warehouse: "truck",
  land: "map",
};

export function UnitWizard({
  propertyId,
  unitId: initialUnit = null,
  startAt = null,
  onClose,
  onFinished,
  onTitle,
}: {
  propertyId: string;
  /** A Unit already saved, to carry on with. */
  unitId?: string | null;
  startAt?: string | null;
  onClose: () => void;
  onFinished: (unit: UnitDetail) => void;
  onTitle?: (title: string) => void;
}) {
  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [step, setStep] = useState<StepKey>("details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const commitRef = useRef<Commit | null>(null);
  const created = useRef<UnitDetail | null>(null);

  useEffect(() => {
    getProperty(propertyId)
      .then(setProperty)
      .catch((cause) => setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this property."));
  }, [propertyId]);

  useEffect(() => {
    if (!initialUnit) return;
    getUnit(initialUnit)
      .then((saved) => {
        if (saved.property.id !== propertyId) {
          setError("That Unit belongs to another Property.");
          return;
        }
        setUnit(saved);
        const asked = STEPS.find((row) => row.key === startAt)?.key;
        setStep(asked ?? "amenities");
      })
      .catch((cause) => setError(cause instanceof ApiFailure ? cause.error.message : "Could not reopen this Unit."));
  }, [initialUnit, propertyId, startAt]);

  useEffect(() => {
    if (unit?.label) onTitle?.(unit.label);
  }, [unit?.label, onTitle]);

  const reload = useCallback(async () => {
    const current = unit ?? created.current;
    if (!current) return null;
    const next = await getUnit(current.id);
    setUnit(next);
    return next;
  }, [unit]);

  const at = STEPS.findIndex((row) => row.key === step);
  const ready = unit ? unit.verification.can_submit && unit.permitted_actions.submit_for_verification?.allowed !== false : false;
  const sent = unit ? !unit.verification.editable : false;

  function go(key: StepKey) {
    setError("");
    commitRef.current = null;
    setStep(key);
  }

  async function advance() {
    setBusy(true);
    setError("");
    try {
      const ok = commitRef.current ? await commitRef.current() : true;
      if (!ok) return;
      const next = await reload();
      if (step === "review") {
        const current = next ?? unit;
        if (!current) return;
        if (ready && !sent) {
          await submitForReview("unit", current.id);
          onFinished((await getUnit(current.id)) ?? current);
        } else {
          onFinished(current);
        }
        return;
      }
      const following = STEPS[at + 1];
      if (following) go(following.key);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!property) {
    return (
      <div className="cw-loading">
        {error ? <Notice tone="error" title={error} /> : <p className="type-caption">Loading…</p>}
      </div>
    );
  }

  const photosDone = unit ? unit.verification.required_outstanding === 0 : false;
  const railSteps: WizardStep[] = STEPS.map((row) => ({
    ...row,
    done:
      row.key === "details" ? Boolean(unit)
        : row.key === "amenities" ? Boolean(unit) && at > 1
          : row.key === "photos" ? photosDone
            : false,
    reachable: !busy && (row.key === "details" || Boolean(unit)),
    summary:
      row.key === "details" ? unit?.label
        : row.key === "amenities" && unit ? (unit.amenities.length ? `${unit.amenities.length} chosen` : undefined)
          : row.key === "photos" && unit ? `${unit.photo_count} added`
            : undefined,
  }));

  const primary =
    step === "review"
      ? ready && !sent ? "Send for checking" : "Finish"
      : step === "details" && !unit ? "Save and continue" : "Continue";

  return (
    <WizardShell
      label="Unit steps"
      steps={railSteps}
      current={step}
      onGo={(key) => go(key as StepKey)}
      railFoot={<><Icon name="properties" />In {property.title || "this property"}</>}
      footer={
        <>
          {at > 0 ? (
            <Button variant="quiet" disabled={busy} onClick={() => go(STEPS[at - 1]!.key)}>Back</Button>
          ) : (
            <Button variant="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
          )}
          <span className="lw-foot-spacer" />
          {unit && step !== "review" ? (
            <Button variant="quiet" disabled={busy} onClick={onClose}>Finish later</Button>
          ) : null}
          {step === "review" && ready && !sent ? (
            <Button variant="quiet" disabled={busy} onClick={() => unit && onFinished(unit)}>Not yet</Button>
          ) : null}
          <Button busy={busy} busyLabel={step === "review" && ready ? "Sending…" : "Saving…"} onClick={() => void advance()}>
            {primary}
          </Button>
        </>
      }
    >
      {step === "details" ? (
        <DetailsStep
          property={property}
          unit={unit}
          commitRef={commitRef}
          onCreated={(next) => {
            created.current = next;
            setUnit(next);
          }}
        />
      ) : null}

      {step === "amenities" && unit ? <AmenitiesStep unitId={unit.id} commitRef={commitRef} /> : null}

      {step === "photos" && unit ? (
        <SpacePhotos unitId={unit.id} editable={unit.verification.editable} onChanged={async () => { await reload(); }} />
      ) : null}

      {step === "review" && unit ? <ReviewStep unit={unit} ready={ready} sent={sent} onGo={go} /> : null}

      {error ? <Notice tone="error" title={error} /> : null}
    </WizardShell>
  );
}

/** The wizard in its sheet. */
export function UnitWizardModal({
  open,
  propertyId,
  unitId = null,
  startAt = null,
  onClose,
  onFinished,
}: {
  open: boolean;
  propertyId: string;
  unitId?: string | null;
  startAt?: string | null;
  onClose: () => void;
  onFinished: (unit: UnitDetail) => void;
}) {
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (!open) setTitle("");
  }, [open]);
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      size="sm"
      icon="units"
      title={title || "Add Unit"}
      meta="Saved as you go"
      className="lease-wizard-sheet is-wizard creation-sheet"
      closeLabel="Close Unit setup"
    >
      {(close) => (
        <UnitWizard
          propertyId={propertyId}
          unitId={unitId}
          startAt={startAt}
          onClose={close}
          onTitle={setTitle}
          onFinished={(unit) => {
            onFinished(unit);
            close();
          }}
        />
      )}
    </ModalSheet>
  );
}

// --- the steps ----------------------------------------------------------------

function useCommit(commitRef: CommitRef, run: Commit) {
  useEffect(() => {
    commitRef.current = run;
  });
  useEffect(() => () => {
    commitRef.current = null;
  }, [commitRef]);
}

function DetailsStep({
  property,
  unit,
  commitRef,
  onCreated,
}: {
  property: Property;
  unit: UnitDetail | null;
  commitRef: CommitRef;
  onCreated: (unit: UnitDetail) => void;
}) {
  const [options, setOptions] = useState<SpaceTypeOption[]>([]);
  const [spaceType, setSpaceType] = useState(unit?.space_type ?? "");
  const [label, setLabel] = useState(unit?.label ?? "");
  const [bedrooms, setBedrooms] = useState(unit?.bedrooms || 1);
  const [bathrooms, setBathrooms] = useState(unit?.bathrooms ?? 1);
  const [floor, setFloor] = useState(unit?.floor_level ?? 0);
  const [wing, setWing] = useState(unit?.wing ?? "");
  const [entrance, setEntrance] = useState(unit?.entrance_note ?? "");
  const [description, setDescription] = useState(unit?.description ?? "");
  const [missing, setMissing] = useState<{ type?: string; name?: string }>({});
  const editable = unit ? unit.verification.editable : true;

  useEffect(() => {
    void loadPropertyTypes()
      .then((types) => {
        const allowed = spaceTypesFor(types, property.property_type);
        setOptions(allowed);
        // Chosen for somebody only when there is nothing to choose.
        if (allowed.length === 1) setSpaceType((current) => current || allowed[0]!.value);
      })
      .catch(() => setOptions([]));
  }, [property.property_type]);

  const chosen = options.find((option) => option.value === spaceType) ?? null;
  const asks = chosen?.asks ?? null;

  useCommit(commitRef, async () => {
    const problems = {
      type: spaceType ? undefined : "Choose what is being let.",
      name: label.trim() ? undefined : "Give it a name, e.g. Flat A or Room 3.",
    };
    setMissing(problems);
    if (problems.type || problems.name) return false;
    const fields = {
      label: label.trim(),
      description: description.trim(),
      bedrooms: asks?.bedrooms ? bedrooms : 0,
      bathrooms: asks?.bathrooms === "none" ? 0 : bathrooms,
      floor_level: asks?.floor ? floor : null,
      wing: wing.trim(),
      entrance_note: entrance.trim(),
    };
    if (unit) {
      if (editable) await updateUnit(unit.id, fields);
      return true;
    }
    onCreated(await createUnit(property.id, { ...fields, space_type: spaceType }));
    return true;
  });

  return (
    <div className="cw-form">
      {options.length ? (
        <ChoiceTiles
          label="What is being let?"
          value={spaceType}
          columns={Math.min(options.length, 4)}
          onChange={(value) => {
            // The type decides what is asked and photographed, so it is fixed
            // once the Unit exists.
            if (unit) return;
            setSpaceType(value);
            setMissing((current) => ({ ...current, type: undefined }));
          }}
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            icon: SPACE_GLYPHS[option.value] ?? "units",
          }))}
        />
      ) : (
        <p className="type-caption">Loading what this property can hold…</p>
      )}
      {missing.type ? <p className="cw-missing">{missing.type}</p> : null}

      <div className="lw-grid">
        <Field
          label="Name"
          placeholder="e.g. Flat A, Room 3"
          maxLength={40}
          value={label}
          disabled={!editable}
          error={missing.name}
          onChange={(event) => {
            setLabel(event.target.value);
            setMissing((current) => ({ ...current, name: undefined }));
          }}
        />
        <Field
          label="Block or wing"
          hint="Optional"
          placeholder="e.g. Block B"
          maxLength={40}
          value={wing}
          disabled={!editable}
          onChange={(event) => setWing(event.target.value)}
        />
      </div>

      {asks && (asks.bedrooms || asks.bathrooms !== "none" || asks.floor) ? (
        <div className="count-row">
          {asks.bedrooms ? <CountStepper label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={1} /> : null}
          {asks.bathrooms === "count" ? (
            <CountStepper label="Bathrooms" value={bathrooms} onChange={setBathrooms} />
          ) : asks.bathrooms === "yes_no" ? (
            <YesNo label="Own bathroom" value={bathrooms > 0} onChange={(yes) => setBathrooms(yes ? 1 : 0)} />
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

      <Field
        label="How to find its door"
        hint="Optional. Shared only after a confirmed viewing."
        placeholder="e.g. Blue door, top of the outside stairs"
        maxLength={200}
        value={entrance}
        disabled={!editable}
        onChange={(event) => setEntrance(event.target.value)}
      />

      <label className="lw-field">
        <span className="lw-label">Description <small>Optional</small></span>
        <textarea
          className="lw-textarea"
          rows={3}
          maxLength={1500}
          value={description}
          disabled={!editable}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      {chosen?.accepts_bed_spaces ? (
        <p className="lw-quiet"><Icon name="bed" />Let it whole, or add its beds once it is saved.</p>
      ) : null}
    </div>
  );
}

function AmenitiesStep({ unitId, commitRef }: { unitId: string; commitRef: CommitRef }) {
  const save = useRef<Commit | null>(null);
  useCommit(commitRef, async () => (save.current ? save.current() : true));
  return (
    <div className="cw-form">
      <p className="lw-quiet"><Icon name="photos" />Each one you choose is photographed next.</p>
      <SpaceAmenities scope="unit" id={unitId} submitRef={save} />
    </div>
  );
}

function ReviewStep({
  unit,
  ready,
  sent,
  onGo,
}: {
  unit: UnitDetail;
  ready: boolean;
  sent: boolean;
  onGo: (key: StepKey) => void;
}) {
  const permitted = unit.permitted_actions.submit_for_verification;
  const waitingOnProperty =
    permitted !== undefined && !permitted.allowed && permitted.blockers.some((row) => row.kind.startsWith("verification_"));
  const rooms = [
    unit.bedrooms ? `${unit.bedrooms} bedroom${unit.bedrooms === 1 ? "" : "s"}` : "",
    unit.bathrooms ? `${unit.bathrooms} bathroom${unit.bathrooms === 1 ? "" : "s"}` : "",
    unit.floor_level !== null ? (unit.floor_level === 0 ? "Ground floor" : `Floor ${unit.floor_level}`) : "",
  ].filter(Boolean);
  const outstanding = unit.verification.required_outstanding;

  return (
    <div className="cw-form">
      <dl className="cw-review">
        <ReviewLine
          icon={SPACE_GLYPHS[unit.space_type] ?? "units"}
          term={unit.label || "Not named"}
          value={[unit.space_type_label, ...rooms].join(" · ")}
          onEdit={() => onGo("details")}
        />
        {unit.wing ? <ReviewLine icon="pin" term="Block or wing" value={unit.wing} onEdit={() => onGo("details")} /> : null}
        <ReviewLine
          icon="amenities"
          term="Amenities"
          value={unit.amenities.length ? unit.amenities.map((row) => row.name).join(", ") : "None of its own"}
          onEdit={() => onGo("amenities")}
        />
        <ReviewLine
          icon="photos"
          term="Photos"
          tone={outstanding ? "todo" : undefined}
          value={outstanding ? `${outstanding} still needed` : `${unit.photo_count} added`}
          onEdit={() => onGo("photos")}
        />
      </dl>

      {sent ? (
        <p className="lw-quiet"><Icon name="verification" />{unit.verification.state_label}</p>
      ) : ready ? (
        <p className="lw-quiet"><Icon name="lock" />We compare the photos with these details. Nobody can request it until it passes.</p>
      ) : waitingOnProperty ? (
        <p className="cw-missing">{permitted?.message || "The property is checked first. The Unit waits privately until then."}</p>
      ) : outstanding ? (
        <p className="cw-missing">Add the missing photo{outstanding === 1 ? "" : "s"} to send it for checking.</p>
      ) : null}
    </div>
  );
}
