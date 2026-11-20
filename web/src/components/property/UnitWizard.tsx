"use client";

/**
 * Adding a Unit, in one modal (owner, 2026-10-20).
 *
 * The Unit → amenities → photos → review, in the same frame as creating a
 * property. The Unit is written when its details are saved, because amenities
 * and photographs need something to attach to; every later step writes to that
 * record. Unfinished edits stay available until the wizard closes.
 *
 * Review ends in **Send for checking** when the photographs are in and the
 * property's own check allows it, and otherwise in **Finish**: a Unit can wait
 * privately, and the review says plainly what it is waiting on.
 */

import { useCallback, useEffect, useState, useRef } from "react";

import { Button } from "@/components/Button";
import { Field, Textarea } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { CountStepper, YesNo } from "@/components/creation/StepActions";
import { ChoiceTiles, FormSection, ReviewLine, WizardShell, type WizardStep } from "@/components/creation/WizardShell";
import { useWizardDraft, type CloseGuard } from "@/components/creation/useWizardDraft";
import { Icon, type IconName } from "@/components/portal/icons";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import { ApiFailure } from "@/lib/api";
import {
  createUnit,
  getProperty,
  getUnit,
  updateUnit,
  type Property,
  type UnitDetail,
} from "@/lib/console";
import { loadPropertyTypes, spaceTypesFor, type PropertyTypeOption, type SpaceTypeOption } from "@/lib/propertyTypes";
import { submitForReview } from "@/lib/verification";

type StepKey = "details" | "amenities" | "photos" | "review";
type Commit = () => Promise<boolean>;
type CommitRef = { current: Commit | null };
export type UnitWizardMode =
  | { mode: "create"; unitId?: never; startAt?: never }
  | { mode: "edit"; unitId: string; startAt?: string | null };

const STEPS: { key: StepKey; label: string; icon: IconName }[] = [
  { key: "details", label: "The Unit", icon: "units" },
  { key: "amenities", label: "Amenities", icon: "amenities" },
  { key: "photos", label: "Photos", icon: "photos" },
  { key: "review", label: "Review", icon: "eye" },
];
const STEP_KEYS = STEPS.map((step) => step.key);

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
  mode,
  propertyId,
  unitId,
  startAt = null,
  onFinished,
  onCancel,
  onChanged,
  closeGuardRef,
  onBusyChange,
}: UnitWizardMode & {
  propertyId: string;
  onFinished: (unit: UnitDetail) => void;
  onCancel?: () => void;
  /** Notify successful writes, never dismissal. */
  onChanged?: () => void;
  closeGuardRef?: CloseGuard;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [step, setStep] = useState<StepKey>(() => STEP_KEYS.find((key) => key === startAt) ?? "details");
  const [amenitiesSaved, setAmenitiesSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [error, setError] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[] | null>(null);
  const [typesError, setTypesError] = useState("");

  useEffect(() => {
    if (!propertyId || (mode === "edit" && !unitId)) return;
    let active = true;
    Promise.all([getProperty(propertyId), unitId ? getUnit(unitId) : null])
      .then(([record, saved]) => {
        if (!active) return;
        if (saved && (saved.id !== unitId || saved.property.id !== propertyId)) {
          setError("That Unit belongs to another Property.");
          return;
        }
        setProperty(record);
        setUnit(saved);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Unit setup.");
      });
    return () => { active = false; };
  }, [mode, propertyId, unitId]);

  useEffect(() => {
    if (step !== "details" || propertyTypes) return;
    let active = true;
    setTypesError("");
    loadPropertyTypes()
      .then((types) => { if (active) setPropertyTypes(types); })
      .catch((cause) => {
        if (active) setTypesError(cause instanceof ApiFailure ? cause.error.message : "Could not load the Unit types. Reopen setup to try again.");
      })
    return () => { active = false; };
  }, [propertyTypes, step]);

  const reload = useCallback(async () => {
    if (!unit) return null;
    const next = await getUnit(unit.id);
    setUnit(next);
    return next;
  }, [unit]);

  const at = STEPS.findIndex((row) => row.key === step);
  const draft = useWizardDraft(STEP_KEYS, step, busy || mediaBusy, closeGuardRef, onBusyChange);
  const detailsEditable = !unit || unit.verification.editable;
  const ready = unit ? unit.verification.can_submit && unit.permitted_actions.submit_for_verification?.allowed === true : false;
  const sent = unit ? !unit.verification.editable : false;

  function go(key: StepKey) {
    if (mediaBusy) return;
    setError("");
    setStep(key);
  }

  async function advance() {
    if (busy || mediaBusy) return;
    if (step === "review" && !draft.confirmFinish()) return;
    setBusy(true);
    setError("");
    try {
      const commit = draft.commits[step].current;
      const ok = commit ? await commit() : true;
      if (!ok) return;
      draft.markSaved();
      if (step === "amenities") {
        setAmenitiesSaved(true);
        onChanged?.();
        await reload();
      }
      if (step === "review") {
        const current = (await reload()) ?? unit;
        if (!current) return;
        if (current.verification.editable && current.verification.can_submit && current.permitted_actions.submit_for_verification?.allowed === true) {
          await submitForReview("unit", current.id);
          onChanged?.();
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

  if (!property || property.id !== propertyId || (mode === "edit" && (!unit || unit.id !== unitId || unit.property.id !== propertyId))) {
    return (
      <div className="cw-loading">
        {error ? <Notice tone="error" inline title={error} /> : <p className="type-caption">Loading…</p>}
      </div>
    );
  }
  const options = propertyTypes ? spaceTypesFor(propertyTypes, property.property_type) : null;

  const photosDone = unit ? unit.verification.required_outstanding === 0 : false;
  const checkpoints: WizardStep[] = STEPS.map((row) => ({
    ...row,
    done:
      row.key === "details" ? Boolean(unit)
        : row.key === "amenities" ? amenitiesSaved
          : row.key === "photos" ? photosDone
            : false,
    reachable: !busy && !mediaBusy && (row.key === "details" || Boolean(unit)),
  }));

  const primary =
    step === "review"
      ? ready && !sent ? "Send for checking" : "Finish"
      : step === "details" && detailsEditable ? "Save and continue" : "Continue";

  return (
    <WizardShell
      label="Unit steps"
      steps={checkpoints}
      current={step}
      onGo={(key) => go(key as StepKey)}
      context={`In ${property.title || "this property"}`}
      dirty={draft.dirty}
      busy={busy}
      onEdit={draft.markEdited}
      footer={
        <>
          {onCancel ? <Button variant="quiet" disabled={busy || mediaBusy} onClick={onCancel}>Cancel</Button> : null}
          {at > 0 ? (
            <Button variant="quiet" disabled={busy || mediaBusy} onClick={() => go(STEPS[at - 1]!.key)}>Back</Button>
          ) : null}
          <span className="lw-foot-spacer" />

          {step === "review" && ready && !sent ? (
            <Button variant="quiet" disabled={busy} onClick={() => { if (unit && draft.confirmFinish()) onFinished(unit); }}>Not yet</Button>
          ) : null}
          <Button disabled={mediaBusy || (step === "details" && !options)} busy={busy} busyLabel={step === "review" && ready ? "Sending…" : "Saving…"} onClick={() => void advance()}>
            {primary}
          </Button>
        </>
      }
      panels={{
        details: options ? (
          <DetailsStep
            property={property}
            unit={unit}
            options={options}
            commitRef={draft.commits.details}
            onSaved={(next) => {
              setUnit(next);
              onChanged?.();
            }}
          />
        ) : typesError ? <Notice tone="error" inline title={typesError} /> : <p className="type-caption">Loading…</p>,
        amenities: unit && <AmenitiesStep unitId={unit.id} commitRef={draft.commits.amenities} />,
        photos: unit && (
          <SpacePhotos onMediaBusy={setMediaBusy} unitId={unit.id} editable={unit.verification.editable} onChanged={async () => { onChanged?.(); await reload(); }} />
        ),
        review: unit && <ReviewStep unit={unit} ready={ready} sent={sent} onGo={go} />,
      }}
    >
      {error ? <Notice tone="error" inline title={error} /> : null}
    </WizardShell>
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
  options,
  commitRef,
  onSaved,
}: {
  property: Property;
  unit: UnitDetail | null;
  options: SpaceTypeOption[];
  commitRef: CommitRef;
  onSaved: (unit: UnitDetail) => void;
}) {
  const [spaceType, setSpaceType] = useState(unit?.space_type ?? (options.length === 1 ? options[0]!.value : ""));
  const [label, setLabel] = useState(unit?.label ?? "");
  const [bedrooms, setBedrooms] = useState(unit?.bedrooms ?? 1);
  const [bathrooms, setBathrooms] = useState(unit?.bathrooms ?? 1);
  const [floor, setFloor] = useState(unit ? unit.floor_level : 0);
  const [wing, setWing] = useState(unit?.wing ?? "");
  const [entrance, setEntrance] = useState(unit?.entrance_note ?? "");
  const [description, setDescription] = useState(unit?.description ?? "");
  const [missing, setMissing] = useState<{ type?: string; name?: string }>({});
  const editable = unit ? unit.verification.editable : true;

  const chosen = options.find((option) => option.value === spaceType) ?? null;
  const asks = chosen?.asks ?? unit?.asks;
  const tiles = options.map((option) => ({
    value: option.value,
    label: option.label,
    icon: SPACE_GLYPHS[option.value] ?? "units",
  }));
  if (unit && !chosen) {
    tiles.push({ value: unit.space_type, label: unit.space_type_label, icon: SPACE_GLYPHS[unit.space_type] ?? "units" });
  }

  useCommit(commitRef, async () => {
    if (!editable) return true;
    const problems = {
      type: spaceType ? undefined : "Choose what is being let.",
      name: label.trim() ? undefined : "Give it a name, e.g. Flat A or Room 3.",
    };
    setMissing(problems);
    if (problems.type || problems.name) return false;
    const fields = {
      label: label.trim(),
      description: description.trim(),
      bedrooms: asks?.bedrooms === false ? 0 : bedrooms,
      bathrooms: asks?.bathrooms === "none" ? 0 : bathrooms,
      floor_level: asks?.floor === false ? null : floor,
      wing: wing.trim(),
      entrance_note: entrance.trim(),
    };
    onSaved(unit
      ? await updateUnit(unit.id, fields)
      : await createUnit(property.id, { ...fields, space_type: spaceType }));
    return true;
  });

  return (
    <div className="cw-form">
      {tiles.length ? (
        <ChoiceTiles
          label="What is being let?"
          value={spaceType}
          columns={Math.min(tiles.length, 4)}
          disabled={Boolean(unit)}
          onChange={(value) => {
            setSpaceType(value);
            setMissing((current) => ({ ...current, type: undefined }));
          }}
          options={tiles}
        />
      ) : (
        <Notice tone="error" inline title="This Property has no available Unit types." />
      )}
      {missing.type ? <p className="cw-missing" role="alert">{missing.type}</p> : null}

      <FormSection title="Identify the unit">
        <div className="lw-grid">
          <Field
            label="Name"
            required
            placeholder="e.g. Flat A, Room 3"
            maxLength={40}
            value={label}
            autoFocus
            disabled={!editable}
            error={missing.name}
            onBlur={() => { if (!label.trim()) setMissing((current) => ({ ...current, name: "Give it a name, e.g. Flat A or Room 3." })); }}
            onChange={(event) => {
              setLabel(event.target.value);
              setMissing((current) => ({ ...current, name: undefined }));
            }}
          />
          <Field
            label="Block or wing"
            placeholder="e.g. Block B"
            maxLength={40}
            value={wing}
            disabled={!editable}
            onChange={(event) => setWing(event.target.value)}
          />
        </div>

      </FormSection>

      <FormSection title="Layout and access">
        {asks && (asks.bedrooms || asks.bathrooms !== "none" || asks.floor) ? (
          <div className="count-row">
            {asks.bedrooms ? <CountStepper label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={1} disabled={!editable} /> : null}
            {asks.bathrooms === "count" ? (
              <CountStepper label="Bathrooms" value={bathrooms} onChange={setBathrooms} disabled={!editable} />
            ) : asks.bathrooms === "yes_no" ? (
              <YesNo label="Own bathroom" value={bathrooms > 0} onChange={(yes) => setBathrooms(yes ? 1 : 0)} disabled={!editable} />
            ) : null}
            {asks.floor ? (
              <CountStepper
                label="Floor"
                value={floor}
                onChange={setFloor}
                disabled={!editable}
                max={60}
                format={(value) => (value === 0 ? "Ground" : String(value))}
              />
            ) : null}
          </div>
        ) : null}

        <Field
          label="How to find its door"
          hint="Shared only after a confirmed viewing."
          placeholder="e.g. Blue door, top of the outside stairs"
          maxLength={200}
          value={entrance}
          disabled={!editable}
          onChange={(event) => setEntrance(event.target.value)}
        />

          <Textarea
            label="Description"
            rows={3}
            maxLength={1500}
            value={description}
            disabled={!editable}
            onChange={(event) => setDescription(event.target.value)}
          />
      </FormSection>
    </div>
  );
}

function AmenitiesStep({ unitId, commitRef }: { unitId: string; commitRef: CommitRef }) {
  const save = useRef<Commit | null>(null);
  useCommit(commitRef, async () => (save.current ? save.current() : true));
  return (
    <div className="cw-form">
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
        null
      ) : waitingOnProperty ? (
        <p className="cw-missing">{permitted?.message || "The property is checked first. The Unit waits privately until then."}</p>
      ) : outstanding ? (
        <p className="cw-missing">Add the missing photo{outstanding === 1 ? "" : "s"} to send it for checking.</p>
      ) : null}
    </div>
  );
}
