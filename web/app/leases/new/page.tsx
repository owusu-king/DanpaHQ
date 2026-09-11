"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Check } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import {
  draftLease,
  leaseAction,
  updateLease,
  type Lease,
  type LeaseStructuredTerms,
  type RenderedAgreement,
} from "@/lib/console";

/**
 * Preparing a tenancy agreement, on a wide screen.
 *
 * The same seven stops and the same backend rendering as the mobile builder —
 * deliberately, because the agreement must not depend on which client prepared
 * it. What the width buys is that the generated document can be read properly
 * at Review rather than squinted at, which is the argument for preparing one
 * here at all.
 *
 * **The provider supplies terms; Rooomly writes the agreement.** Standard
 * clauses belong to the versioned template and cannot be edited from this form.
 * Custom wording is a separate, clearly labelled section, so what a provider
 * added stays distinguishable from what Rooomly's template said.
 *
 * **Ready and Sent are two different acts.** Reaching Review marks the lease
 * Ready; sending is a separate deliberate press, because an offer is the
 * provider's acceptance and should not be the side effect of finishing a form.
 */
const STEPS = [
  "Parties",
  "Property & Unit",
  "Term",
  "Rent & payments",
  "Responsibilities",
  "Additional terms",
  "Review",
] as const;

const RESPONSIBILITIES = [
  ["structural_repairs", "Structural repairs"],
  ["shared_areas", "Shared areas"],
  ["property_rates", "Property rates"],
  ["routine_cleaning", "Routine cleaning"],
  ["minor_consumables", "Minor consumables"],
  ["report_damage", "Report damage promptly"],
  ["respect_neighbours", "Respect neighbours"],
  ["residential_use", "Residential use only"],
] as const;

type FormState = {
  rent: string;
  rentPeriod: "monthly" | "yearly";
  advance: string;
  deposit: string;
  agencyFee: string;
  startsOn: string;
  term: string;
  paymentDue: string;
  water: UtilityParty;
  electricity: UtilityParty;
  providerResponsibilities: string[];
  tenantResponsibilities: string[];
  occupants: string;
  conditions: string;
  customTitle: string;
  customBody: string;
};

type UtilityParty = "tenant" | "provider" | "included" | "shared" | "not_applicable";

export default function NewLeasePage() {
  return (
    <Suspense
      fallback={
        <main className="lease-builder">
          <p>Preparing the agreement builder…</p>
        </main>
      }
    >
      <LeaseBuilder />
    </Suspense>
  );
}

function LeaseBuilder() {
  const router = useRouter();
  const search = useSearchParams();
  const [step, setStep] = useState(0);
  const [lease, setLease] = useState<Lease | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>({
    rent: Number(search.get("rentMinor")) > 0 ? String(Number(search.get("rentMinor")) / 100) : "",
    rentPeriod: "monthly",
    advance: search.get("advanceMonths") || "1",
    deposit: "0",
    agencyFee: "0",
    startsOn: "",
    term: "12",
    paymentDue: "on the first day of each rental period",
    water: "tenant",
    electricity: "tenant",
    providerResponsibilities: ["structural_repairs", "shared_areas", "property_rates"],
    tenantResponsibilities: [
      "routine_cleaning",
      "report_damage",
      "respect_neighbours",
      "residential_use",
    ],
    occupants: "",
    conditions: "",
    customTitle: "",
    customBody: "",
  });

  const structured = useMemo<LeaseStructuredTerms>(
    () => ({
      payment_due: form.paymentDue,
      utilities: { water: form.water, electricity: form.electricity },
      occupants: form.occupants
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      provider_responsibilities: form.providerResponsibilities,
      tenant_responsibilities: form.tenantResponsibilities,
      notice_channels: ["Rooomly", "written notice"],
      additional_terms:
        form.customTitle.trim() && form.customBody.trim()
          ? [{ title: form.customTitle.trim(), body: form.customBody.trim() }]
          : [],
    }),
    [form],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggle(key: "providerResponsibilities" | "tenantResponsibilities", value: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  }

  function validateCurrent(): string {
    if (step === 2 && !form.startsOn) return "Choose when the tenancy starts.";
    if (step === 2 && Number(form.term) < 1) return "Enter a valid term.";
    if (step === 3 && Number(form.rent) <= 0) return "Enter the rent amount.";
    if (
      step === 4 &&
      (!form.providerResponsibilities.length || !form.tenantResponsibilities.length)
    ) {
      return "Choose responsibilities for both parties.";
    }
    if (step === 5 && Boolean(form.customTitle.trim()) !== Boolean(form.customBody.trim())) {
      return "Give the additional term both a title and its complete wording.";
    }
    return "";
  }

  async function prepareReview() {
    const issue = validateCurrent();
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      rent_minor: Math.round(Number(form.rent) * 100),
      rent_currency: "GHS",
      rent_period: form.rentPeriod,
      advance_months: Number(form.advance || 0),
      deposit_months: Number(form.deposit || 0),
      agency_fee_months: Number(form.agencyFee || 0),
      starts_on: form.startsOn,
      term_months: Number(form.term),
      conditions: form.conditions,
      structured_terms: structured,
    } as const;
    try {
      let current = lease;
      if (current) {
        current = await updateLease(current.id, payload);
      } else {
        current = await draftLease({
          workflow_version: "canonical_v1",
          unit_id: required(search, "unitId"),
          bed_id: search.get("bedId") || undefined,
          tenant_id: required(search, "tenantId"),
          join_request_id:
            search.get("sourceKind") === "join_request" ? required(search, "sourceId") : undefined,
          application_id:
            search.get("sourceKind") === "application" ? required(search, "sourceId") : undefined,
          listing_id: search.get("listingId") || undefined,
          ...payload,
        });
      }
      current = await leaseAction(current.id, "ready");
      setLease(current);
      setStep(6);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "We could not prepare the agreement preview.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendAgreement() {
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      const sent = await leaseAction(lease.id, "offer");
      router.replace(`/leases/${sent.id}` as never);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not send the agreement.",
      );
    } finally {
      setBusy(false);
    }
  }

  function next() {
    const issue = validateCurrent();
    if (issue) {
      setError(issue);
      return;
    }
    setError("");
    if (step === 5) void prepareReview();
    else setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  return (
    <main className="lease-builder">
      <header className="lease-builder-head">
        <p className="type-label">AGREEMENT BUILDER</p>
        <h1 className="type-display-2">Prepare the tenancy agreement</h1>
        <p>
          Known identities and rental details stay connected to the accepted request. You only set
          the negotiable terms.
        </p>
      </header>

      <nav className="lease-checkpoints" aria-label="Agreement sections">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-current={index === step ? "step" : undefined}
            disabled={index > step || busy}
            onClick={() => setStep(index)}
          >
            <span>{index < step ? "✓" : index + 1}</span>
            <small>{label}</small>
          </button>
        ))}
      </nav>

      <div className="lease-builder-stage">
        <section className="lease-builder-form" aria-labelledby="lease-step-title">
          <p className="type-caption">
            {step + 1} of {STEPS.length}
          </p>
          <h2 id="lease-step-title" className="type-title-1">
            {STEPS[step]}
          </h2>
          {step === 0 ? <IdentityStep /> : null}
          {step === 1 ? <HomeStep /> : null}
          {step === 2 ? <TermStep form={form} update={update} /> : null}
          {step === 3 ? <PaymentsStep form={form} update={update} /> : null}
          {step === 4 ? <ResponsibilitiesStep form={form} update={update} toggle={toggle} /> : null}
          {step === 5 ? <AdditionalStep form={form} update={update} /> : null}
          {step === 6 ? (
            <ReviewStep
              document={lease?.builder_preview?.rendered_document ?? null}
              onEdit={setStep}
            />
          ) : null}
          {error ? <Notice tone="error" title={error} /> : null}
          <div className="lease-builder-actions">
            {step > 0 ? (
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => setStep((current) => current - 1)}
              >
                Back
              </Button>
            ) : (
              <Button variant="quiet" onClick={() => router.back()}>
                Exit builder
              </Button>
            )}
            {step < 6 ? (
              <Button busy={busy} busyLabel="Generating preview…" onClick={next}>
                {step === 5 ? "Generate agreement" : "Continue"}
              </Button>
            ) : (
              <Button busy={busy} busyLabel="Sending…" onClick={() => void sendAgreement()}>
                Send to tenant
              </Button>
            )}
          </div>
        </section>
        <aside className="lease-builder-aside" aria-label="Agreement safeguards">
          <strong>Rooomly standard</strong>
          <p>
            Standard clauses are controlled by the selected template release. Additional terms are
            labelled separately and never overwrite the standard.
          </p>
          <span>
            Template wording requires Ghana-qualified legal approval before production release.
          </span>
        </aside>
      </div>
    </main>
  );
}

function IdentityStep() {
  return (
    <div className="lease-step-copy">
      <p>The provider and tenant come from their verified Rooomly accounts.</p>
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>Current provider account</dd>
        </div>
        <div>
          <dt>Tenant</dt>
          <dd>Accepted tenancy request</dd>
        </div>
      </dl>
      <small>These identities will be copied into the frozen agreement.</small>
    </div>
  );
}

function HomeStep() {
  return (
    <div className="lease-step-copy">
      <p>The Property, Unit and any selected bed stay linked to the approved request.</p>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>Accepted Rooomly request</dd>
        </div>
        <div>
          <dt>Rental space</dt>
          <dd>Selected Property and Unit</dd>
        </div>
      </dl>
      <small>You do not need to re-enter an address or unit description.</small>
    </div>
  );
}

type UpdateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

function TermStep({ form, update }: { form: FormState; update: UpdateForm }) {
  return (
    <div className="lease-field-grid">
      <Field
        autoFocus
        label="Tenancy starts"
        type="date"
        value={form.startsOn}
        onChange={(e) => update("startsOn", e.target.value)}
      />
      <Field
        label="Length (months)"
        inputMode="numeric"
        value={form.term}
        onChange={(e) => update("term", e.target.value.replace(/\D/g, ""))}
      />
    </div>
  );
}

function PaymentsStep({ form, update }: { form: FormState; update: UpdateForm }) {
  return (
    <div className="lease-field-grid">
      <Field
        autoFocus
        label="Rent (GH₵)"
        inputMode="decimal"
        value={form.rent}
        onChange={(e) => update("rent", e.target.value.replace(/[^0-9.]/g, ""))}
      />
      <label className="lease-select">
        <span>Payment frequency</span>
        <select
          value={form.rentPeriod}
          onChange={(e) => update("rentPeriod", e.target.value as FormState["rentPeriod"])}
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <Field
        label="Advance (months)"
        inputMode="numeric"
        value={form.advance}
        onChange={(e) => update("advance", e.target.value.replace(/\D/g, ""))}
      />
      <Field
        label="Deposit (months)"
        inputMode="numeric"
        value={form.deposit}
        onChange={(e) => update("deposit", e.target.value.replace(/\D/g, ""))}
      />
      <Field
        label="Agency fee (months)"
        inputMode="numeric"
        value={form.agencyFee}
        onChange={(e) => update("agencyFee", e.target.value.replace(/\D/g, ""))}
      />
      <Field
        label="Payment due"
        value={form.paymentDue}
        onChange={(e) => update("paymentDue", e.target.value)}
      />
    </div>
  );
}

function ResponsibilitiesStep({
  form,
  update,
  toggle,
}: {
  form: FormState;
  update: UpdateForm;
  toggle: (key: "providerResponsibilities" | "tenantResponsibilities", value: string) => void;
}) {
  return (
    <div className="lease-responsibilities">
      <div>
        <h3>Utilities</h3>
        <UtilitySelect
          label="Water"
          value={form.water}
          onChange={(value) => update("water", value)}
        />
        <UtilitySelect
          label="Electricity"
          value={form.electricity}
          onChange={(value) => update("electricity", value)}
        />
      </div>
      <div>
        <h3>Provider</h3>
        {RESPONSIBILITIES.slice(0, 3).map(([value, label]) => (
          <Check
            key={value}
            label={label}
            checked={form.providerResponsibilities.includes(value)}
            onChange={() => toggle("providerResponsibilities", value)}
          />
        ))}
      </div>
      <div>
        <h3>Tenant</h3>
        {RESPONSIBILITIES.slice(3).map(([value, label]) => (
          <Check
            key={value}
            label={label}
            checked={form.tenantResponsibilities.includes(value)}
            onChange={() => toggle("tenantResponsibilities", value)}
          />
        ))}
      </div>
    </div>
  );
}

function AdditionalStep({ form, update }: { form: FormState; update: UpdateForm }) {
  return (
    <div className="lease-text-fields">
      <label>
        <span>
          Other permitted occupants <small>one name per line</small>
        </span>
        <textarea
          rows={4}
          value={form.occupants}
          onChange={(e) => update("occupants", e.target.value)}
        />
      </label>
      <label>
        <span>
          Practical conditions <small>optional</small>
        </span>
        <textarea
          rows={4}
          value={form.conditions}
          onChange={(e) => update("conditions", e.target.value)}
        />
      </label>
      <div className="lease-custom-term">
        <p>
          <strong>Additional custom term</strong>
          <br />
          <small>Shown as provider-supplied wording, separate from Rooomly standard clauses.</small>
        </p>
        <Field
          label="Term title"
          value={form.customTitle}
          onChange={(e) => update("customTitle", e.target.value)}
        />
        <label>
          <span>Complete wording</span>
          <textarea
            rows={5}
            value={form.customBody}
            onChange={(e) => update("customBody", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function ReviewStep({
  document,
  onEdit,
}: {
  document: RenderedAgreement | null;
  onEdit: (step: number) => void;
}) {
  if (!document) return <p>Generating the agreement from the selected terms…</p>;
  return (
    <article className="lease-document">
      <header>
        <p>{document.reference_number}</p>
        <h3>{document.title}</h3>
        <span>Template {document.template.version}</span>
      </header>
      {document.production_notice ? (
        <Notice
          tone="warning"
          title="Pre-production legal review"
          body={document.production_notice}
        />
      ) : null}
      <div className="lease-review-edits">
        <button type="button" onClick={() => onEdit(2)}>
          Edit term
        </button>
        <button type="button" onClick={() => onEdit(3)}>
          Edit payments
        </button>
        <button type="button" onClick={() => onEdit(4)}>
          Edit responsibilities
        </button>
        <button type="button" onClick={() => onEdit(5)}>
          Edit additional terms
        </button>
      </div>
      {document.sections.map((section) => (
        <section key={section.id}>
          <h4>{section.title}</h4>
          <p>{section.body}</p>
        </section>
      ))}
    </article>
  );
}

function UtilitySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: UtilityParty;
  onChange: (value: UtilityParty) => void;
}) {
  return (
    <label className="lease-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as UtilityParty)}>
        <option value="tenant">Tenant pays</option>
        <option value="provider">Provider pays</option>
        <option value="included">Included in rent</option>
        <option value="shared">Shared</option>
        <option value="not_applicable">Not applicable</option>
      </select>
    </label>
  );
}

function required(search: { get(key: string): string | null }, key: string): string {
  const value = search.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
