"use client";

/**
 * Submitting a property for verification.
 *
 * A separate flow from creating one, reached from the property, and read-only:
 * this is what a reviewer will see, shown back before it goes. Nothing on this
 * page changes anything — the way to change something is to go and change it,
 * which every row here links to.
 *
 * It sends **one** thing. A property is two reviews underneath — the document
 * that says it is yours to let, and the photographs that say it is what you
 * describe — and they are decided together, so they queue together. The
 * provider is asked once.
 *
 * That was the defect. Recording the document used to file it for review on the
 * spot, halfway through creating the property, so the two halves went to the
 * team at different times: the claim during setup and the photographs whenever
 * the provider found the button. A reviewer received pictures of a building
 * nobody had claimed, and the provider was asked to send the same property
 * twice and reasonably concluded the first attempt had failed.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import {
  getProperty,
  getPropertyAmenities,
  submitPropertyForVerification,
  type Property,
  type SpaceAmenity,
} from "@/lib/console";
import { getVerification, type VerificationProgress } from "@/lib/verification";

export default function VerifyPropertyPage() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get("id") ?? "";

  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [prop, progress, amenityState] = await Promise.all([
        getProperty(id),
        getVerification("property", id),
        getPropertyAmenities(id),
      ]);
      setProperty(prop);
      setPhotos(progress);
      setAmenities(amenityState.chosen);
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this property.");
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!id) {
    return (
      <main style={SHELL}>
        <Notice tone="info" title="Choose a property first" body="Open a property from your Portfolio before submitting it for verification." />
        <p style={{ marginTop: "var(--space-4)" }}><Link href="/properties">All properties</Link></p>
      </main>
    );
  }

  if (error && !property) {
    return (
      <main style={SHELL}>
        <Notice tone="error" title={error} />
      </main>
    );
  }
  if (!property) {
    return (
      <main style={SHELL}>
        <p className="type-caption">Loading…</p>
      </main>
    );
  }

  const submit = property.permitted_actions.submit_for_verification;
  const { verification } = property;
  const address = property.address;

  if (sent) {
    return (
      <main style={SHELL}>
        <Notice
          tone="success"
          title="Sent for verification"
          body="Our team has it. We will let you know the outcome — you do not need to do anything else. In the meantime you can add the spaces inside it; none of them wait on this."
        />
        <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-3)" }}>
          <Link href={`/record/property?id=${id}` as never}>
            <Button>Go to the property</Button>
          </Link>
          <Link href="/properties">
            <Button variant="secondary">All properties</Button>
          </Link>
        </div>
      </main>
    );
  }

  // Already with the team, or already decided: there is nothing to submit, and
  // the property page is where the actual options are.
  if (verification.state === "submitted" || verification.state === "under_review") {
    return (
      <main style={SHELL}>
        <Notice
          tone="info"
          title="This property is already with our team"
          body="You can view the submission or take it back from the property page."
        />
        <div style={{ marginTop: "var(--space-5)" }}>
          <Link href={`/record/property?id=${id}` as never}>
            <Button>Go to the property</Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={SHELL}>
      <Link href={`/record/property?id=${id}` as never} className="type-caption" style={LINK}>
        ← {property.title || "This property"}
      </Link>

      <header style={{ marginTop: "var(--space-4)" }}>
        <h1 className="type-display-2" style={{ margin: 0 }}>
          Submit for verification
        </h1>
        <p
          className="type-body"
          style={{ color: "var(--color-ink-700)", margin: "var(--space-2) 0 0", maxWidth: "58ch" }}
        >
          This is what our team will see. Look it over — once it is sent you
          cannot change the property until they come back to you, though you can
          always take it back out of the queue.
        </p>
      </header>

      <section style={PANEL}>
        <h2 className="type-title-2" style={{ margin: 0 }}>
          The property
        </h2>
        <dl style={{ margin: 0, display: "grid" }}>
          <Row term="Name" value={property.title || "Untitled"} to={`/record/property-setup?propertyId=${id}&step=details`} />
          <Row term="Kind" value={property.property_type.replace(/_/g, " ")} />
          <Row
            term="Address"
            value={
              address
                ? [address.house_number, address.street, address.locality_name, address.district_name]
                    .filter(Boolean)
                    .join(", ")
                : "No address recorded"
            }
          />
          {address?.digital_address ? (
            <Row term="GhanaPost GPS" value={address.digital_address} />
          ) : null}
          <Row
            term="Water"
            value={property.water_source.replace(/_/g, " ")}
            to={`/record/property-setup?propertyId=${id}&step=details`}
          />
          <Row
            term="Electricity"
            value={property.power_meter_type.replace(/_/g, " ")}
            to={`/record/property-setup?propertyId=${id}&step=details`}
          />
          <Row
            term="Compound"
            value={property.compound_type.replace(/_/g, " ")}
            to={`/record/property-setup?propertyId=${id}&step=details`}
          />
          <Row term="Security" value={securityLine(property)} />
          {property.notes ? <Row term="Notes" value={property.notes} /> : null}
        </dl>
      </section>

      <section style={PANEL}>
        <h2 className="type-title-2" style={{ margin: 0 }}>
          What our team will decide
        </h2>
        <dl style={{ margin: 0, display: "grid" }}>
          <Row
            term="Ownership document"
            value={
              verification.authority.state === "draft"
                ? "Not added"
                : verification.authority.state === "verified"
                  ? "Already confirmed"
                  : "Added, ready to send"
            }
            to={`/record/property-setup?propertyId=${id}&step=documents`}
          />
          <Row
            term="Photographs"
            value={
              photos
                ? `${photos.required_total - photos.required_outstanding} of ${photos.required_total} required views`
                : "Loading…"
            }
            to={`/record/property-setup?propertyId=${id}&step=photos`}
          />
          <Row
            term="What the compound has"
            value={
              amenities === null
                ? "Loading…"
                : amenities.length
                  ? amenities.map((amenity) => amenity.name).join(", ")
                  : "Nothing shared recorded"
            }
            to={`/record/property-setup?propertyId=${id}&step=amenities`}
          />
        </dl>
      </section>

      {error ? <Notice tone="error" title={error} /> : null}

      {!submit?.allowed && submit?.blockers?.length ? (
        <Notice
          tone="warning"
          title="Not ready to send yet"
          body={submit.blockers.map((blocker) => blocker.message).join(" ")}
        />
      ) : null}
      {!submit?.allowed && !submit?.blockers?.length && submit?.message ? (
        <Notice tone="warning" title={submit.message} />
      ) : null}

      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Button
          busy={busy}
          busyLabel="Sending…"
          disabled={!submit?.allowed}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await submitPropertyForVerification(id);
              setSent(true);
            } catch (cause) {
              setError(
                cause instanceof ApiFailure
                  ? cause.error.message
                  : "Could not send this for verification.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Submit for verification
        </Button>
        <Link href={`/record/property?id=${id}` as never}>
          <Button variant="quiet">Not yet</Button>
        </Link>
      </div>
    </main>
  );
}

function securityLine(property: Property): string {
  const marks = [
    property.has_security ? "someone on the gate" : "",
    property.is_gated ? "walled and gated" : "",
  ].filter(Boolean);
  return marks.length ? marks.join(", ") : "None recorded";
}

function Row({ term, value, to }: { term: string; value: string; to?: string }) {
  return (
    <div style={ROW}>
      <dt className="type-caption" style={{ color: "var(--color-ink-500)" }}>
        {term}
      </dt>
      <dd
        className="type-body"
        style={{ margin: 0, display: "flex", gap: "var(--space-3)", justifyContent: "space-between" }}
      >
        <span>{value}</span>
        {to ? (
          <Link href={to as never} className="type-caption" style={{ ...LINK, fontWeight: 600 }}>
            Change
          </Link>
        ) : null}
      </dd>
    </div>
  );
}

const SHELL: React.CSSProperties = {
  maxWidth: "52rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-5)",
  display: "grid",
  gap: "var(--space-5)",
};

const PANEL: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-200)",
  borderRadius: "var(--radius-md)",
};

const ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "10rem 1fr",
  gap: "var(--space-4)",
  padding: "var(--space-3) 0",
  borderTop: "var(--border-hairline) solid var(--color-field-200)",
};

const LINK: React.CSSProperties = { color: "var(--color-kola-600)" };
