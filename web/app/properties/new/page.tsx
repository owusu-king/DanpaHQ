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
import { Suspense, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { PropertyTypeChoice } from "@/components/property/PropertyTypeChoice";
import { SetupProgress, SetupSteps, StepPanel } from "@/components/property/SetupSteps";
import { ApiFailure } from "@/lib/api";
import {
  createAddress,
  createPersonalPortfolioProperty,
  createPrivateProperty,
  listOrganizations,
  searchLocalities,
  type Locality,
  type Organization,
} from "@/lib/console";
import { describePropertySetup } from "@/lib/propertySetup";
import { loadPropertyTypes, type PropertyTypeOption } from "@/lib/propertyTypes";
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
  const [query, setQuery] = useState("");
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [locality, setLocality] = useState<Locality | null>(null);
  const [digitalAddress, setDigitalAddress] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Fetched, not hardcoded: the same rules that validate the request describe
    // the form, so this cannot offer a category the backend does not have.
    void loadPropertyTypes()
      .then(setPropertyTypes)
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
    if (locality || query.trim().length < 2) return;
    const timer = window.setTimeout(
      () => void searchLocalities(query.trim()).then(setLocalities),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [locality, query]);

  async function saveAndContinue() {
    if (!locality || (organizations?.length && !organizationId)) return;
    setBusy(true);
    setError("");
    try {
      const address = await createAddress({
        locality_id: locality.id,
        digital_address: digitalAddress || undefined,
        street: street || undefined,
        landmark: landmark || undefined,
      });
      const input = {
        title: title.trim(),
        property_type: propertyType,
        address_id: address.id,
      };
      const property = organizationId
        ? await createPrivateProperty(organizationId, input)
        : await createPersonalPortfolioProperty(input);
      // Straight on to step two. `replace`, not `push`: going back should reach
      // the properties list, not a form that would create a second property.
      router.replace(`/properties/${property.id}/setup?step=details` as never);
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

  const ready = Boolean(title.trim() && propertyType && locality && (organizationId || organizations.length === 0));
  return (
    <main style={SHELL}>
      <Link href="/properties" className="type-caption" style={LINK}>
        ← All properties
      </Link>

      <header style={{ marginTop: "var(--space-4)" }}>
        <p className="type-label" style={{ color: "var(--color-ink-500)", margin: 0 }}>
          PRIVATE BY DEFAULT
        </p>
        <h1 className="type-display-2" style={{ margin: "var(--space-2) 0 0" }}>
          Create a property
        </h1>
        <p
          className="type-body"
          style={{ color: "var(--color-ink-700)", margin: "var(--space-2) 0 0", maxWidth: "58ch" }}
        >
          Everything saves as you go. Do them in any order.
        </p>
      </header>

      <div style={{ marginTop: "var(--space-6)" }}>
        <SetupProgress steps={OUTLINE} current="basics" />
      </div>

      <div style={LAYOUT}>
        <aside style={SIDEBAR}>
          <SetupSteps steps={OUTLINE} current="basics" onSelect={() => undefined} />
        </aside>

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
                hint="Your own label — tenants see the listing headline, not this."
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />

              {/* Three categories, and the choice decides what may be let
                  inside. A dropdown made the most consequential field on the
                  page the least visible one. Portfolio activities describe the
                  current focus; they do not remove valid categories from the
                  backend vocabulary. */}
              <PropertyTypeChoice
                types={propertyTypes}
                value={propertyType}
                onChange={setPropertyType}
              />

              <div>
                <Field
                  label="Town or neighbourhood"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLocality(null);
                  }}
                />
                {localities.length ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "var(--space-2)",
                      marginTop: "var(--space-2)",
                    }}
                  >
                    {localities.map((item) => (
                      <Button
                        key={item.id}
                        variant="secondary"
                        onClick={() => {
                          setLocality(item);
                          setQuery(item.name);
                          setLocalities([]);
                        }}
                      >
                        {item.name} · {item.district_name}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>

              <Field
                label="GhanaPost GPS (where available)"
                value={digitalAddress}
                onChange={(event) => setDigitalAddress(event.target.value)}
              />
              <Field
                label="Street"
                value={street}
                onChange={(event) => setStreet(event.target.value)}
              />
              <Field
                label="Landmark"
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
                  A name, a kind and a town are needed before the next step.
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

/** Wraps to one column on a phone without a media query — see the setup page. */
const LAYOUT: React.CSSProperties = {
  marginTop: "var(--space-6)",
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-6)",
  alignItems: "flex-start",
};

const SIDEBAR: React.CSSProperties = {
  flex: "1 1 15rem",
  maxWidth: "100%",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-200)",
  borderRadius: "var(--radius-md)",
  overflow: "hidden",
};

const CONTENT: React.CSSProperties = {
  flex: "999 1 22rem",
  minWidth: 0,
  display: "grid",
  gap: "var(--space-4)",
};

const LINK: React.CSSProperties = { color: "var(--color-kola-600)" };
