"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ApiFailure } from "@/lib/api";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/lib/formErrors";
import { getPublicListing, type ListingDetail } from "@/lib/listings";
import { chooseWorkspace, useSession } from "@/lib/session";
import {
  submitRentalApplication,
  type MyApplication,
} from "@/lib/tenant";

const INCOME_BANDS = [
  ["", "Choose a band (optional)"],
  ["under_1000", "Under GH₵1,000"],
  ["1000_3000", "GH₵1,000 – 3,000"],
  ["3000_6000", "GH₵3,000 – 6,000"],
  ["6000_10000", "GH₵6,000 – 10,000"],
  ["over_10000", "Over GH₵10,000"],
  ["prefer_not_to_say", "Prefer not to say"],
] as const;

/**
 * The tenant's application claim, sent to the existing application domain.
 *
 * This is deliberately separate from a viewing request. Someone may apply
 * after a remote viewing, before travelling, or without asking for a viewing;
 * neither action silently performs the other.
 */
export default function ApplyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { state, refresh } = useSession();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [application, setApplication] = useState<MyApplication | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  const [advanceMonths, setAdvanceMonths] = useState("");
  const [moveInFrom, setMoveInFrom] = useState("");
  const [householdSize, setHouseholdSize] = useState("");
  const [occupation, setOccupation] = useState("");
  const [employer, setEmployer] = useState("");
  const [incomeBand, setIncomeBand] = useState("");
  const [guarantorName, setGuarantorName] = useState("");
  const [guarantorPhone, setGuarantorPhone] = useState("");
  const [guarantorRelationship, setGuarantorRelationship] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (state.status === "signed_out") {
      const next = `/apply/${params.id}`;
      router.replace(`/sign-in?workspace=tenant&next=${encodeURIComponent(next)}` as never);
    }
  }, [params.id, router, state.status]);

  useEffect(() => {
    if (
      state.status !== "signed_in"
      || state.me.capabilities.active_workspace === "tenant"
      || switchingWorkspace
      || workspaceError
    ) return;

    setSwitchingWorkspace(true);
    void chooseWorkspace("tenant")
      // Re-read the account, not "select the Me we were just handed": `refresh`
      // takes an optional context to select, and the resolved workspace is not one.
      .then(() => refresh())
      .catch((cause) => {
        setWorkspaceError(
          cause instanceof ApiFailure
            ? cause.error.message
            : "We could not open your tenant workspace.",
        );
      })
      .finally(() => setSwitchingWorkspace(false));
  }, [refresh, state, switchingWorkspace, workspaceError]);

  useEffect(() => {
    getPublicListing(params.id)
      .then((row) => {
        setListing(row);
        setAdvanceMonths(String(row.advance_months));
      })
      .catch((cause) => {
        setLoadError(
          cause instanceof ApiFailure
            ? cause.error.message
            : "We could not load this rental.",
        );
      });
  }, [params.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!listing || state.status !== "signed_in") return;

    const localErrors: FieldErrors = {};
    if (advanceMonths === "") localErrors.advance_months_offered = "Say how many months you can pay.";
    const offered = Number(advanceMonths);
    if (advanceMonths !== "" && (!Number.isInteger(offered) || offered < 0 || offered > 36)) {
      localErrors.advance_months_offered = "Enter a whole number from 0 to 36.";
    }
    const household = householdSize === "" ? undefined : Number(householdSize);
    if (household !== undefined && (!Number.isInteger(household) || household < 1 || household > 30)) {
      localErrors.household_size = "Enter a household size from 1 to 30.";
    }
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      setError("");
      return;
    }

    setBusy(true);
    setError("");
    setErrors({});
    try {
      const created = await submitRentalApplication({
        listing_id: listing.id,
        advance_months_offered: offered,
        move_in_from: moveInFrom || null,
        household_size: household,
        occupation: occupation.trim(),
        employer: employer.trim(),
        income_band: incomeBand,
        guarantor_name: guarantorName.trim(),
        guarantor_phone: guarantorPhone.trim(),
        guarantor_relationship: guarantorRelationship.trim(),
        message: message.trim(),
      });
      setApplication(created);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setError(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading" || state.status === "signed_out") {
    return <main style={SHELL}><p className="type-caption">Preparing your application…</p></main>;
  }
  if (state.status === "unavailable") {
    return <main style={SHELL}><Notice tone="error" title="We could not confirm your session." body="Check your connection and try again." /></main>;
  }
  if (workspaceError) {
    return <main style={SHELL}><Notice tone="error" title={workspaceError} /></main>;
  }
  if (
    switchingWorkspace
    || (state.status === "signed_in" && state.me.capabilities.active_workspace !== "tenant")
  ) {
    return <main style={SHELL}><p className="type-caption">Opening your tenant workspace…</p></main>;
  }
  if (loadError) {
    return <main style={SHELL}><Notice tone="error" title={loadError} /></main>;
  }
  if (!listing) {
    return <main style={SHELL}><p className="type-caption">Loading rental details…</p></main>;
  }

  if (application) {
    return (
      <main style={SHELL}>
        <p className="type-label" style={{ color: "var(--color-kola-600)" }}>APPLICATION SENT</p>
        <h1 className="type-display-2">The provider has your application</h1>
        <Notice
          tone="success"
          title={`Status: ${application.status_display}`}
          body={application.meets_advance
            ? `You offered the ${application.advance_months_asked} months requested.`
            : `Your offer is ${application.advance_shortfall_months} month${application.advance_shortfall_months === 1 ? "" : "s"} below the requested advance. The provider can see that clearly.`}
        />
        <p className="type-body" style={{ maxWidth: "55ch" }}>
          Applying does not create a tenancy or lease. You can follow the provider&apos;s response in Applications.
        </p>
        <div style={ACTIONS}>
          <Link href="/applications" className="type-body-strong">View application status →</Link>
          <Link href={`/listings/${listing.id}`} className="type-caption">Back to the rental</Link>
        </div>
      </main>
    );
  }

  const offered = advanceMonths === "" ? null : Number(advanceMonths);
  const shortfall = offered === null || Number.isNaN(offered)
    ? null
    : Math.max(listing.advance_months - offered, 0);

  return (
    <main style={SHELL}>
      <p className="type-label" style={{ color: "var(--color-kola-600)" }}>REQUEST TENANCY</p>
      <h1 className="type-display-2" style={{ marginBottom: "var(--space-2)" }}>
        Apply for {listing.headline}
      </h1>
      <p className="type-body" style={{ color: "var(--color-ink-700)", marginTop: 0 }}>
        {listing.rent_formatted} per {listing.rent_period === "yearly" ? "year" : "month"} · {listing.advance_label} advance
      </p>

      <Notice
        tone="info"
        title="This is an application, not a tenancy"
        body="The provider can review, accept or decline it. A tenancy and lease begin only through their own later steps."
      />

      <form onSubmit={submit} style={FORM} noValidate>
        <section style={SECTION}>
          <h2 className="type-title-2" style={{ margin: 0 }}>Your move and advance</h2>
          <Field
            label="How many months can you pay in advance?"
            hint={`The provider asks for ${listing.advance_months} month${listing.advance_months === 1 ? "" : "s"}. Enter 0 if you cannot pay an advance now.`}
            error={errors.advance_months_offered}
            type="number"
            min={0}
            max={36}
            step={1}
            required
            value={advanceMonths}
            onChange={(event) => setAdvanceMonths(event.target.value)}
          />
          {shortfall !== null ? (
            <Notice
              tone={shortfall === 0 ? "success" : "info"}
              title={shortfall === 0
                ? "Your offer meets the requested advance"
                : `${shortfall} month${shortfall === 1 ? "" : "s"} below the requested advance`}
              body="This difference is shown to both you and the provider; it does not block your application."
            />
          ) : null}
          <Field label="Preferred move-in date" error={errors.move_in_from} type="date" value={moveInFrom} onChange={(event) => setMoveInFrom(event.target.value)} />
          <Field label="How many people would live here?" error={errors.household_size} type="number" min={1} max={30} step={1} value={householdSize} onChange={(event) => setHouseholdSize(event.target.value)} />
        </section>

        <section style={SECTION}>
          <h2 className="type-title-2" style={{ margin: 0 }}>About your situation</h2>
          <Field label="Occupation" error={errors.occupation} value={occupation} onChange={(event) => setOccupation(event.target.value)} maxLength={120} />
          <Field label="Employer" error={errors.employer} value={employer} onChange={(event) => setEmployer(event.target.value)} maxLength={160} />
          <Select label="Monthly income range" value={incomeBand} onChange={setIncomeBand} options={INCOME_BANDS} hint={errors.income_band || "Optional. A range avoids collecting an exact salary."} />
        </section>

        <section style={SECTION}>
          <h2 className="type-title-2" style={{ margin: 0 }}>Guarantor, if you have one</h2>
          <Field label="Guarantor name" error={errors.guarantor_name} value={guarantorName} onChange={(event) => setGuarantorName(event.target.value)} maxLength={160} />
          <Field label="Guarantor mobile number" hint="Use a Ghana mobile number." error={errors.guarantor_phone} type="tel" value={guarantorPhone} onChange={(event) => setGuarantorPhone(event.target.value)} maxLength={20} />
          <Field label="Relationship to you" error={errors.guarantor_relationship} value={guarantorRelationship} onChange={(event) => setGuarantorRelationship(event.target.value)} maxLength={60} />
        </section>

        <label style={{ display: "grid", gap: "var(--space-2)" }}>
          <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>Message to the provider</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={1000}
            rows={5}
            aria-invalid={Boolean(errors.message)}
            style={TEXTAREA}
          />
          {errors.message ? <span role="alert" className="type-caption" style={{ color: "var(--color-laterite-600)" }}>{errors.message}</span> : null}
        </label>

        {error ? <Notice tone="error" title={error} /> : null}
        <div style={ACTIONS}>
          <Button type="submit" busy={busy}>Submit application</Button>
          <Button type="button" variant="secondary" onClick={() => router.push(`/listings/${listing.id}` as never)}>Back to rental</Button>
        </div>
      </form>
    </main>
  );
}

const SHELL: React.CSSProperties = {
  maxWidth: "44rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-5) var(--space-12)",
};

const FORM: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-6)",
  marginTop: "var(--space-7)",
};

const SECTION: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-200)",
  borderRadius: "var(--radius-md)",
};

const ACTIONS: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-3)",
};

const TEXTAREA: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-3)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-300)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-ink-900)",
  resize: "vertical",
};
