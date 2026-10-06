/**
 * Adding a rentable space on a phone, as a guided workflow.
 *
 * Details → Amenities → Photos → Review → Send for checking.
 *
 * The steps are real, not decorative: the space has to exist before amenities
 * can attach to it and before a photograph has anywhere to go. It is created at
 * the end of step one and every later step writes to a real record, so leaving
 * the app — which on a phone happens constantly — loses nothing.
 *
 * This is the screen most likely to be used standing in the room being let, so
 * one decision per screenful, and the photo step is a camera roll away rather
 * than buried in a form.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  ActionBar,
  Fact,
  Footnote,
  GroupLabel,
  INK,
  KOLA,
  Pill,
  QuietAct,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { CountStepper, YesNo } from "@/components/form/CountStepper";
import { Select } from "@/components/form/Select";
import { Field, Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import {
  CheckpointJourney,
  type CreationCheckpoint,
} from "@/components/creation/CheckpointJourney";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import { loadPropertyTypes, spaceTypesFor, type SpaceTypeOption } from "@/propertyTypes";
import {
  createUnit,
  getProperty,
  getUnit,
  listBuildings,
  type Building,
  type Property,
  type UnitDetail,
} from "@/provider";
import { submitForReview } from "@/verification";

const STEPS = ["Details", "Amenities", "Photos", "Review"] as const;
type Step = (typeof STEPS)[number];

export default function NewSpaceScreen() {
  // Android draws edge-to-edge, so the last control sits under the navigation
  // buttons unless the scroll clears them — and they then look as though the
  // page were showing through.
  const pageBottom = useSafeBottom(space[8]);
  const { propertyId, unitId: resumeUnitId, step: requestedStep } = useLocalSearchParams<{
    propertyId: string;
    unitId?: string;
    step?: string;
  }>();
  const router = useRouter();

  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [step, setStep] = useState<Step>("Details");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId)
      .then(setProperty)
      .catch((cause) =>
        setError(
          cause instanceof ApiFailure ? cause.error.message : "Could not load this property.",
        ),
      );
  }, [propertyId]);

  useEffect(() => {
    if (!resumeUnitId || !propertyId) return;
    getUnit(resumeUnitId)
      .then((saved) => {
        if (saved.property.id !== propertyId) {
          setError("That saved Unit belongs to another Property.");
          return;
        }
        setUnit(saved);
        setStep(
          requestedStep === "review" ? "Review" : requestedStep === "photos" ? "Photos" : "Amenities",
        );
      })
      .catch((cause) =>
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not reopen this Unit."),
      );
  }, [propertyId, requestedStep, resumeUnitId]);

  const reload = useCallback(async () => {
    if (!unit) return;
    setUnit(await getUnit(unit.id));
  }, [unit]);

  if (!property) {
    return (
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} /> : <Bone height={22} />}
      </View>
    );
  }

  const keep = () => router.replace({ pathname: "/(app)/space", params: { unitId: unit!.id } });

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <Type variant="label" style={styles.eyebrow}>{property.title.toUpperCase()}</Type>
        <Type variant="title2" accessibilityRole="header" style={styles.title}>Add a Unit</Type>
      </View>

      {/* Steps already reached are the way back. Ahead is not offered: each
          step writes to the record the one before it created. */}
      <Progress
        current={step}
        reached={unit ? STEPS.indexOf(step) : 0}
        onGoTo={(key) => {
          const next = STEPS.find((name) => name.toLowerCase() === key);
          if (next && (next === "Details" || unit)) setStep(next);
        }}
      />

      {step === "Details" ? (
        <DetailsStep
          property={property}
          onDone={(created) => {
            setUnit(created);
            setStep("Amenities");
          }}
          onSaved={(created) =>
            router.replace({ pathname: "/(app)/space", params: { unitId: created.id } })
          }
        />
      ) : null}

      {step === "Amenities" && unit ? (
        <View style={styles.step}>
          <GroupLabel>Amenities</GroupLabel>
          <Footnote>Only this Unit’s own.</Footnote>
          {/* One button and two quiet links; continuing with nothing ticked is the skip. */}
          <SpaceAmenities
            scope="unit"
            id={unit.id}
            saveLabel="Continue"
            onSaved={() => setStep("Photos")}
            saveForLaterLabel="Save for later"
            onSavedForLater={keep}
          />
          <View style={styles.quiet}>
            <QuietAct label="Back" icon="chevron-back" onPress={() => setStep("Details")} />
          </View>
        </View>
      ) : null}

      {step === "Photos" && unit ? (
        <View style={styles.step}>
          <GroupLabel>Photos</GroupLabel>
          <Footnote>Main view, plus one per amenity.</Footnote>
          <SpacePhotos unitId={unit.id} editable onChanged={reload} />
          <ActionBar>
            <Pill label="Continue" icon="arrow-forward" grow onPress={() => setStep("Review")} />
            <QuietAct label="Save for later" onPress={keep} />
          </ActionBar>
          <View style={styles.quiet}>
            <QuietAct label="Back" icon="chevron-back" onPress={() => setStep("Amenities")} />
          </View>
        </View>
      ) : null}

      {step === "Review" && unit ? (
        <ReviewStep
          unit={unit}
          onBack={() => setStep("Photos")}
          onReload={reload}
          onDone={keep}
        />
      ) : null}
    </ScrollView>
  );
}

// --- step one -----------------------------------------------------------------

function DetailsStep({
  property,
  onDone,
  onSaved,
}: {
  property: Property;
  onDone: (unit: UnitDetail) => void;
  onSaved: (unit: UnitDetail) => void;
}) {
  const [label, setLabel] = useState("");
  const [spaceType, setSpaceType] = useState("");
  const [description, setDescription] = useState("");
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [floor, setFloor] = useState(0);
  const [entrance, setEntrance] = useState("");
  const [buildingId, setBuildingId] = useState("");
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
        // Preselected only when there is nothing to decide.
        if (allowed.length === 1) setSpaceType(allowed[0]!.value);
      })
      .catch(() => setOptions([]));
    void listBuildings(property.id).then(setBuildings).catch(() => setBuildings([]));
  }, [property.id, property.property_type]);

  const chosen = options.find((option) => option.value === spaceType) ?? null;
  // Only what fits this kind of space (owner, 2026-10-05): a shop is asked
  // whether it has a bathroom, never bedrooms; a bed space is asked neither.
  const asks = chosen?.asks ?? null;

  async function submit(saveForLater = false) {
    // Each gap is named at its own field, not left as a disabled button.
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
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not save: check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const counts = asks ? asks.bedrooms || asks.bathrooms !== "none" || asks.floor : false;

  return (
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>The Unit</GroupLabel>
        <Select
          label="Unit type"
          placeholder="Choose one"
          value={spaceType}
          error={missing.type}
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            detail: option.accepts_bed_spaces ? "Beds can be let separately" : undefined,
          }))}
          onChange={(next) => {
            setSpaceType(next);
            setMissing((current) => ({ ...current, type: undefined }));
          }}
        />
        <Field
          label="Name"
          placeholder="e.g. Flat A, Room 3"
          value={label}
          maxLength={60}
          error={missing.name}
          onChangeText={(next) => {
            setLabel(next);
            setMissing((current) => ({ ...current, name: undefined }));
          }}
        />
        {/* Only what fits the type: a shop has no bedrooms, a bed no bathroom,
            a house no floor. Small steppers, side by side. */}
        {counts && asks ? (
          <View style={styles.pair}>
            {asks.bedrooms ? (
              <CountStepper label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={1} />
            ) : null}
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
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          multiline
        />
      </View>

      <View style={styles.section}>
        <GroupLabel>Finding it</GroupLabel>
        {buildings.length ? (
          <Select
            label="Block"
            placeholder="Not in a named block"
            value={buildingId}
            options={buildings.map((row) => ({ value: row.id, label: row.name, detail: row.code || undefined }))}
            onChange={setBuildingId}
          />
        ) : null}
        <Field
          label="Entrance directions (optional)"
          placeholder="e.g. Blue door, top of the stairs"
          value={entrance}
          onChangeText={setEntrance}
        />
        <Footnote>Shared after a confirmed viewing.</Footnote>
      </View>

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

      <ActionBar>
        <Pill
          label="Save and continue"
          icon="arrow-forward"
          busy={busy}
          busyLabel="Saving"
          grow
          onPress={() => void submit(false)}
        />
        <QuietAct label="Save for later" disabled={busy} onPress={() => void submit(true)} />
      </ActionBar>
    </View>
  );
}

// --- last step ----------------------------------------------------------------

function ReviewStep({
  unit,
  onBack,
  onDone,
  onReload,
}: {
  unit: UnitDetail;
  onBack: () => void;
  onDone: () => void;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Whether the space's own evidence is complete, and whether anything above it
  // is still outstanding, are two different answers. Reporting only the first
  // sends somebody to add a photograph when the wait is the property review.
  const permitted = unit.permitted_actions.submit_for_verification;
  const waitingOnProperty = Boolean(
    permitted &&
      !permitted.allowed &&
      permitted.blockers.some((blocker) => blocker.kind.startsWith("verification_")),
  );
  const ready = unit.verification.can_submit && permitted?.allowed !== false;

  return (
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>Send it for checking</GroupLabel>
        <RecordPanel>
          <Fact first label="Type" value={unit.space_type_label} />
          <Fact label="Name" value={unit.label || "Not named"} />
          <Fact
            wide
            label="Amenities"
            value={unit.amenities.length ? unit.amenities.map((row) => row.name).join(" · ") : "None recorded"}
          />
          <Fact
            label="Photos"
            value={`${unit.photo_count} of ${unit.verification.required_total + 2}`}
            tone={ready ? "good" : "waiting"}
          />
        </RecordPanel>
      </View>

      {ready ? (
        <Footnote>We compare the photos with your details.</Footnote>
      ) : waitingOnProperty ? (
        <Notice
          tone="info"
          title="The Property is checked first"
          body={permitted?.message ?? "This Unit can be sent once the Property's documents and photographs are approved."}
        />
      ) : (
        <Notice
          tone="warning"
          title={`${unit.verification.required_outstanding} photo still needed`}
          body="Go back and add the main interior view."
        />
      )}

      {error ? <Notice tone="error" title={error} /> : null}

      <ActionBar>
        <Pill
          label="Send for checking"
          icon="shield-checkmark-outline"
          busy={busy}
          busyLabel="Sending"
          disabled={!ready}
          grow
          onPress={async () => {
            setBusy(true);
            setError("");
            try {
              await submitForReview("unit", unit.id);
              await onReload();
              onDone();
            } catch (cause) {
              // The refusal names what is outstanding, so it is shown as-is.
              setError(
                cause instanceof ApiFailure ? cause.error.message : "Could not send this yet.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
        <QuietAct label="Save for later" disabled={busy} onPress={onDone} />
      </ActionBar>
      <View style={styles.quiet}>
        <QuietAct label="Back" icon="chevron-back" disabled={busy} onPress={onBack} />
      </View>
    </View>
  );
}

// --- small pieces -------------------------------------------------------------

function Progress({
  current,
  reached,
  onGoTo,
}: {
  current: Step;
  reached: number;
  onGoTo: (key: string) => void;
}) {
  const checkpoints: CreationCheckpoint[] = STEPS.map((step, index) => ({
    key: step.toLowerCase(),
    label: step,
    icon: {
      Details: "details",
      Amenities: "amenities",
      Photos: "photos",
      Review: "review",
    }[step] as CreationCheckpoint["icon"],
    state: step === current ? "current" : index < reached ? "completed" : "upcoming",
  }));
  return (
    <CheckpointJourney
      checkpoints={checkpoints}
      label="BUILDING UNIT"
      accessibilityLabel="Unit creation checkpoints"
      onGoTo={onGoTo}
    />
  );
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[4],
  },
  head: {
    gap: space[1],
    paddingHorizontal: 2,
  },
  eyebrow: {
    color: KOLA,
  },
  title: {
    fontSize: 19,
    lineHeight: 25,
    color: INK,
  },
  step: {
    gap: space[4],
  },
  section: {
    gap: space[3],
  },
  /** Two short answers side by side rather than two full-width boxes. */
  pair: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  quiet: {
    alignItems: "flex-start",
    paddingHorizontal: 2,
  },
});
