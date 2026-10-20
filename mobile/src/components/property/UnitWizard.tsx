/**
 * Adding a Unit on a phone, in one modal (owner, 2026-10-20).
 *
 * The Unit → amenities → photos → review, in the same frame as creating a
 * property and the same order as the web wizard. The Unit is written when its
 * details are saved, because amenities and photographs need something to attach
 * to; every later step writes to that record, so a phone backgrounded mid-way
 * loses only the step on screen.
 *
 * Review ends in **Send for checking** when the photographs are in and the
 * property's own check allows it, and otherwise in **Finish**: a Unit can wait
 * privately, and the review says plainly what it is waiting on.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import { ChoiceTiles, ReviewLine, ReviewList, WizardFrame, type WizardStep } from "@/components/creation/WizardFrame";
import { CountStepper, YesNo } from "@/components/form/CountStepper";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import { Footnote, LATERITE, Pill, QuietAct } from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { SPACE_GLYPHS, type Glyph } from "@/creationGlyphs";
import { loadPropertyTypes, spaceTypesFor, type SpaceTypeOption } from "@/propertyTypes";
import { createUnit, getProperty, getUnit, updateUnit, type Property, type UnitDetail } from "@/provider";
import { submitForReview } from "@/verification";

type StepKey = "details" | "amenities" | "photos" | "review";
type Commit = () => Promise<boolean>;
type CommitRef = { current: Commit | null };

const STEPS: { key: StepKey; label: string; hint: string; icon: Glyph }[] = [
  { key: "details", label: "The Unit", hint: "What it is, what it is called, and its rooms.", icon: "key-outline" },
  { key: "amenities", label: "Amenities", hint: "What this Unit has of its own.", icon: "sparkles-outline" },
  { key: "photos", label: "Photos", hint: "The main view, then one of each amenity.", icon: "images-outline" },
  { key: "review", label: "Review", hint: "Check it over, then send it for checking.", icon: "eye-outline" },
];

export function UnitWizard({
  propertyId,
  unitId: initialUnit = null,
  startAt = null,
  onClose,
  onFinished,
}: {
  propertyId: string;
  /** A Unit already saved, to carry on with. */
  unitId?: string | null;
  startAt?: string | null;
  onClose: () => void;
  onFinished: (unit: UnitDetail) => void;
}) {
  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [step, setStep] = useState<StepKey>("details");
  const [visited, setVisited] = useState<Set<StepKey>>(new Set());
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
        setStep(STEPS.find((row) => row.key === startAt)?.key ?? "amenities");
      })
      .catch((cause) => setError(cause instanceof ApiFailure ? cause.error.message : "Could not reopen this Unit."));
  }, [initialUnit, propertyId, startAt]);

  const reload = useCallback(async () => {
    const current = unit ?? created.current;
    if (!current) return null;
    const next = await getUnit(current.id);
    setUnit(next);
    return next;
  }, [unit]);

  const at = STEPS.findIndex((row) => row.key === step);
  const ready = unit
    ? unit.verification.can_submit && unit.permitted_actions.submit_for_verification?.allowed !== false
    : false;
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
      setVisited((current) => new Set(current).add(step));
      const next = await reload();
      if (step === "review") {
        const current = next ?? unit;
        if (!current) return;
        if (ready && !sent) {
          await submitForReview("unit", current.id);
          onFinished(await getUnit(current.id));
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
      <View style={styles.loading}>
        {error ? <Notice tone="error" title={error} /> : <Bone height={22} />}
      </View>
    );
  }

  const strip: WizardStep[] = STEPS.map((row) => ({
    ...row,
    done:
      row.key === "details" ? Boolean(unit)
        : row.key === "amenities" ? Boolean(unit) && (visited.has("amenities") || unit!.amenities.length > 0)
          : row.key === "photos" ? Boolean(unit) && unit!.verification.required_outstanding === 0
            : false,
    reachable: !busy && (row.key === "details" || Boolean(unit)),
  }));

  const primary =
    step === "review"
      ? ready && !sent ? "Send for checking" : "Finish"
      : step === "details" && !unit ? "Save and continue" : "Continue";

  return (
    <WizardFrame
      steps={strip}
      current={step}
      onGo={(key) => go(key as StepKey)}
      footer={
        <>
          {at > 0 ? (
            <QuietAct label="Back" icon="chevron-back" disabled={busy} onPress={() => go(STEPS[at - 1]!.key)} />
          ) : (
            <QuietAct label="Cancel" disabled={busy} onPress={onClose} />
          )}
          <Pill
            label={primary}
            icon={step === "review" ? (ready && !sent ? "shield-checkmark-outline" : "checkmark") : "arrow-forward"}
            busy={busy}
            busyLabel={step === "review" && ready ? "Sending" : "Saving"}
            grow
            onPress={() => void advance()}
          />
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
    </WizardFrame>
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
    <>
      {options.length ? (
        <ChoiceTiles
          label="What is being let?"
          value={spaceType}
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
            hint: option.accepts_bed_spaces ? "Beds can be let separately" : undefined,
            icon: SPACE_GLYPHS[option.value] ?? "key-outline",
          }))}
        />
      ) : (
        <Bone height={64} />
      )}
      {missing.type ? <Type variant="caption" style={styles.missing}>{missing.type}</Type> : null}

      <View style={styles.group}>
        <Field
          label="Name"
          placeholder="e.g. Flat A, Room 3"
          maxLength={40}
          value={label}
          editable={editable}
          error={missing.name}
          onChangeText={(next) => {
            setLabel(next);
            setMissing((current) => ({ ...current, name: undefined }));
          }}
        />
        {asks && (asks.bedrooms || asks.bathrooms !== "none" || asks.floor) ? (
          <View style={styles.counts}>
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
          </View>
        ) : null}
        <Field
          label="Block or wing (optional)"
          placeholder="e.g. Block B"
          maxLength={40}
          value={wing}
          editable={editable}
          onChangeText={setWing}
        />
        <Field
          label="How to find its door (optional)"
          placeholder="e.g. Blue door, top of the stairs"
          maxLength={200}
          value={entrance}
          editable={editable}
          onChangeText={setEntrance}
        />
        <Footnote>Shared only after a confirmed viewing.</Footnote>
        <Field
          label="Description (optional)"
          value={description}
          maxLength={1500}
          editable={editable}
          onChangeText={setDescription}
          multiline
        />
      </View>

      {chosen?.accepts_bed_spaces ? <Footnote>Let it whole, or add its beds once it is saved.</Footnote> : null}
    </>
  );
}

function AmenitiesStep({ unitId, commitRef }: { unitId: string; commitRef: CommitRef }) {
  const saveRef = useRef<Commit | null>(null);
  useCommit(commitRef, async () => (saveRef.current ? saveRef.current() : true));
  return (
    <>
      <Footnote>Each one you choose is photographed next.</Footnote>
      <SpaceAmenities scope="unit" id={unitId} submitRef={saveRef} />
    </>
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
  const waitingOnProperty = Boolean(
    permitted && !permitted.allowed && permitted.blockers.some((row) => row.kind.startsWith("verification_")),
  );
  const rooms = [
    unit.bedrooms ? `${unit.bedrooms} bedroom${unit.bedrooms === 1 ? "" : "s"}` : "",
    unit.bathrooms ? `${unit.bathrooms} bathroom${unit.bathrooms === 1 ? "" : "s"}` : "",
    unit.floor_level !== null ? (unit.floor_level === 0 ? "Ground floor" : `Floor ${unit.floor_level}`) : "",
  ].filter(Boolean);
  const outstanding = unit.verification.required_outstanding;

  return (
    <>
      <ReviewList>
        <ReviewLine
          first
          icon={SPACE_GLYPHS[unit.space_type] ?? "key-outline"}
          term={unit.label || "Not named"}
          value={[unit.space_type_label, ...rooms].join(" · ")}
          onEdit={() => onGo("details")}
        />
        {unit.wing ? <ReviewLine icon="location-outline" term="Block or wing" value={unit.wing} onEdit={() => onGo("details")} /> : null}
        <ReviewLine
          icon="sparkles-outline"
          term="Amenities"
          value={unit.amenities.length ? unit.amenities.map((row) => row.name).join(", ") : "None of its own"}
          onEdit={() => onGo("amenities")}
        />
        <ReviewLine
          icon="images-outline"
          term="Photos"
          todo={outstanding > 0}
          value={outstanding ? `${outstanding} still needed` : `${unit.photo_count} added`}
          onEdit={() => onGo("photos")}
        />
      </ReviewList>

      {sent ? (
        <Footnote>{unit.verification.state_label}</Footnote>
      ) : ready ? (
        <Footnote>We compare the photos with these details. Nobody can request it until it passes.</Footnote>
      ) : waitingOnProperty ? (
        <Type variant="caption" style={styles.missing}>
          {permitted?.message || "The property is checked first. The Unit waits privately until then."}
        </Type>
      ) : outstanding ? (
        <Type variant="caption" style={styles.missing}>
          {`Add the missing photo${outstanding === 1 ? "" : "s"} to send it for checking.`}
        </Type>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  loading: { padding: space[4], gap: space[3] },
  group: { gap: space[3] },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  missing: { color: LATERITE, fontWeight: "500" },
});
