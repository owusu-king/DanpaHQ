/**
 * Creating a property, on a phone.
 *
 * Details → Documents → Photos → Amenities → Review → **Create property**. The
 * same five steps the web walks, derived from the same server fields by
 * `propertySetup.ts`, so a provider who starts on their phone and finishes on a
 * laptop sees the same state in both places.
 *
 * **The last step creates; it sends nothing.** Whether to ask for verification
 * is a separate decision, made afterwards from the property — see
 * `property-verify`. This flow used to end by submitting, and had in fact
 * already submitted: the Documents step filed the claim for review, so the last
 * button read "Send the photographs".
 *
 * ### What differs from the web, and why
 *
 * The web has room for a full navigable step list. Mobile keeps only the compact
 * checkpoint journey so the active task begins near the top of the screen.
 *
 * Nothing is held in this component that leaving would lose: the details are a
 * PATCH, the document is a draft claim, the photographs attach to an open review
 * as they are taken, the amenities are a PUT. On a phone that is not a nicety —
 * the app is backgrounded constantly.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { AuthorityClaim } from "@/components/property/AuthorityClaim";
import { SetupProgress } from "@/components/property/SetupSteps";
import { PropertySummary } from "@/components/property/PropertySummary";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { VerificationPanel } from "@/components/property/VerificationPanel";
import { Button, Choice, Field, Notice, Surface, Type, radius, space } from "@/components/ui";
import { isAndroid } from "@/platform";
import { theme } from "@/theme";
import {
  describePropertySetup,
  isSetupComplete,
  resumeAt,
  toSetupInput,
  type SetupStep,
} from "@/propertySetup";
import { loadPropertyVocabulary, type PropertyVocabulary } from "@/propertyTypes";
import {
  getProperty,
  getPropertyAmenities,
  updateProperty,
  type Property,
  type SpaceAmenity,
} from "@/provider";
import { getVerification, type VerificationProgress } from "@/verification";

const STEP_KEYS = ["basics", "details", "documents", "photos", "amenities", "review"] as const;
type StepKey = (typeof STEP_KEYS)[number];

export default function PropertySetupScreen() {
  const { propertyId, step: requested } = useLocalSearchParams<{
    propertyId: string;
    // Where the property screen sends somebody who pressed a specific
    // action — "Submit for verification" lands on Review rather than
    // wherever the resume rule would otherwise put them.
    step?: string;
  }>();
  const router = useRouter();

  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [vocabulary, setVocabulary] = useState<PropertyVocabulary | null>(null);
  const [step, setStep] = useState<StepKey>("details");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!propertyId) return;
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
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this property.",
      );
    }
  }, [propertyId]);

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

  // Open on the first thing outstanding. Somebody returning to a half-finished
  // property is coming back *to* the unfinished part.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !steps.length) return;
    landed.current = true;
    const asked = STEP_KEYS.includes(requested as StepKey) ? (requested as StepKey) : null;
    setStep(asked ?? (resumeAt(steps) as StepKey));
  }, [steps, requested]);

  if (!property || !steps.length) {
    return (
      <View style={{ padding: space[5] }}>
        {error ? <Notice tone="error" title={error} /> : <Type variant="caption">Loading…</Type>}
      </View>
    );
  }

  const readyToFinish = isSetupComplete(steps);
  // Past creation: the property has been decided on, so this screen is an edit
  // rather than a wizard, and it says so.
  const settled = ["changes_requested", "rejected", "expired"].includes(
    property.verification.state,
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], gap: space[5] }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: space[2] }}>
        <Type variant="display2">{property.title || "Untitled property"}</Type>
        <Type variant="caption">
          {settled
            ? "Change what is still yours to change."
            : readyToFinish
              ? "Everything needed is here."
              : "Everything saves as you go. Do them in any order."}
        </Type>
      </View>

      {readyToFinish && !settled ? (
        <Notice
          tone="success"
          title="Ready to finish"
        />
      ) : null}

      <SetupProgress steps={steps} current={step} />

      {error ? <Notice tone="error" title={error} /> : null}

      {step === "basics" ? <BasicsStep property={property} onSaved={load} /> : null}

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
        <DocumentsStep property={property} onChanged={load} onDone={() => setStep("photos")} />
      ) : null}

      {step === "photos" ? (
        <PhotosStep
          propertyId={property.id}
          progress={photos}
          onChanged={load}
          onDone={() => setStep("amenities")}
        />
      ) : null}

      {step === "amenities" ? (
        <AmenitiesStep
          propertyId={property.id}
          onChanged={load}
          onDone={() => setStep("review")}
        />
      ) : null}

      {step === "review" ? (
        <ReviewStep
          property={property}
          steps={steps}
          settled={settled}
          onGoTo={(key) => setStep(key as StepKey)}
          onFinished={() =>
            router.replace({
              pathname: "/(app)/provider-property",
              params: { propertyId: property.id, created: "1" },
            })
          }
        />
      ) : null}

      <Button
        label="Save and finish later"
        variant="quiet"
        onPress={() =>
          router.replace({
            pathname: "/(app)/provider-property",
            params: { propertyId: property.id },
          })
        }
      />
    </ScrollView>
  );
}

// --- 0. the property itself ---------------------------------------------------

/**
 * What it is called, for a property that already exists.
 *
 * `private-property` is this step before the record exists; a provider renaming
 * a property later comes here rather than to a create form. The address is shown
 * and not editable: a property is one address, and moving it would make it a
 * different property from the one any evidence was reviewed about.
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

  return (
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="title2">The property</Type>
      </View>

      <Field label="Property name" value={title} onChangeText={setTitle} />

      <View style={{ gap: space[1] }}>
        <Type variant="caption">Kind</Type>
        <Type variant="body">{property.property_type.replace(/_/g, " ")}</Type>
      </View>

      <View style={{ gap: space[1] }}>
        <Type variant="caption">Where it is</Type>
        <Type variant="body">
          {property.address.locality_name}, {property.address.district_name}
        </Type>
        <Type variant="caption">A property is one address.</Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label="Save name"
        busy={busy}
        disabled={!title.trim() || title === property.title}
        onPress={async () => {
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
      />
    </Surface>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const missing = water === "unknown" || power === "unknown";

  if (!vocabulary) {
    return (
      <Surface style={{ gap: space[3] }}>
        <Type variant="caption">Loading the options…</Type>
      </Surface>
    );
  }

  return (
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="title2">Property details</Type>
      </View>

      <Choice
        label="What's the water source?"
        value={water}
        options={vocabulary.water_sources}
        onChange={setWater}
      />
      <Choice
        label="How is the electricity metered?"
        value={power}
        options={vocabulary.power_meter_types}
        onChange={setPower}
      />
      <Choice
        label="What kind of compound?"
        value={compound}
        options={vocabulary.compound_types}
        onChange={setCompound}
      />

      {missing ? (
        <Notice
          tone="info"
          title="Left unknown, the photo checklist guesses — and guesses short"
        />
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label="Save and continue"
        busy={busy}
        disabled={missing}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            await updateProperty(property.id, {
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
        }}
      />
    </Surface>
  );
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
  // during creation from one never added. Reading it here meant the sidebar
  // ticked Documents while this panel still asked for one.
  const document = property.verification.authority.state;
  const recorded = document !== "draft";
  const withTeam = document === "submitted" || document === "under_review";

  return (
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="title2">Documents</Type>
        <Type variant="caption">What shows this property is yours to let.</Type>
      </View>

      {document === "verified" ? (
        <Notice tone="success" title="Confirmed as yours to let" />
      ) : withTeam ? (
        <Notice
          tone="info"
          title="Your claim is with our team"
        />
      ) : recorded ? (
        <Notice
          tone="success"
          title="Saved. Nobody has seen it yet."
        />
      ) : null}

      {document === "verified" || withTeam ? null : (
        <AuthorityClaim
          propertyId={property.id}
          onSubmitted={async () => {
            await onChanged();
            onDone();
          }}
        />
      )}

      {recorded ? <Button label="Continue" variant="secondary" onPress={onDone} /> : null}
    </Surface>
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
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="title2">Photos of the building</Type>
      </View>

      {/* `showSubmit={false}`: the send lives at Review, with the document,
          because somebody standing in front of a building has both in one trip. */}
      <VerificationPanel
        subject="property"
        id={propertyId}
        title="This property"
        showSubmit={false}
        onState={() => void onChanged()}
      />

      <Button label="Continue" variant="secondary" onPress={onDone} />
      {progress && progress.required_outstanding > 0 ? (
        <Type variant="caption">
          {progress.required_outstanding} still needed before this can be sent.
        </Type>
      ) : null}
    </Surface>
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
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="title2">What the compound has</Type>
        <Type variant="caption">
          Shared by everything inside — what one flat has of its own goes on that space.
        </Type>
      </View>

      <SpaceAmenities
        scope="property"
        id={propertyId}
        saveLabel="Confirm and continue"
        onSaved={async () => {
          await onChanged();
          onDone();
        }}
      />
    </Surface>
  );
}

// --- 5. review ----------------------------------------------------------------

/**
 * The one send.
 *
 * Two reviews underneath — a photograph says nothing about who holds a building
 * — but never two jobs. Whichever halves are still outstanding go together, so a
 * provider who claimed the property last week is not asked to do it again to
 * send today's photographs.
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
  settled: boolean;
  onGoTo: (key: string) => void;
  onFinished: () => void;
}) {
  const outstanding = steps.filter(
    (row) => row.key !== "review" && !row.optional && row.status !== "done",
  );
  const ready = outstanding.length === 0;

  return (
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="title2">Review</Type>
        <Type variant="caption">Nothing here has been sent to anybody.</Type>
      </View>

      {/* The property, as a property. This listed step names against their
          status — the last thing somebody saw before creating a building they
          had just photographed was a progress table. */}
      <PropertySummary property={property} onEdit={onGoTo} />

      {/* Only what is still owed, and only when something is. Six rows saying
          "Done" is not a review; it is the checklist again. */}
      {settled ? null : outstanding.length ? (
        <View style={{ gap: space[2] }}>
          <Type variant="label">STILL TO FINISH</Type>
          {outstanding.map((row) => (
            <Pressable
              key={row.key}
              accessibilityRole="button"
              accessibilityLabel={`Finish ${row.title}`}
              onPress={() => onGoTo(row.key)}
              android_ripple={isAndroid ? { color: theme.color.kola["50"] } : undefined}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space[3],
                minHeight: theme.targetMin,
                paddingHorizontal: space[3],
                borderRadius: radius.sm,
                backgroundColor: theme.color.field["50"],
                opacity: pressed && !isAndroid ? 0.72 : 1,
              })}
            >
              <Type
                variant="bodyStrong"
                style={{ flex: 1, fontSize: 15, color: theme.color.kola["600"] }}
              >
                {row.title}
              </Type>
              {row.detail ? <Type variant="caption">{row.detail}</Type> : null}
              <Ionicons name="chevron-forward" size={16} color={theme.color.kola["600"]} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Type variant="caption">
          It stays private until you send it for verification, from the property itself.
        </Type>
      )}

      <Button
        label={settled ? "Done" : "Create property"}
        disabled={!ready && !settled}
        onPress={onFinished}
      />
    </Surface>
  );
}
