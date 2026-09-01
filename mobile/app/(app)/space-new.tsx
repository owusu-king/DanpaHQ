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
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Choice, Field, Notice, Surface, Type, space } from "@/components/ui";
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
      <View style={{ padding: space[5] }}>
        {error ? <Notice tone="error" title={error} /> : <Type variant="caption">Loading…</Type>}
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], gap: space[5] }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: space[2] }}>
        <Type variant="display2">Add Unit</Type>
        <Type variant="caption">
          A Unit is the space a tenant actually rents — {property.property_type === "hostel"
            ? "one hostel room or one bed space"
            : "one flat, room, shop or other rentable space"}.
          It sits inside {property.title} and takes its address, its area and its
          checks from it.
        </Type>
      </View>

      <Progress current={step} reached={unit ? STEPS.indexOf(step) : 0} />

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
        <Surface style={{ gap: space[4] }}>
          <StepHeading
            title="What does this Unit have?"
            body="Only what belongs to this Unit. Anything the whole compound shares — a borehole, a guard, parking — is recorded once on the Property."
          />
          <SpaceAmenities
            scope="unit"
            id={unit.id}
            saveLabel="Save and continue"
            onSaved={() => setStep("Photos")}
            saveForLaterLabel="Save for later"
            onSavedForLater={() =>
              router.replace({ pathname: "/(app)/space", params: { unitId: unit.id } })
            }
          />
          <Button label="Skip for now" variant="quiet" onPress={() => setStep("Photos")} />
        </Surface>
      ) : null}

      {step === "Photos" && unit ? (
        <Surface style={{ gap: space[4] }}>
          <StepHeading
            title="Show the Unit"
            body="Add the main view, then one clear photo of every amenity you selected. Two further context views are optional. These are also the photos a tenant sees."
          />
          <SpacePhotos unitId={unit.id} editable onChanged={reload} />
          <Button label="Continue" onPress={() => setStep("Review")} />
          <Button
            label="Save for later"
            variant="secondary"
            onPress={() =>
              router.replace({ pathname: "/(app)/space", params: { unitId: unit.id } })
            }
          />
          <Button label="Back" variant="quiet" onPress={() => setStep("Amenities")} />
        </Surface>
      ) : null}

      {step === "Review" && unit ? (
        <ReviewStep
          unit={unit}
          onBack={() => setStep("Photos")}
          onReload={reload}
          onDone={() =>
            router.replace({ pathname: "/(app)/space", params: { unitId: unit.id } })
          }
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
    <Surface style={{ gap: space[4] }}>
      <StepHeading
        title="What is being let here?"
        body="Only what is true of this Unit. The address, the area and who holds the Property come from the Property itself."
      />

      <Choice
        label="What is let here?"
        hint={
          options.length
            ? "Only what this kind of property can contain is offered."
            : "Loading the options…"
        }
        value={spaceType}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
        onChange={setSpaceType}
      />

      <Field
        label="What do you call it?"
        hint="Flat A, Room 3, Ground floor shop."
        value={label}
        onChangeText={setLabel}
      />

      <Field
        label="Describe it"
        hint="Stays with the space. A tenant using private access never sees a public listing, and this is what they read."
        value={description}
        onChangeText={setDescription}
        multiline
      />

      {countsApply ? (
        <>
          <Field
            label="Bedrooms"
            hint="0 for a single room."
            value={bedrooms}
            onChangeText={setBedrooms}
            keyboardType="number-pad"
          />
          <Field
            label="Bathrooms"
            value={bathrooms}
            onChangeText={setBathrooms}
            keyboardType="number-pad"
          />
        </>
      ) : null}

      <View style={{ gap: space[2] }}>
        <Type variant="label">WHERE INSIDE THE PROPERTY</Type>
        <Type variant="caption">
          Only what differs between two spaces at this address. All optional.
        </Type>
      </View>

      {buildings.length ? (
        <Choice
          label="Building or block"
          value={buildingId}
          options={buildings.map((row) => ({ value: row.id, label: row.name }))}
          onChange={setBuildingId}
        />
      ) : null}

      <Field
        label="Floor"
        hint="0 for ground."
        value={floor}
        onChangeText={setFloor}
        keyboardType="numbers-and-punctuation"
      />
      <Field label="Wing" value={wing} onChangeText={setWing} />
      <Field
        label="How to find the door"
        hint="Shared only after a viewing is confirmed, never on a public page."
        value={entrance}
        onChangeText={setEntrance}
      />

      {chosen?.accepts_bed_spaces ? (
        <Notice
          tone="info"
          title="You can add bed spaces to this room"
          body="Save the room first, then add each bed. A bed can be let on its own, or you can let the whole room."
        />
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label="Save and continue"
        busy={busy}
        disabled={!spaceType}
        onPress={() => void submit(false)}
      />
      <Button
        label="Save for later"
        variant="quiet"
        busy={busy}
        disabled={!spaceType}
        onPress={() => void submit(true)}
      />
    </Surface>
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
    <Surface style={{ gap: space[4] }}>
      <StepHeading
        title="Send it for checking"
        body="Our team looks at the photo against what you have said the space is. Until that passes, private access and advertising stay unavailable."
      />

      <View style={{ gap: space[2] }}>
        <Row term="What is let" value={unit.space_type_label} />
        <Row term="Called" value={unit.label || "Not named"} />
        <Row
          term="Amenities"
          value={
            unit.amenities.length
              ? unit.amenities.map((row) => row.name).join(", ")
              : "None recorded"
          }
        />
        <Row
          term="Photos"
          value={`${unit.photo_count} of ${unit.verification.required_total + 2}`}
        />
      </View>

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
          title={`${unit.verification.required_outstanding} photo still needed`}
          body="Go back a step and add the main interior view. It is the one thing photographs of the building cannot show."
        />
      )}

      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label="Send for checking"
        busy={busy}
        disabled={!ready}
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
      <Button label="Save for later" variant="secondary" onPress={onDone} />
      <Button label="Back" variant="quiet" onPress={onBack} />
    </Surface>
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
      Review: "review",
    }[step] as CreationCheckpoint["icon"],
    state: step === current ? "current" : index < reached ? "completed" : "upcoming",
  }));
  return (
    <CheckpointJourney
      checkpoints={checkpoints}
      label="BUILDING UNIT"
      accessibilityLabel="Unit creation checkpoints"
    />
  );
}

function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: space[1] }}>
      <Type variant="title2">{title}</Type>
      <Type variant="caption">{body}</Type>
    </View>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Type variant="label">{term.toUpperCase()}</Type>
      <Type variant="body">{value}</Type>
    </View>
  );
}
