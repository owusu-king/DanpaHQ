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
          <GroupLabel>What this Unit has</GroupLabel>
          <Footnote>Anything the whole compound shares is recorded once on the Property.</Footnote>
          <SpaceAmenities
            scope="unit"
            id={unit.id}
            saveLabel="Save and continue"
            onSaved={() => setStep("Photos")}
            saveForLaterLabel="Save for later"
            onSavedForLater={keep}
          />
          <View style={styles.quiet}>
            <QuietAct label="Skip for now" onPress={() => setStep("Photos")} />
          </View>
        </View>
      ) : null}

      {step === "Photos" && unit ? (
        <View style={styles.step}>
          <GroupLabel>Show the Unit</GroupLabel>
          <Footnote>The main view, then one clear photo of each amenity. These are what a tenant sees.</Footnote>
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
  const [bedrooms, setBedrooms] = useState("1");
  const [bathrooms, setBathrooms] = useState("1");
  const [floor, setFloor] = useState("");
  const [wing, setWing] = useState("");
  const [entrance, setEntrance] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [options, setOptions] = useState<SpaceTypeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
  // Land has nothing to count, and asking invites a record claiming a plot has
  // two bathrooms.
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
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>What is let here</GroupLabel>
        <Select
          label="Kind of space"
          placeholder="Choose what is let"
          value={spaceType}
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            detail: option.accepts_bed_spaces ? "Beds can be let separately" : undefined,
          }))}
          onChange={setSpaceType}
        />
        <Field label="Name" placeholder="Flat A, Room 3, Ground floor shop" value={label} onChangeText={setLabel} />
        {countsApply ? (
          <View style={styles.pair}>
            <View style={styles.half}>
              <Field label="Bedrooms" placeholder="0 for a single room" value={bedrooms} onChangeText={setBedrooms} keyboardType="number-pad" />
            </View>
            <View style={styles.half}>
              <Field label="Bathrooms" placeholder="1" value={bathrooms} onChangeText={setBathrooms} keyboardType="number-pad" />
            </View>
          </View>
        ) : null}
        <Field
          label="Describe it"
          placeholder="What a tenant should know before they see it"
          value={description}
          onChangeText={setDescription}
          multiline
        />
      </View>

      <View style={styles.section}>
        <GroupLabel>Where inside the Property</GroupLabel>
        {buildings.length ? (
          <Select
            label="Block"
            placeholder="Anywhere in the Property"
            value={buildingId}
            options={buildings.map((row) => ({ value: row.id, label: row.name, detail: row.code || undefined }))}
            onChange={setBuildingId}
          />
        ) : null}
        <View style={styles.pair}>
          <View style={styles.half}>
            <Field label="Floor" placeholder="0 for ground" value={floor} onChangeText={setFloor} keyboardType="numbers-and-punctuation" />
          </View>
          <View style={styles.half}>
            <Field label="Wing" placeholder="East" value={wing} onChangeText={setWing} />
          </View>
        </View>
        <Field
          label="How to find the door"
          placeholder="Second door past the stairwell"
          value={entrance}
          onChangeText={setEntrance}
        />
        <Footnote>Directions are shared only after a viewing is confirmed, never publicly.</Footnote>
      </View>

      {chosen?.accepts_bed_spaces ? (
        <Notice
          tone="info"
          title="Beds can be let separately"
          body="Save the room first, then add each bed."
        />
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      <ActionBar>
        <Pill
          label="Save and continue"
          icon="arrow-forward"
          busy={busy}
          busyLabel="Saving"
          disabled={!spaceType}
          grow
          onPress={() => void submit(false)}
        />
        <QuietAct label="Save for later" disabled={busy || !spaceType} onPress={() => void submit(true)} />
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
          <Fact first label="Kind" value={unit.space_type_label} />
          <Fact label="Called" value={unit.label || "Not named"} />
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
        <Footnote>It goes to our team with the photos attached. Nothing else waits on this.</Footnote>
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
    gap: space[3],
  },
  half: {
    flex: 1,
    minWidth: 0,
  },
  quiet: {
    alignItems: "flex-start",
    paddingHorizontal: 2,
  },
});
