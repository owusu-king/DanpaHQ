/**
 * Creating a property on a phone, in one modal (owner, 2026-10-20).
 *
 * The property → details → documents → amenities → photos → review, in the
 * same order and with the same words as the web wizard: a strip of steps that
 * turn green as they are finished, the step, and one pinned button that does
 * whatever the step needs — create the record, save the answers, keep the
 * document, store the amenities.
 *
 * **Amenities come before Photos** because each shared amenity offers a
 * photograph of itself; only the front and the wider area are required.
 *
 * **The last step creates; it sends nothing.** Asking for verification stays a
 * separate decision made from the property. Everything is written as it is
 * finished, so a phone backgrounded mid-way loses only the step on screen.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Bone } from "@/components/billing/BillingParts";
import { ChoiceTiles, ReviewLine, ReviewList, WizardFrame, type WizardStep } from "@/components/creation/WizardFrame";
import { Select } from "@/components/form/Select";
import { AuthorityClaim } from "@/components/property/AuthorityClaim";
import { SaleDetailsForm } from "@/components/property/SaleDetailsForm";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { VerificationPanel } from "@/components/property/VerificationPanel";
import {
  EDGE,
  Footnote,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PAPER,
  PRESSED,
  Pill,
  QuietAct,
} from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { FACT_GLYPHS, FACT_HINTS, TYPE_GLYPHS, shortFactLabel, type Glyph } from "@/creationGlyphs";
import {
  createPersonalPortfolioProperty,
  createPrivateProperty,
  listOrganizations,
  type Organization,
} from "@/organizations";
import { newPlacesSession, placeLabel, suggestPlaces, type PlaceSuggestion } from "@/places";
import { pressableFeedback } from "@/platform";
import { describePropertySetup, resumeAt, toSetupInput, type SetupStep } from "@/propertySetup";
import { loadPropertyVocabulary, type FeatureOption, type PropertyVocabulary } from "@/propertyTypes";
import {
  createAddress,
  getProperty,
  getPropertyAmenities,
  updateProperty,
  type Property,
  type SpaceAmenity,
} from "@/provider";
import { getSellerSale, type SellerSale } from "@/sales";
import { theme } from "@/theme";
import { getVerification, type VerificationProgress } from "@/verification";

type StepKey = "basics" | "details" | "sale" | "documents" | "amenities" | "photos" | "review";
type Commit = () => Promise<boolean>;
type CommitRef = { current: Commit | null };

const LOOK: Record<StepKey, { label: string; hint: string; icon: Glyph }> = {
  basics: { label: "The property", hint: "Its name, what kind it is, and where.", icon: "home-outline" },
  details: { label: "Details", hint: "Water, power and the compound.", icon: "options-outline" },
  sale: { label: "Sale details", hint: "The price, the tenure and what is for sale.", icon: "cash-outline" },
  documents: { label: "Documents", hint: "What shows it is yours.", icon: "document-text-outline" },
  amenities: { label: "Amenities", hint: "What the whole compound shares.", icon: "sparkles-outline" },
  photos: { label: "Photos", hint: "The front and the wider area. The rest is optional.", icon: "images-outline" },
  review: { label: "Review", hint: "Check it over, then create it.", icon: "eye-outline" },
};

export function PropertyWizard({
  propertyId: initialId = null,
  startAt = null,
  purpose: initialPurpose = "letting",
  organizationId: requestedOrganization = null,
  onClose,
  onFinished,
}: {
  /** An existing property to carry on with; none starts a new one. */
  propertyId?: string | null;
  /** A step to open on, e.g. "amenities" from the property screen. */
  startAt?: string | null;
  purpose?: "letting" | "sale";
  organizationId?: string | null;
  /** Leave. Everything finished so far is already saved. */
  onClose: () => void;
  /** "Create property" (or "Done" for a correction) was pressed. */
  onFinished: (propertyId: string) => void;
}) {
  const [id, setId] = useState<string | null>(initialId);
  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [sale, setSale] = useState<SellerSale | null>(null);
  const [vocabulary, setVocabulary] = useState<PropertyVocabulary | null>(null);
  const [step, setStep] = useState<StepKey>("basics");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Before the record exists the outline follows what is being chosen: a sale
  // adds its own step and land has no details or amenities.
  const [draftPurpose, setDraftPurpose] = useState<"letting" | "sale">(initialPurpose);
  const [draftType, setDraftType] = useState("");
  // What the step on screen does when the pinned button is pressed.
  const commitRef = useRef<Commit | null>(null);
  // Set the moment the record exists, before React re-renders with the new id.
  const createdId = useRef<string | null>(null);
  const [documentReady, setDocumentReady] = useState(false);

  useEffect(() => {
    void loadPropertyVocabulary().then(setVocabulary).catch(() => setVocabulary(null));
  }, []);

  const load = useCallback(async (propertyId: string) => {
    const [prop, progress, amenityState] = await Promise.all([
      getProperty(propertyId),
      getVerification("property", propertyId),
      getPropertyAmenities(propertyId),
    ]);
    setSale(prop.purpose === "sale" ? await getSellerSale(propertyId) : null);
    setProperty(prop);
    setPhotos(progress);
    setAmenities(amenityState.chosen);
    return prop;
  }, []);

  useEffect(() => {
    if (!initialId) return;
    load(initialId).catch((cause) =>
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this property."),
    );
  }, [initialId, load]);

  const setup = useMemo<SetupStep[]>(() => {
    if (property) {
      return describePropertySetup(
        toSetupInput(
          property,
          photos,
          amenities !== null && property.amenities_confirmed_at ? amenities.length : null,
          sale ? sale.missing.length : null,
        ),
      );
    }
    return describePropertySetup({
      name: "",
      waterSource: "unknown",
      powerMeterType: "unknown",
      documentState: "draft",
      photos: null,
      amenityCount: null,
      purpose: draftPurpose,
      propertyType: draftType,
    }).map((row) => (row.key === "basics" ? { ...row, status: "todo" as const } : row));
  }, [property, photos, amenities, sale, draftPurpose, draftType]);

  const keys = setup.map((row) => row.key as StepKey);

  // An existing property opens on what was asked for, else on what is left.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !property) return;
    landed.current = true;
    const asked = keys.includes(startAt as StepKey) ? (startAt as StepKey) : null;
    setStep(asked ?? (resumeAt(setup) as StepKey));
  }, [property, keys, setup, startAt]);

  const shown: StepKey = keys.includes(step) ? step : keys[0]!;
  const at = keys.indexOf(shown);
  const settled = property
    ? ["changes_requested", "rejected", "expired"].includes(property.verification.state)
    : false;
  const locked = property ? property.permitted_actions.edit?.allowed === false : false;
  const outstanding = setup.filter((row) => !row.terminal && !row.optional && row.status !== "done");

  const strip: WizardStep[] = setup.map((row) => {
    const key = row.key as StepKey;
    return {
      key,
      ...LOOK[key],
      done: row.status === "done" && !row.terminal,
      reachable: !busy && (Boolean(id) || key === "basics"),
    };
  });

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
      const current = id ?? createdId.current;
      if (current) await load(current);
      if (shown === "review") {
        if (current) onFinished(current);
        return;
      }
      const next = keys[at + 1];
      if (next) go(next);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const recorded = property ? property.verification.authority.state !== "draft" : false;
  const primary =
    shown === "review"
      ? settled ? "Done" : "Create property"
      : shown === "documents" && !recorded && !documentReady
        ? "Skip for now"
        : shown === "basics" && !id
          ? "Continue"
          : "Save and continue";

  if (initialId && !property) {
    return (
      <View style={styles.loading}>
        {error ? <Notice tone="error" title={error} /> : <Bone height={22} />}
      </View>
    );
  }

  return (
    <WizardFrame
      steps={strip}
      current={shown}
      onGo={(key) => go(key as StepKey)}
      footer={
        <>
          {at > 0 ? (
            <QuietAct label="Back" icon="chevron-back" disabled={busy} onPress={() => go(keys[at - 1]!)} />
          ) : (
            <QuietAct label="Cancel" disabled={busy} onPress={onClose} />
          )}
          {locked ? (
            <Pill label="Close" grow onPress={onClose} />
          ) : (
            <Pill
              label={primary}
              icon={shown === "review" ? "checkmark" : "arrow-forward"}
              busy={busy}
              busyLabel="Saving"
              disabled={shown === "review" && !settled && outstanding.length > 0}
              grow
              onPress={() => void advance()}
            />
          )}
        </>
      }
    >
      {locked && property ? (
        <Notice
          tone="info"
          title="This property is with our team or verified"
          body="Its details are fixed while that stands."
        />
      ) : null}

      {shown === "basics" ? (
        property ? (
          <NameStep property={property} vocabulary={vocabulary} commitRef={commitRef} />
        ) : (
          <NewPropertyStep
            vocabulary={vocabulary}
            purpose={draftPurpose}
            onPurpose={(next) => { setDraftPurpose(next); setDraftType(""); }}
            propertyType={draftType}
            onType={setDraftType}
            requestedOrganization={requestedOrganization}
            commitRef={commitRef}
            onCreated={(created) => {
              createdId.current = created.id;
              setId(created.id);
            }}
          />
        )
      ) : null}

      {shown === "details" && property ? (
        <DetailsStep property={property} vocabulary={vocabulary} commitRef={commitRef} />
      ) : null}

      {shown === "sale" && property && sale ? (
        <SaleStep propertyId={property.id} sale={sale} commitRef={commitRef} onSale={setSale} />
      ) : null}

      {shown === "documents" && property ? (
        <DocumentsStep
          property={property}
          saleKind={property.purpose === "sale" ? (sale?.kind ?? null) : null}
          onReady={setDocumentReady}
          commitRef={commitRef}
          reload={() => load(property.id)}
        />
      ) : null}

      {shown === "amenities" && property ? <AmenitiesStep propertyId={property.id} commitRef={commitRef} /> : null}

      {shown === "photos" && property ? (
        <VerificationPanel
          subject="property"
          id={property.id}
          title="This property"
          showSubmit={false}
          onState={setPhotos}
        />
      ) : null}

      {shown === "review" && property ? (
        <ReviewStep
          property={property}
          vocabulary={vocabulary}
          amenities={amenities}
          photos={photos}
          sale={sale}
          outstanding={outstanding}
          settled={settled}
          onGo={(key) => go(key as StepKey)}
        />
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}
    </WizardFrame>
  );
}

// --- the steps ----------------------------------------------------------------

/** Registers what the pinned button does while this step is on screen. */
function useCommit(commitRef: CommitRef, run: Commit) {
  useEffect(() => {
    commitRef.current = run;
  });
  useEffect(() => () => {
    commitRef.current = null;
  }, [commitRef]);
}

function NewPropertyStep({
  vocabulary,
  purpose,
  onPurpose,
  propertyType,
  onType,
  requestedOrganization,
  commitRef,
  onCreated,
}: {
  vocabulary: PropertyVocabulary | null;
  purpose: "letting" | "sale";
  onPurpose: (purpose: "letting" | "sale") => void;
  propertyType: string;
  onType: (value: string) => void;
  requestedOrganization: string | null;
  commitRef: CommitRef;
  /** Only the id is needed: the wizard reads the full record back itself. */
  onCreated: (property: { id: string }) => void;
}) {
  const { activeContext } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [organizationId, setOrganizationId] = useState(requestedOrganization ?? "");
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [place, setPlace] = useState<PlaceSuggestion | null>(null);
  const [attribution, setAttribution] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const [digitalAddress, setDigitalAddress] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [missing, setMissing] = useState<Record<string, string>>({});

  useEffect(() => {
    void listOrganizations()
      .then((rows) => {
        setOrganizations(rows);
        if (requestedOrganization) return;
        // The Portfolio being operated, otherwise the only one. With several
        // and no context nothing is chosen: filing it under the first in a list
        // is a wrong answer nobody sees until much later.
        const preferred = activeContext?.startsWith("organization:")
          ? activeContext.slice("organization:".length)
          : "";
        setOrganizationId(
          (current) => current || (rows.find((row) => row.id === preferred)?.id ?? (rows.length === 1 ? rows[0]!.id : "")),
        );
      })
      .catch(() => setOrganizations([]));
  }, [activeContext, requestedOrganization]);

  useEffect(() => {
    const typed = query.trim();
    if (place || typed.length < 2) {
      setSuggestions([]);
      return;
    }
    session.current ??= newPlacesSession();
    let live = true;
    const timer = setTimeout(() => {
      void suggestPlaces(typed, session.current!, true)
        .then((response) => {
          if (!live) return;
          setSuggestions(response.suggestions);
          setAttribution(response.attribution);
        })
        .catch(() => {
          if (live) setSuggestions([]);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, place]);

  useCommit(commitRef, async () => {
    const problems: Record<string, string> = {};
    if (organizations && organizations.length > 1 && !organizationId) problems.portfolio = "Choose the Portfolio it goes into.";
    if (!title.trim()) problems.title = "Give it a name only you will see.";
    if (!propertyType) problems.type = "Choose what kind of property it is.";
    if (!place) problems.place = "Type the town, then pick it from the list.";
    setMissing(problems);
    if (Object.keys(problems).length || !place) return false;
    const address = await createAddress({
      place: {
        provider: place.provider,
        reference: place.reference,
        session: session.current ?? undefined,
        name: place.name,
        context: place.context,
      },
      digital_address: digitalAddress || undefined,
      street: street || undefined,
      landmark: landmark || undefined,
    });
    const input = { title: title.trim(), property_type: propertyType, address_id: address.id, purpose };
    const created = organizationId
      ? await createPrivateProperty(organizationId, input)
      : await createPersonalPortfolioProperty(input);
    onCreated(created);
    return true;
  });

  const types = purpose === "sale" ? (vocabulary?.sale_types ?? []) : (vocabulary?.property_types ?? []);

  return (
    <>
      <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="What is it for?">
        {(
          [
            ["letting", "To let"],
            ["sale", "For sale"],
          ] as const
        ).map(([value, text]) => {
          const on = purpose === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              aria-checked={on}
              onPress={() => onPurpose(value)}
              style={[styles.segmentHalf, on ? styles.segmentOn : null]}
            >
              <Type variant="captionStrong" style={{ color: on ? KOLA_DEEP : MUTED }}>{text}</Type>
            </Pressable>
          );
        })}
      </View>

      {types.length ? (
        <ChoiceTiles
          label="What kind?"
          value={propertyType}
          onChange={(value) => {
            onType(value);
            setMissing((current) => ({ ...current, type: "" }));
          }}
          options={types.map((row) => ({
            value: row.value,
            label: row.label.replace(/ property$/i, ""),
            icon: TYPE_GLYPHS[row.value] ?? "business-outline",
          }))}
        />
      ) : (
        <Bone height={64} />
      )}
      {missing.type ? <Type variant="caption" style={styles.missing}>{missing.type}</Type> : null}

      <View style={styles.group}>
        {organizations && organizations.length === 0 ? (
          <Footnote>This goes into your Danpa HQ Portfolio.</Footnote>
        ) : null}
        {organizations && organizations.length > 1 ? (
          <Select
            label="Portfolio"
            placeholder="Which one files it"
            value={organizationId}
            error={missing.portfolio || undefined}
            options={organizations.map((row) => ({ value: row.id, label: row.name }))}
            onChange={setOrganizationId}
          />
        ) : null}
        <Field
          label="Name"
          placeholder={purpose === "sale" ? "3-bedroom house, East Legon" : "Adom Court"}
          value={title}
          error={missing.title || undefined}
          onChangeText={(next) => {
            setTitle(next);
            setMissing((current) => ({ ...current, title: "" }));
          }}
        />
        <Field
          label="Town or neighbourhood"
          placeholder="Start typing, then pick one"
          value={query}
          error={missing.place || undefined}
          onChangeText={(next) => {
            if (place) session.current = null;
            setQuery(next);
            setPlace(null);
            setMissing((current) => ({ ...current, place: "" }));
          }}
          suffix={place ? <Ionicons name="checkmark-circle" size={18} color={KOLA} /> : undefined}
        />
        {!place && suggestions.length ? (
          <View style={styles.places}>
            {suggestions.map((item, index) => (
              <Pressable
                key={item.provider + item.reference}
                accessibilityRole="button"
                accessibilityLabel={item.context ? `${item.name}. ${item.context}` : item.name}
                onPress={() => {
                  setPlace(item);
                  setQuery(placeLabel(item));
                  setSuggestions([]);
                }}
                {...pressableFeedback(PRESSED)}
                style={({ pressed }) => [styles.place, index ? styles.placeRuled : null, pressed ? { backgroundColor: PRESSED } : null]}
              >
                <Ionicons name="location-outline" size={16} color={KOLA} />
                <View style={styles.placeCopy}>
                  <Type variant="captionStrong" numberOfLines={1} style={{ color: INK }}>{item.name}</Type>
                  {item.context ? <Type variant="caption" numberOfLines={1} style={{ color: MUTED }}>{item.context}</Type> : null}
                </View>
              </Pressable>
            ))}
            {attribution === "google" ? <Footnote>Google Maps</Footnote> : null}
          </View>
        ) : null}
        <Field label="GhanaPost GPS (optional)" placeholder="GA-492-1234" value={digitalAddress} onChangeText={setDigitalAddress} autoCapitalize="characters" />
        <Field label="Street (optional)" placeholder="Nii Tetteh Street" value={street} onChangeText={setStreet} />
        <Field label="Landmark (optional)" placeholder="Opposite the Baptist church" value={landmark} onChangeText={setLandmark} />
      </View>
    </>
  );
}

/** The property once it exists: its name may change, its address may not. */
function NameStep({
  property,
  vocabulary,
  commitRef,
}: {
  property: Property;
  vocabulary: PropertyVocabulary | null;
  commitRef: CommitRef;
}) {
  const [title, setTitle] = useState(property.title);
  const editable = property.permitted_actions.edit?.allowed !== false;

  useCommit(commitRef, async () => {
    if (!editable || title.trim() === property.title) return true;
    if (!title.trim()) return false;
    await updateProperty(property.id, { title: title.trim() });
    return true;
  });

  return (
    <>
      <Field label="Name" value={title} editable={editable} onChangeText={setTitle} />
      <ReviewList>
        <ReviewLine first icon={TYPE_GLYPHS[property.property_type] ?? "business-outline"} term="Kind" value={typeLabel(property, vocabulary)} />
        <ReviewLine icon="location-outline" term="Where" value={addressLine(property)} />
      </ReviewList>
      <Footnote>A property is one address, so it cannot move.</Footnote>
    </>
  );
}

function DetailsStep({
  property,
  vocabulary,
  commitRef,
}: {
  property: Property;
  vocabulary: PropertyVocabulary | null;
  commitRef: CommitRef;
}) {
  const [water, setWater] = useState(property.water_source);
  const [power, setPower] = useState(property.power_meter_type);
  const [compound, setCompound] = useState(property.compound_type);
  const [unanswered, setUnanswered] = useState(false);

  useCommit(commitRef, async () => {
    if ([water, power, compound].includes("unknown")) {
      setUnanswered(true);
      return false;
    }
    if (water !== property.water_source || power !== property.power_meter_type || compound !== property.compound_type) {
      await updateProperty(property.id, { water_source: water, power_meter_type: power, compound_type: compound });
    }
    return true;
  });

  if (!vocabulary) return <Bone height={64} />;

  const tiles = (fact: "water" | "power" | "compound", options: FeatureOption[]) =>
    options.map((row) => ({
      value: row.value,
      label: shortFactLabel(row.label),
      hint: FACT_HINTS[row.value],
      icon: FACT_GLYPHS[fact][row.value] ?? "options-outline",
    }));

  return (
    <>
      <ChoiceTiles label="Water source" value={water} onChange={setWater} options={tiles("water", vocabulary.water_sources)} />
      <ChoiceTiles label="Power meter" value={power} onChange={setPower} options={tiles("power", vocabulary.power_meter_types)} />
      <ChoiceTiles label="Compound" value={compound} onChange={setCompound} options={tiles("compound", vocabulary.compound_types)} />
      {unanswered ? <Type variant="caption" style={styles.missing}>Choose one answer in each group.</Type> : null}
    </>
  );
}

function SaleStep({
  propertyId,
  sale,
  commitRef,
  onSale,
}: {
  propertyId: string;
  sale: SellerSale;
  commitRef: CommitRef;
  onSale: (sale: SellerSale) => void;
}) {
  const saveRef = useRef<(() => Promise<SellerSale | null>) | null>(null);
  useCommit(commitRef, async () => {
    const next = saveRef.current ? await saveRef.current() : sale;
    if (!next) return false;
    onSale(next);
    return true;
  });
  return <SaleDetailsForm propertyId={propertyId} sale={sale} onSaved={() => undefined} submitRef={saveRef} />;
}

function DocumentsStep({
  property,
  saleKind,
  onReady,
  commitRef,
  reload,
}: {
  property: Property;
  saleKind: "residential" | "commercial" | "land" | null;
  onReady: (ready: boolean) => void;
  commitRef: CommitRef;
  reload: () => Promise<Property>;
}) {
  const claimRef = useRef<(() => Promise<void>) | null>(null);
  const [ready, setReady] = useState(false);
  const document = property.verification.authority.state;
  const recorded = document !== "draft";
  const withTeam = document === "submitted" || document === "under_review";
  const verb = saleKind ? "sell" : "let";

  useEffect(() => {
    onReady(ready);
  }, [ready, onReady]);

  useCommit(commitRef, async () => {
    // Nothing chosen is a skip: the strip keeps it open, and Review says so.
    if (recorded || !ready) return true;
    await claimRef.current?.();
    const next = await reload();
    return next.verification.authority.state !== "draft";
  });

  if (document === "verified") return <Notice tone="success" title={`Confirmed as yours to ${verb}`} />;
  if (withTeam) return <Notice tone="info" title="Your claim is with our team" />;
  if (recorded) {
    return <Notice tone="success" title="Document saved" body="Nobody sees it until you send the property for checking." />;
  }
  return (
    <AuthorityClaim
      propertyId={property.id}
      saleKind={saleKind}
      showSubmit={false}
      onReady={setReady}
      submitRef={claimRef}
      onSubmitted={async () => undefined}
    />
  );
}

function AmenitiesStep({ propertyId, commitRef }: { propertyId: string; commitRef: CommitRef }) {
  const saveRef = useRef<Commit | null>(null);
  useCommit(commitRef, async () => (saveRef.current ? saveRef.current() : true));
  return (
    <>
      <Footnote>Each one you choose can be photographed next.</Footnote>
      <SpaceAmenities scope="property" id={propertyId} submitRef={saveRef} />
    </>
  );
}

function ReviewStep({
  property,
  vocabulary,
  amenities,
  photos,
  sale,
  outstanding,
  settled,
  onGo,
}: {
  property: Property;
  vocabulary: PropertyVocabulary | null;
  amenities: SpaceAmenity[] | null;
  photos: VerificationProgress | null;
  sale: SellerSale | null;
  outstanding: SetupStep[];
  settled: boolean;
  onGo: (key: string) => void;
}) {
  const land = property.purpose === "sale" && property.property_type === "land";
  const owed = new Set(outstanding.map((row) => row.key));
  const document = property.verification.authority.state;
  const required = photos ? photos.required_total - photos.required_outstanding : 0;
  const extra = photos ? photos.slots.filter((slot) => !slot.required && slot.provided).length : 0;

  return (
    <>
      <ReviewList>
        <ReviewLine
          first
          icon={TYPE_GLYPHS[property.property_type] ?? "business-outline"}
          term={property.title || "Untitled"}
          value={`${typeLabel(property, vocabulary)} · ${property.purpose === "sale" ? "For sale" : "To let"}`}
          onEdit={() => onGo("basics")}
        />
        <ReviewLine icon="location-outline" term="Where" value={addressLine(property)} />
        {land ? null : (
          <ReviewLine
            icon="water-outline"
            term="Details"
            todo={owed.has("details")}
            value={
              owed.has("details")
                ? "Not answered yet"
                : [property.water_source_label, property.power_meter_label, property.compound_label].map(shortFactLabel).join(" · ")
            }
            onEdit={() => onGo("details")}
          />
        )}
        {sale ? (
          <ReviewLine
            icon="cash-outline"
            term="Sale"
            todo={owed.has("sale")}
            value={sale.price_formatted ?? `${sale.missing.length} details still needed`}
            onEdit={() => onGo("sale")}
          />
        ) : null}
        <ReviewLine
          icon="document-text-outline"
          term="Documents"
          todo={owed.has("documents")}
          value={document === "draft" ? "Not added yet" : document === "verified" ? "Confirmed" : "Saved"}
          onEdit={() => onGo("documents")}
        />
        {land ? null : (
          <ReviewLine
            icon="sparkles-outline"
            term="Amenities"
            value={amenities?.length ? amenities.map((row) => row.name).join(", ") : "None shared"}
            onEdit={() => onGo("amenities")}
          />
        )}
        <ReviewLine
          icon="images-outline"
          term="Photos"
          todo={owed.has("photos")}
          value={photos ? `${required} of ${photos.required_total} required${extra ? ` · ${extra} more` : ""}` : "None yet"}
          onEdit={() => onGo("photos")}
        />
      </ReviewList>

      {settled ? null : outstanding.length ? (
        <Type variant="caption" style={styles.missing}>
          {`Finish ${outstanding.map((row) => LOOK[row.key as StepKey]?.label.toLowerCase() ?? row.title).join(", ")} to create it.`}
        </Type>
      ) : (
        <Footnote>
          {property.purpose === "sale"
            ? "Creating it sends nothing. Once verified, buyers find it straight away."
            : "Creating it sends nothing. Ask for checking from the property."}
        </Footnote>
      )}
    </>
  );
}

// --- words --------------------------------------------------------------------

function typeLabel(property: Property, vocabulary: PropertyVocabulary | null): string {
  const rows = [...(vocabulary?.property_types ?? []), ...(vocabulary?.sale_types ?? [])];
  const label = rows.find((row) => row.value === property.property_type)?.label ?? property.property_type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function addressLine(property: Property): string {
  const address = property.address;
  return [address.house_number, address.street, address.locality_name, address.district_name].filter(Boolean).join(", ");
}

const styles = StyleSheet.create({
  loading: { padding: space[4], gap: space[3] },
  group: { gap: space[3] },
  missing: { color: LATERITE, fontWeight: "500" },
  segment: {
    flexDirection: "row",
    gap: 4,
    padding: 3,
    borderRadius: 999,
    backgroundColor: theme.color.field["100"],
  },
  segmentHalf: { flex: 1, minHeight: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: PAPER, borderWidth: 1, borderColor: EDGE },
  places: {
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: PAPER,
  },
  place: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: 14, paddingVertical: space[2] },
  placeRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: EDGE },
  placeCopy: { flex: 1, minWidth: 0 },
});
