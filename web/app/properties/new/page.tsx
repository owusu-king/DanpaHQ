"use client";

/**
 * Step one of creating a property: what to call it, what kind it is, and where.
 *
 * **This is not a "create" action with its own button.** It is the first step of
 * one journey that ends, five steps later, with *Create property*. The record is
 * written here because documents and photographs need something to attach to —
 * an implementation detail the provider should never feel.
 *
 * It used to feel it acutely. This page said "Create private property", created
 * the record, and dropped the provider into a differently-shaped "setup" flow
 * that ended with a second button also called *Create property*. Two creates,
 * the name asked twice, and no sense of how much was left — so the property
 * seemed to be created at the start and then to need creating again at the end.
 *
 * So the chrome here is the same chrome the rest of the flow uses: the same step
 * list, the same checkpoint journey, and a button that continues rather than finishes.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { PropertyTypeChoice } from "@/components/property/PropertyTypeChoice";
import { PurposeChoice, SaleTypeChoice } from "@/components/property/PurposeChoice";
import { SetupProgress, StepPanel } from "@/components/property/SetupSteps";
import { ApiFailure } from "@/lib/api";
import {
  createAddress,
  createPersonalPortfolioProperty,
  createPrivateProperty,
  listOrganizations,
  type Organization,
} from "@/lib/console";
import {
  newPlacesSession,
  placeLabel,
  suggestPlaces,
  type PlaceSuggestion,
} from "@/lib/places";
import { describePropertySetup } from "@/lib/propertySetup";
import {
  loadPropertyVocabulary,
  type FeatureOption,
  type PropertyTypeOption,
} from "@/lib/propertyTypes";
import { useSession } from "@/lib/session";

/** The whole journey, as it stands before anything exists. */
const OUTLINE = describePropertySetup({
  name: "",
  waterSource: "unknown",
  powerMeterType: "unknown",
  documentState: "draft",
  photos: null,
  amenityCount: null,
}).map((step) => (step.key === "basics" ? { ...step, status: "todo" as const } : step));

function NewPropertyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeContext } = useSession();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [organizationId, setOrganizationId] = useState(searchParams.get("organization") ?? "");
  const [title, setTitle] = useState("");
  // Empty until the vocabulary arrives, and until the person chooses. There
  // is no sensible default: a hostel is not a residential property with extra
  // rooms, and guessing changes what may be added to it later.
  const [propertyType, setPropertyType] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  // To let or for sale. Letting unless asked otherwise — `?purpose=sale` comes
  // from "Sell a property" — and fixed once the record exists.
  const [purpose, setPurpose] = useState<"letting" | "sale">(
    searchParams.get("purpose") === "sale" ? "sale" : "letting",
  );
  const [saleTypes, setSaleTypes] = useState<FeatureOption[]>([]);
  const [query, setQuery] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const [placeAttribution, setPlaceAttribution] = useState<string | null>(null);
  const placesSession = useRef<string | null>(null);
  const [digitalAddress, setDigitalAddress] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Fetched, not hardcoded: the same rules that validate the request describe
    // the form, so this cannot offer a category the backend does not have.
    void loadPropertyVocabulary()
      .then((vocabulary) => {
        setPropertyTypes(vocabulary.property_types);
        setSaleTypes(vocabulary.sale_types ?? []);
      })
      .catch(() => setPropertyTypes([]));
  }, []);

  useEffect(() => {
    void listOrganizations()
      .then((rows) => {
        setOrganizations(rows);
        // The Portfolio being operated, not whichever Portfolio came back
        // first. This form files the Property, and filing it into the wrong
        // one is how a personal house ends up on a company's roster — the
        // picker below still lets somebody say otherwise on purpose.
        const preferred = activeContext?.startsWith("organization:")
          ? activeContext.slice("organization:".length)
          : "";
        setOrganizationId(
          (current) => current || rows.find((row) => row.id === preferred)?.id || rows[0]?.id || "",
        );
      })
      .catch(() => { setOrganizations([]); setError("Could not load your Portfolios."); });
  }, [activeContext]);

  useEffect(() => {
    const typed = query.trim();
    if (selectedPlace || typed.length < 2) {
      setPlaceSuggestions([]);
      return;
    }

    placesSession.current ??= newPlacesSession();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void suggestPlaces(typed, placesSession.current!, controller.signal, true)
        .then((response) => {
          setPlaceSuggestions(response.suggestions);
          setPlaceAttribution(response.attribution);
        })
        .catch(() => {
          if (!controller.signal.aborted) setPlaceSuggestions([]);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedPlace]);

  async function saveAndContinue() {
    if (!selectedPlace || (organizations?.length && !organizationId)) return;
    setBusy(true);
    setError("");
    try {
      const address = await createAddress({
        place: {
          provider: selectedPlace.provider,
          reference: selectedPlace.reference,
          session: placesSession.current ?? undefined,
          name: selectedPlace.name,
          context: selectedPlace.context,
        },
        digital_address: digitalAddress || undefined,
        street: street || undefined,
        landmark: landmark || undefined,
      });
      const input = {
        title: title.trim(),
        property_type: propertyType,
        address_id: address.id,
        purpose,
      };
      const property = organizationId
        ? await createPrivateProperty(organizationId, input)
        : await createPersonalPortfolioProperty(input);
      // Straight on to step two. `replace`, not `push`: going back should reach
      // the properties list, not a form that would create a second property.
      // A sale goes to its price and size: land has no water, meter or compound
      // to ask about, and a building's are secondary to what it costs.
      const next = purpose === "sale" ? "sale" : "details";
      router.replace(`/properties/${property.id}/setup?step=${next}` as never);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not start this property.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (organizations === null) {
    return (
      <main style={SHELL}>
        <p className="type-caption">Loading Portfolio…</p>
      </main>
    );
  }

  const ready = Boolean(title.trim() && propertyType && selectedPlace && (organizationId || organizations.length === 0));
  return (
    <main style={SHELL}>
      <Link href="/properties" className="type-caption" style={LINK}>
        ← All properties
      </Link>

      <header style={{ marginTop: "var(--space-4)" }}>
        <h1 className="type-display-2" style={{ margin: 0 }}>
          Create a property
        </h1>
        <p className="type-caption" style={{ margin: "var(--space-2) 0 0" }}>
          Private until you choose otherwise.
        </p>
      </header>

      {/* The same tracker the rest of the flow navigates with. Nothing exists to
          jump to until this step saves, so here it only shows the way ahead. */}
      <div style={{ marginTop: "var(--space-6)" }}>
        <SetupProgress steps={OUTLINE} current="basics" />
      </div>

      <div style={LAYOUT}>
        <div style={CONTENT}>
          <StepPanel
            title="The property"
          >
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              {organizations.length > 1 ? (
                <Select
                  label="Portfolio"
                  value={organizationId}
                  onChange={setOrganizationId}
                  options={organizations.map(
                    (organization) => [organization.id, organization.name] as const,
                  )}
                />
              ) : null}

              {organizations.length === 0 ? (
                <Notice
                  tone="info"
                  title="This goes into your Rooomly Portfolio"
                />
              ) : null}

              <Field
                label="Property name"
                hint="Only you see this."
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />

              {/* Purpose and type are compact dropdowns (owner, 2026-10-05).
                  Portfolio activities describe the current focus; they do not
                  remove valid categories from the backend vocabulary. */}
              <div style={PAIR}>
              <PurposeChoice
                value={purpose}
                onChange={(next) => {
                  setPurpose(next);
                  // The two purposes choose from different categories — a hostel
                  // is never sold, land is never let — so the choice resets.
                  setPropertyType("");
                }}
              />

              {purpose === "sale" ? (
                <SaleTypeChoice types={saleTypes} value={propertyType} onChange={setPropertyType} />
              ) : (
                <PropertyTypeChoice
                  types={propertyTypes}
                  value={propertyType}
                  onChange={setPropertyType}
                />
              )}
              </div>

              <div>
                <Field
                  label="Town or neighbourhood"
                  hint="Type, then pick a result."
                  value={query}
                  autoComplete="off"
                  onChange={(event) => {
                    if (selectedPlace) placesSession.current = null;
                    setQuery(event.target.value);
                    setSelectedPlace(null);
                    if (!event.target.value.trim()) placesSession.current = null;
                  }}
                />
                {placeSuggestions.length ? (
                  <div
                    role="listbox"
                    aria-label="Town or neighbourhood suggestions"
                    style={{
                      display: "grid",
                      marginTop: "var(--space-2)",
                      border: "var(--border-hairline) solid var(--color-field-200)",
                      borderRadius: "var(--radius-md)",
                      overflow: "hidden",
                    }}
                  >
                    {placeSuggestions.map((item) => (
                      <button
                        key={item.provider + item.reference}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setSelectedPlace(item);
                          setQuery(placeLabel(item));
                          setPlaceSuggestions([]);
                        }}
                        style={{
                          minHeight: "2.875rem",
                          padding: "var(--space-2) var(--space-3)",
                          border: 0,
                          borderBottom: "var(--border-hairline) solid var(--color-field-100)",
                          background: "var(--color-field-0)",
                          color: "var(--color-ink-900)",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <span className="type-body" style={{ display: "block" }}>{item.name}</span>
                        {item.context ? (
                          <span className="type-caption" style={{ color: "var(--color-ink-500)" }}>
                            {item.context}
                          </span>
                        ) : null}
                      </button>
                    ))}
                    {placeAttribution === "google" ? (
                      <p className="type-caption" style={{ margin: 0, padding: "var(--space-2) var(--space-3)", color: "var(--color-ink-500)" }}>
                        Google Maps
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <Field
                label="GhanaPost GPS (optional)"
                value={digitalAddress}
                onChange={(event) => setDigitalAddress(event.target.value)}
              />
              <Field
                label="Street (optional)"
                value={street}
                onChange={(event) => setStreet(event.target.value)}
              />
              <Field
                label="Landmark (optional)"
                value={landmark}
                onChange={(event) => setLandmark(event.target.value)}
              />

              {error ? <Notice tone="error" title={error} /> : null}

              <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <Button onClick={saveAndContinue} busy={busy} busyLabel="Saving…" disabled={!ready}>
                  Save and continue
                </Button>
                <Link href="/properties">
                  <Button variant="quiet">Cancel</Button>
                </Link>
              </div>
              {!ready ? (
                <p className="type-caption" style={{ margin: 0 }}>
                  Add a name, type and town to continue.
                </p>
              ) : null}
            </div>
          </StepPanel>
        </div>
      </div>
    </main>
  );
}

export default function NewPropertyPage() {
  return (
    <Suspense
      fallback={
        <main style={SHELL}>
          <p className="type-caption">Loading…</p>
        </main>
      }
    >
      <NewPropertyContent />
    </Suspense>
  );
}

const SHELL: React.CSSProperties = {
  maxWidth: "64rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-5)",
};

/** One column: the tracker above is the navigation. */
const LAYOUT: React.CSSProperties = { marginTop: "var(--space-6)" };

const CONTENT: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "var(--space-4)",
};

/** Two short dropdowns side by side, stacking on a phone. */
const PAIR: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
  gap: "var(--space-4)",
  alignItems: "start",
};

const LINK: React.CSSProperties = { color: "var(--color-kola-600)" };
