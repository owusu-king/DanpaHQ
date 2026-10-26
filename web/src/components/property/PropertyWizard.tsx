"use client";

/**
 * Creating a property, in one modal (owner, 2026-10-20).
 *
 * The property → details → documents → amenities → photos → review, walked in
 * the agreement wizard's frame: a rail of steps that turn green as they are
 * finished, the step, and one footer whose button does whatever the step needs —
 * create the record, save the answers, keep the document, store the amenities.
 *
 * **Amenities come before Photos** because each shared amenity offers a
 * photograph of itself; only the front and the wider area are required.
 *
 * **The last step creates; it sends nothing.** Asking for verification stays a
 * separate decision made from the property. Everything is written as it is
 * finished — the record at step one, then a PATCH, a draft claim, a PUT — so
 * closing the modal at any point loses only the step on screen.
 *
 * The same component renders in a sheet over Properties and on the
 * `/record/property-new` and `/record/property-setup` routes, so a link from an
 * email or a notification opens the same flow.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ChoiceTiles, ReviewLine, WizardShell, type WizardStep } from "@/components/creation/WizardShell";
import { Icon, type IconName } from "@/components/portal/icons";
import { AuthorityClaim } from "@/components/property/AuthorityClaim";
import { SaleDetailsForm } from "@/components/property/SaleDetailsForm";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { VerificationPanel } from "@/components/property/VerificationPanel";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import {
  createAddress,
  createPersonalPortfolioProperty,
  createPrivateProperty,
  getProperty,
  getPropertyAmenities,
  listOrganizations,
  updateProperty,
  type Organization,
  type Property,
  type SpaceAmenity,
} from "@/lib/console";
import { FACT_GLYPHS, FACT_HINTS, shortFactLabel } from "@/lib/creationGlyphs";
import { newPlacesSession, placeLabel, suggestPlaces, type PlaceSuggestion } from "@/lib/places";
import { describePropertySetup, resumeAt, toSetupInput, type SetupStep } from "@/lib/propertySetup";
import { loadPropertyVocabulary, type FeatureOption, type PropertyVocabulary } from "@/lib/propertyTypes";
import { getSellerSale, type SellerSale } from "@/lib/sales";
import { useSession } from "@/lib/session";
import { getVerification, type VerificationProgress } from "@/lib/verification";

type StepKey = "basics" | "details" | "sale" | "documents" | "amenities" | "photos" | "review";
type Commit = () => Promise<boolean>;

const LOOK: Record<StepKey, { label: string; hint: string; icon: IconName }> = {
  basics: { label: "The property", hint: "Its name, what kind it is, and where.", icon: "home" },
  details: { label: "Details", hint: "Water, power and the compound.", icon: "details" },
  sale: { label: "Sale details", hint: "The price, the tenure and what is for sale.", icon: "payments" },
  documents: { label: "Documents", hint: "What shows it is yours.", icon: "leases" },
  amenities: { label: "Amenities", hint: "What the whole compound shares.", icon: "amenities" },
  photos: { label: "Photos", hint: "The front and the wider area. The rest is optional.", icon: "photos" },
  review: { label: "Review", hint: "Check it over, then create it.", icon: "eye" },
};

const TYPE_GLYPHS: Record<string, IconName> = {
  residential: "home",
  commercial: "shop",
  hostel: "bed",
  land: "map",
};

export function PropertyWizard({
  propertyId: initialId = null,
  startAt = null,
  purpose: initialPurpose = "letting",
  organizationId: requestedOrganization = null,
  onClose,
  onFinished,
  onTitle,
}: {
  /** An existing property to carry on with; none starts a new one. */
  propertyId?: string | null;
  /** A step to open on, e.g. "amenities" from the property page. */
  startAt?: string | null;
  purpose?: "letting" | "sale";
  organizationId?: string | null;
  /** Leave. Everything finished so far is already saved. */
  onClose: () => void;
  /** "Create property" (or "Done" for a correction) was pressed. */
  onFinished: (propertyId: string) => void;
  /** The name to put in the sheet's header once there is one. */
  onTitle?: (title: string) => void;
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
  // What the step on screen does when the footer's button is pressed.
  const commitRef = useRef<Commit | null>(null);
  // Set by the first step the moment the record exists, before React has
  // re-rendered with the new id — `advance` reads it in the same call.
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

  useEffect(() => {
    if (property?.title) onTitle?.(property.title);
  }, [property?.title, onTitle]);

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

  const railSteps: WizardStep[] = setup.map((row) => {
    const key = row.key as StepKey;
    return {
      key,
      ...LOOK[key],
      summary: railSummary(key, row, property, amenities),
      done: row.status === "done" && !row.terminal,
      reachable: Boolean(id) && !busy ? true : key === "basics",
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

  const footer = (
    <>
      {at > 0 ? (
        <Button variant="quiet" disabled={busy} onClick={() => go(keys[at - 1]!)}>
          Back
        </Button>
      ) : (
        <Button variant="quiet" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      )}
      <span className="lw-foot-spacer" />
      {id && shown !== "review" ? (
        <Button variant="quiet" disabled={busy} onClick={onClose}>
          Finish later
        </Button>
      ) : null}
      {locked ? (
        <Button onClick={onClose}>Close</Button>
      ) : (
        <Button
          busy={busy}
          busyLabel="Saving…"
          disabled={shown === "review" && !settled && outstanding.length > 0}
          onClick={() => void advance()}
        >
          {primary}
        </Button>
      )}
    </>
  );

  if (initialId && !property) {
    return (
      <div className="cw-loading">
        {error ? <Notice tone="error" title={error} /> : <p className="type-caption">Loading this property…</p>}
      </div>
    );
  }

  return (
    <WizardShell
      label="Property steps"
      steps={railSteps}
      current={shown}
      onGo={(key) => go(key as StepKey)}
      railFoot={<><Icon name="lock" />Private until you send it for checking</>}
      footer={footer}
    >
      {locked && property ? (
        <Notice
          tone="info"
          title="This property is with our team or verified"
          body="Its details are fixed while that stands. Open the property to see where it is."
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
    </WizardShell>
  );
}

/** The wizard in its sheet, over the page that opened it. */
export function PropertyWizardModal({
  open,
  propertyId = null,
  startAt = null,
  purpose = "letting",
  onClose,
  onFinished,
}: {
  open: boolean;
  propertyId?: string | null;
  startAt?: string | null;
  purpose?: "letting" | "sale";
  onClose: () => void;
  onFinished: (propertyId: string) => void;
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
      icon="properties"
      title={title || (propertyId ? "Property setup" : purpose === "sale" ? "Sell a property" : "New property")}
      meta="Saved as you go"
      className="lease-wizard-sheet is-wizard creation-sheet"
      closeLabel="Close property setup"
    >
      {(close) => (
        <PropertyWizard
          propertyId={propertyId}
          startAt={startAt}
          purpose={purpose}
          onClose={close}
          onTitle={setTitle}
          onFinished={(id) => {
            onFinished(id);
            close();
          }}
        />
      )}
    </ModalSheet>
  );
}

// --- the steps ----------------------------------------------------------------

type CommitRef = { current: Commit | null };

/** Registers what the footer's button does while this step is on screen. */
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
  onCreated: (property: Property) => void;
}) {
  const { activeContext } = useSession();
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
        // The Portfolio being operated, not whichever came back first.
        const preferred = activeContext?.startsWith("organization:")
          ? activeContext.slice("organization:".length)
          : "";
        setOrganizationId((current) => current || rows.find((row) => row.id === preferred)?.id || rows[0]?.id || "");
      })
      .catch(() => setOrganizations([]));
  }, [activeContext]);

  useEffect(() => {
    const typed = query.trim();
    if (place || typed.length < 2) {
      setSuggestions([]);
      return;
    }
    session.current ??= newPlacesSession();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void suggestPlaces(typed, session.current!, controller.signal, true)
        .then((response) => {
          setSuggestions(response.suggestions);
          setAttribution(response.attribution);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, place]);

  useCommit(commitRef, async () => {
    const problems: Record<string, string> = {};
    if (!title.trim()) problems.title = "Give it a name only you will see.";
    if (!propertyType) problems.type = "Choose what kind of property it is.";
    if (!place) problems.place = "Type the town or neighbourhood, then pick it from the list.";
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
    <div className="cw-form">
      <div className="lw-field">
        <span className="lw-label">What is it for?</span>
        <div className="lw-seg is-wide" role="radiogroup" aria-label="What is it for?">
          {(
            [
              ["letting", "To let"],
              ["sale", "For sale"],
            ] as const
          ).map(([value, text]) => (
            <button key={value} type="button" role="radio" aria-checked={purpose === value} onClick={() => onPurpose(value)}>
              {text}
            </button>
          ))}
        </div>
      </div>

      {types.length ? (
        <ChoiceTiles
          label="What kind?"
          value={propertyType}
          columns={types.length}
          onChange={(value) => {
            onType(value);
            setMissing((current) => ({ ...current, type: "" }));
          }}
          options={types.map((row) => ({
            value: row.value,
            label: row.label.replace(/ property$/i, ""),
            icon: TYPE_GLYPHS[row.value] ?? "properties",
          }))}
        />
      ) : (
        <p className="type-caption">Loading the kinds of property…</p>
      )}
      {missing.type ? <p className="cw-missing">{missing.type}</p> : null}

      <div className="lw-grid">
        <Field
          label="Name"
          hint="Only you see this."
          placeholder="e.g. Adom Court"
          value={title}
          error={missing.title || undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            setMissing((current) => ({ ...current, title: "" }));
          }}
        />
        {organizations && organizations.length === 0 ? (
          <p className="lw-quiet cw-portfolio-note"><Icon name="portfolio" />This goes into your Danpa HQ Portfolio</p>
        ) : null}
        {organizations && organizations.length > 1 ? (
          <Select
            label="Portfolio"
            value={organizationId}
            onChange={setOrganizationId}
            options={organizations.map((row) => [row.id, row.name] as const)}
          />
        ) : null}
      </div>

      <div className="cw-place">
        <Field
          label="Town or neighbourhood"
          placeholder="Start typing, then pick one"
          autoComplete="off"
          value={query}
          error={missing.place || undefined}
          onChange={(event) => {
            if (place) session.current = null;
            setQuery(event.target.value);
            setPlace(null);
            setMissing((current) => ({ ...current, place: "" }));
          }}
        />
        {place ? (
          <p className="cw-place-chosen"><Icon name="pin" />{placeLabel(place)}</p>
        ) : suggestions.length ? (
          <div className="cw-places" role="listbox" aria-label="Places">
            {suggestions.map((item) => (
              <button
                key={item.provider + item.reference}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  setPlace(item);
                  setQuery(placeLabel(item));
                  setSuggestions([]);
                }}
              >
                <Icon name="pin" />
                <span>
                  <strong>{item.name}</strong>
                  {item.context ? <small>{item.context}</small> : null}
                </span>
              </button>
            ))}
            {attribution === "google" ? <p className="cw-places-credit">Google Maps</p> : null}
          </div>
        ) : null}
      </div>

      <div className="lw-grid cw-grid-3">
        <Field label="GhanaPost GPS" hint="Optional" value={digitalAddress} onChange={(event) => setDigitalAddress(event.target.value)} />
        <Field label="Street" hint="Optional" value={street} onChange={(event) => setStreet(event.target.value)} />
        <Field label="Landmark" hint="Optional" value={landmark} onChange={(event) => setLandmark(event.target.value)} />
      </div>
    </div>
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
    <div className="cw-form">
      <Field label="Name" hint="Only you see this." value={title} disabled={!editable} onChange={(event) => setTitle(event.target.value)} />
      <dl className="cw-review">
        <ReviewLine icon={TYPE_GLYPHS[property.property_type] ?? "properties"} term="Kind" value={typeLabel(property, vocabulary)} />
        <ReviewLine icon="pin" term="Where" value={addressLine(property)} />
      </dl>
      <p className="lw-quiet"><Icon name="lock" />A property is one address, so it cannot move.</p>
    </div>
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
    if (
      water !== property.water_source ||
      power !== property.power_meter_type ||
      compound !== property.compound_type
    ) {
      await updateProperty(property.id, {
        water_source: water,
        power_meter_type: power,
        compound_type: compound,
      });
    }
    return true;
  });

  if (!vocabulary) return <p className="type-caption">Loading the choices…</p>;

  const tiles = (fact: "water" | "power" | "compound", options: FeatureOption[]) =>
    options.map((row) => ({
      value: row.value,
      label: shortFactLabel(row.label),
      hint: FACT_HINTS[row.value],
      icon: FACT_GLYPHS[fact][row.value] ?? "details",
    }));

  return (
    <div className="cw-form">
      <ChoiceTiles label="Water source" value={water} onChange={setWater} options={tiles("water", vocabulary.water_sources)} columns={4} />
      <ChoiceTiles label="Power meter" value={power} onChange={setPower} options={tiles("power", vocabulary.power_meter_types)} columns={3} />
      <ChoiceTiles label="Compound" value={compound} onChange={setCompound} options={tiles("compound", vocabulary.compound_types)} columns={3} />
      {unanswered ? <p className="cw-missing">Choose one answer in each row.</p> : null}
    </div>
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
  const save = useRef<(() => Promise<SellerSale | null>) | null>(null);
  useCommit(commitRef, async () => {
    const next = save.current ? await save.current() : sale;
    if (!next) return false;
    onSale(next);
    return true;
  });
  return <SaleDetailsForm propertyId={propertyId} sale={sale} onSaved={() => undefined} submitRef={save} />;
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
  const claim = useRef<(() => Promise<void>) | null>(null);
  const [ready, setReady] = useState(false);
  const document = property.verification.authority.state;
  const recorded = document !== "draft";
  const withTeam = document === "submitted" || document === "under_review";
  const verb = saleKind ? "sell" : "let";

  useEffect(() => {
    onReady(ready);
  }, [ready, onReady]);

  useCommit(commitRef, async () => {
    // Nothing chosen is a skip: the rail keeps it open, and Review says so.
    if (recorded || !ready) return true;
    await claim.current?.();
    const next = await reload();
    return next.verification.authority.state !== "draft";
  });

  if (document === "verified") return <Notice tone="success" title={`Confirmed as yours to ${verb}`} />;
  if (withTeam) return <Notice tone="info" title="Your claim is with our team" />;

  return (
    <div className="cw-form">
      {recorded ? (
        <Notice tone="success" title="Document saved" body="Nobody sees it until you send the property for checking." />
      ) : (
        <AuthorityClaim
          propertyId={property.id}
          saleKind={saleKind}
          showSubmit={false}
          onReady={setReady}
          submitRef={claim}
          onSubmitted={async () => undefined}
        />
      )}
    </div>
  );
}

function AmenitiesStep({ propertyId, commitRef }: { propertyId: string; commitRef: CommitRef }) {
  const save = useRef<Commit | null>(null);
  useCommit(commitRef, async () => (save.current ? save.current() : true));
  return (
    <div className="cw-form">
      <p className="lw-quiet"><Icon name="photos" />Each one you choose can be photographed next.</p>
      <SpaceAmenities scope="property" id={propertyId} submitRef={save} />
    </div>
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
    <div className="cw-form">
      <dl className="cw-review">
        <ReviewLine
          icon={TYPE_GLYPHS[property.property_type] ?? "properties"}
          term={property.title || "Untitled"}
          value={`${typeLabel(property, vocabulary)} · ${property.purpose === "sale" ? "For sale" : "To let"}`}
          onEdit={() => onGo("basics")}
        />
        <ReviewLine icon="pin" term="Where" value={addressLine(property)} />
        {land ? null : (
          <ReviewLine
            icon="water"
            term="Details"
            tone={owed.has("details") ? "todo" : undefined}
            value={
              owed.has("details")
                ? "Not answered yet"
                : [property.water_source_label, property.power_meter_label, property.compound_label]
                    .map(shortFactLabel)
                    .join(" · ")
            }
            onEdit={() => onGo("details")}
          />
        )}
        {sale ? (
          <ReviewLine
            icon="payments"
            term="Sale"
            tone={owed.has("sale") ? "todo" : undefined}
            value={sale.price_formatted ?? `${sale.missing.length} details still needed`}
            onEdit={() => onGo("sale")}
          />
        ) : null}
        <ReviewLine
          icon="leases"
          term="Documents"
          tone={owed.has("documents") ? "todo" : undefined}
          value={document === "draft" ? "Not added yet" : document === "verified" ? "Confirmed" : "Saved"}
          onEdit={() => onGo("documents")}
        />
        {land ? null : (
          <ReviewLine
            icon="amenities"
            term="Amenities"
            value={amenities?.length ? amenities.map((row) => row.name).join(", ") : "None shared"}
            onEdit={() => onGo("amenities")}
          />
        )}
        <ReviewLine
          icon="photos"
          term="Photos"
          tone={owed.has("photos") ? "todo" : undefined}
          value={
            photos
              ? `${required} of ${photos.required_total} required${extra ? ` · ${extra} more` : ""}`
              : "None yet"
          }
          onEdit={() => onGo("photos")}
        />
      </dl>

      {settled ? null : outstanding.length ? (
        <p className="cw-missing">
          Finish {outstanding.map((row) => LOOK[row.key as StepKey]?.label.toLowerCase() ?? row.title).join(", ")} to create it.
        </p>
      ) : (
        <p className="lw-quiet">
          <Icon name="lock" />
          {property.purpose === "sale"
            ? "Creating it sends nothing. Once verified, buyers find it straight away."
            : "Creating it sends nothing. Ask for checking from the property."}
        </p>
      )}
      {settled ? (
        <p className="lw-quiet">
          Send it back from <Link href={`/record/property?id=${property.id}` as never}>the property</Link> when you are ready.
        </p>
      ) : null}
    </div>
  );
}

// --- words --------------------------------------------------------------------

function typeLabel(property: Property, vocabulary: PropertyVocabulary | null): string {
  const rows = [...(vocabulary?.property_types ?? []), ...(vocabulary?.sale_types ?? [])];
  const found = rows.find((row) => row.value === property.property_type);
  const label = found?.label ?? property.property_type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function addressLine(property: Property): string {
  const address = property.address;
  if (!address) return "No address recorded";
  return [address.house_number, address.street, address.locality_name, address.district_name]
    .filter(Boolean)
    .join(", ");
}

function railSummary(
  key: StepKey,
  row: SetupStep,
  property: Property | null,
  amenities: SpaceAmenity[] | null,
): string | undefined {
  if (!property) return undefined;
  if (key === "basics") return property.title || undefined;
  if (key === "details" && row.status === "done") {
    return [property.water_source_label, property.compound_label].map(shortFactLabel).join(" · ");
  }
  if (key === "amenities" && amenities !== null && property.amenities_confirmed_at) {
    return amenities.length ? `${amenities.length} shared` : "None shared";
  }
  return row.detail;
}
