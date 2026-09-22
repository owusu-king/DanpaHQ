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

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import { AuthorityClaim } from "@/components/property/AuthorityClaim";
import { SetupProgress } from "@/components/property/SetupSteps";
import { PropertySummary } from "@/components/property/PropertySummary";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { VerificationPanel } from "@/components/property/VerificationPanel";
import {
  ActionBar,
  Fact,
  Footnote,
  GroupLabel,
  INK,
  KOLA,
  LinkRow,
  Pill,
  QuietAct,
  RecordPanel,
  StandingLine,
} from "@/components/record/RecordSurfaces";
import { Select } from "@/components/form/Select";
import { Field, Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
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
  // Android draws edge-to-edge, so the last control sits under the navigation
  // buttons unless the scroll clears them — and they then look as though the
  // page were showing through.
  const pageBottom = useSafeBottom(space[8]);
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
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} /> : <Bone height={22} />}
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
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <Type variant="label" style={styles.eyebrow}>
          {settled ? "PROPERTY" : "PROPERTY SETUP"}
        </Type>
        <Type variant="title2" accessibilityRole="header" style={styles.title}>
          {property.title || "Untitled property"}
        </Type>
        <StandingLine
          tone={readyToFinish && !settled ? "good" : "quiet"}
          line={settled
            ? "Change what is still yours to change"
            : readyToFinish
              ? "Ready to finish"
              : "Everything saves as you go"}
        />
      </View>

      {/* The journey is the way back, and the way ahead: these steps may be
          done in any order, so every checkpoint but the current one opens. */}
      <SetupProgress steps={steps} current={step} onGoTo={(key) => setStep(key as StepKey)} />

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

      <View style={styles.quiet}>
        <QuietAct
          label="Save and finish later"
          onPress={() =>
            router.replace({
              pathname: "/(app)/provider-property",
              params: { propertyId: property.id },
            })
          }
        />
      </View>
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
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>The property</GroupLabel>
        <Field label="Name" placeholder="Adom Heights" value={title} onChangeText={setTitle} />
        <RecordPanel>
          <Fact first label="Kind" value={property.property_type.replace(/_/g, " ")} />
          <Fact label="Where" value={`${property.address.locality_name}, ${property.address.district_name}`} />
        </RecordPanel>
        <Footnote>A property is one address, so this one cannot move.</Footnote>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      <ActionBar>
        <Pill
          label="Save name"
          icon="checkmark"
          busy={busy}
          busyLabel="Saving"
          disabled={!title.trim() || title === property.title}
          grow
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
      </ActionBar>
    </View>
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
    return <View style={styles.step}><Bone height={20} /><Bone height={44} /><Bone height={44} /></View>;
  }

  return (
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>Services</GroupLabel>
        {/* Three questions of five or six options each. As wrapping chips that
            was a screenful of loose words with no shape; as fields it reads as
            a form, and each answer has room for its own name. */}
        <Select label="Water" value={water} options={vocabulary.water_sources} onChange={setWater} />
        <Select label="Electricity" value={power} options={vocabulary.power_meter_types} onChange={setPower} />
        <Select label="Compound" value={compound} options={vocabulary.compound_types} onChange={setCompound} />
      </View>

      {missing ? (
        <Footnote>Left unknown, the photo checklist guesses — and guesses short.</Footnote>
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}

      <ActionBar>
        <Pill
        label="Save and continue"
        icon="arrow-forward"
        busy={busy}
        busyLabel="Saving"
        disabled={missing}
        grow
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
      </ActionBar>
    </View>
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
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>What shows it is yours to let</GroupLabel>
        {document === "verified" ? (
          <RecordPanel><Fact first label="Claim" value="Confirmed as yours to let" tone="good" /></RecordPanel>
        ) : withTeam ? (
          <RecordPanel><Fact first label="Claim" value="With our team" tone="waiting" /></RecordPanel>
        ) : recorded ? (
          <RecordPanel><Fact first label="Claim" value="Saved, not yet seen" tone="quiet" /></RecordPanel>
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
      </View>

      {/* The claim carries the step's one act — saving the document — so
          moving on is a quiet word. Two pinned bars in one scroll is two
          things asking to be pressed. */}
      {recorded ? (
        <View style={styles.quiet}>
          <QuietAct label="Continue" icon="arrow-forward" onPress={onDone} />
        </View>
      ) : null}
    </View>
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
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>Photos of the building</GroupLabel>
        {/* `showSubmit={false}`: the send lives at Review, with the document,
            because somebody standing in front of a building has both in one trip. */}
        <VerificationPanel
          subject="property"
          id={propertyId}
          title="This property"
          showSubmit={false}
          onState={() => void onChanged()}
        />
        {progress && progress.required_outstanding > 0 ? (
          <Footnote>{progress.required_outstanding} still needed before this can be sent.</Footnote>
        ) : null}
      </View>

      <ActionBar>
        <Pill label="Continue" icon="arrow-forward" grow onPress={onDone} />
      </ActionBar>
    </View>
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
    <View style={styles.step}>
      <View style={styles.section}>
        <GroupLabel>What the compound has</GroupLabel>
        <Footnote>Shared by everything inside. What one flat has of its own goes on that Unit.</Footnote>
        <SpaceAmenities
          scope="property"
          id={propertyId}
          saveLabel="Confirm and continue"
          onSaved={async () => {
            await onChanged();
            onDone();
          }}
        />
      </View>
    </View>
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
    <View style={styles.step}>
      {/* Said once, here, where the button is: creating a property is not
          asking anybody to look at it. */}
      <Footnote>Nothing here has been sent to anybody.</Footnote>

      {/* The property, as a property. This listed step names against their
          status — the last thing somebody saw before creating a building they
          had just photographed was a progress table. */}
      <PropertySummary property={property} onEdit={onGoTo} />

      {/* Only what is still owed, and only when something is. Six rows saying
          "Done" is not a review; it is the checklist again. */}
      {settled ? null : outstanding.length ? (
        <View style={styles.section}>
          <GroupLabel>Still to finish</GroupLabel>
          <RecordPanel>
            {outstanding.map((row, index) => (
              <LinkRow
                key={row.key}
                first={index === 0}
                tone="action"
                icon="ellipse-outline"
                label={row.title}
                detail={row.detail || undefined}
                onPress={() => onGoTo(row.key)}
              />
            ))}
          </RecordPanel>
        </View>
      ) : (
        <Footnote>It stays private until you send it for verification, from the property itself.</Footnote>
      )}

      <ActionBar>
        <Pill
          label={settled ? "Done" : "Create property"}
          icon={settled ? "checkmark" : "business-outline"}
          disabled={!ready && !settled}
          grow
          onPress={onFinished}
        />
      </ActionBar>
    </View>
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
  quiet: {
    alignItems: "flex-start",
    paddingHorizontal: 2,
  },
});
