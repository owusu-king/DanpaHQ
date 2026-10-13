"use client";

import { AlertCircle, Check, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ApiFailure } from "@/lib/api";
import {
  confirmEmail,
  getBusinessDetails,
  getTenantDetails,
  removeEmail,
  startEmailVerification,
  updateBusinessDetails,
  updateTenantDetails,
  type BusinessDetails,
  type EmailVerificationStarted,
  type TenantDetails,
} from "@/lib/console";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/lib/formErrors";

/**
 * The rest of a profile, beyond the photo and the names (owner, 2026-10-07).
 *
 * Everything a person can complete or change later, on the same Settings page:
 * an email confirmed by a code, what helps a provider read a tenant's
 * application, and a provider's business details. Each panel saves only what
 * changed, so a save never rewrites what it did not touch.
 */

const sectionStyle: React.CSSProperties = { display: "grid", gap: "var(--space-4)" };

/**
 * Adding, changing or confirming an email address.
 *
 * Inline rather than a dialog: the panel opens into the address, the six digits,
 * and the tick, in place. The address joins the account only on the tick — until
 * then whatever was there before stays — and the panel says so.
 */
export function EmailSection({
  current,
  verified,
  onChanged,
}: {
  current: string | null;
  verified: boolean;
  onChanged: () => Promise<void>;
}) {
  const [step, setStep] = useState<"idle" | "address" | "code" | "done">("idle");
  const [email, setEmail] = useState(current ?? "");
  const [started, setStarted] = useState<EmailVerificationStarted | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (step !== "code" || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn, step]);

  function open() {
    setEmail(current ?? "");
    setError("");
    setCode("");
    setStep("address");
  }

  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await startEmailVerification(email.trim());
      setStarted(result);
      setResendIn(result.resend_in);
      setCode("");
      setStep("code");
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setError(fields.email ?? (cause instanceof ApiFailure ? cause.error.message : "Could not send the code."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(value: string) {
    if (!started) return;
    setBusy(true);
    setError("");
    try {
      await confirmEmail(started.verification_id, value);
      setStep("done");
      await onChanged();
    } catch (cause) {
      setCode("");
      setError(cause instanceof ApiFailure ? cause.error.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await removeEmail();
      await onChanged();
      setStep("idle");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not remove the address.");
    } finally {
      setBusy(false);
    }
  }

  const typed = email.trim().toLowerCase();
  const sameConfirmed = verified && typed === (current ?? "");

  return (
    <section style={sectionStyle}>
      <div className="email-row">
        <span className="email-row-text">
          <strong>{current ?? "No email yet"}</strong>
          {current ? (
            verified ? (
              <span className="email-badge is-good"><CircleCheck aria-hidden="true" />Confirmed</span>
            ) : (
              <span className="email-badge is-waiting"><AlertCircle aria-hidden="true" />Not confirmed yet</span>
            )
          ) : (
            <small className="type-caption">For receipts, agreements and getting back into your account.</small>
          )}
        </span>
        {step === "idle" || step === "done" ? (
          <Button variant="secondary" size="sm" type="button" onClick={open}>
            {!current ? "Add email" : verified ? "Change" : "Confirm or change"}
          </Button>
        ) : null}
      </div>

      {step === "address" ? (
        <form className="email-flow" onSubmit={send}>
          <Field
            label="Email address"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error) setError("");
            }}
            error={error || undefined}
            autoComplete="email"
            autoFocus
            hint={current && verified ? "A new address replaces this one only once its code is confirmed." : "We'll send a six-digit code to confirm it's yours."}
          />
          <div className="email-flow-actions">
            <Button type="submit" busy={busy} busyLabel="Sending…" disabled={!typed || sameConfirmed}>
              Send code
            </Button>
            <Button variant="quiet" type="button" onClick={() => setStep("idle")} disabled={busy}>Cancel</Button>
            {current ? (
              <Button variant="quiet" type="button" onClick={() => void remove()} disabled={busy}>Remove email</Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {step === "code" && started ? (
        <form
          className="email-flow"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length === 6) void confirm(code);
          }}
        >
          <p className="type-caption" style={{ margin: 0 }}>
            We sent six digits to <strong>{started.email}</strong>. It can take a minute — check spam if it does not arrive.
          </p>
          <div key={error} className={error ? "auth-shake" : undefined}>
            <Field
              label="Six-digit code"
              value={code}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(digits);
                if (error) setError("");
                if (digits.length === 6 && !busy) void confirm(digits);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="auth-code"
              error={error || undefined}
              autoFocus
            />
          </div>
          <div className="email-flow-actions">
            <Button type="submit" busy={busy} busyLabel="Checking…" disabled={code.length < 6}>Confirm</Button>
            <Button variant="quiet" type="button" onClick={() => setStep("address")} disabled={busy}>Change address</Button>
            <Button variant="quiet" type="button" onClick={() => void send()} disabled={busy || resendIn > 0}>
              {resendIn > 0 ? `New code in ${resendIn}s` : "Send a new code"}
            </Button>
          </div>
        </form>
      ) : null}

      {step === "done" ? (
        <div className="email-done" role="status">
          <div className="auth-success" aria-hidden="true">
            <span className="auth-success-ring" />
            <span className="auth-success-disc"><Check /></span>
          </div>
          <span><strong>Email confirmed.</strong> It is on your account.</span>
        </div>
      ) : null}
    </section>
  );
}

const INCOME_BANDS = [
  ["", "Choose"],
  ["under_1000", "Under GH₵1,000"],
  ["1000_3000", "GH₵1,000 – 3,000"],
  ["3000_6000", "GH₵3,000 – 6,000"],
  ["6000_10000", "GH₵6,000 – 10,000"],
  ["over_10000", "Over GH₵10,000"],
  ["prefer_not_to_say", "Prefer not to say"],
] as const;

const YES_NO = [
  ["", "Not said"],
  ["yes", "Yes"],
  ["no", "No"],
] as const;

const asYesNo = (value: boolean | null) => (value === null ? "" : value ? "yes" : "no");
const fromYesNo = (value: string) => (value === "" ? null : value === "yes");

/** Only the fields that changed. */
function changed<T extends Record<string, unknown>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] !== before[key]) out[key] = after[key];
  }
  return out;
}

/** What helps a provider read a tenant's application. All optional. */
export function TenantDetailsSection() {
  const [saved, setSaved] = useState<TenantDetails | null>(null);
  const [form, setForm] = useState<TenantDetails | null>(null);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    void getTenantDetails()
      .then((details) => {
        setSaved(details);
        setForm(details);
        setBudget(details.budget_max_minor ? String(Math.round(details.budget_max_minor / 100)) : "");
      })
      .catch(() => setSummary("Could not load these details."));
  }, []);

  if (!form || !saved) {
    return summary ? <Notice tone="error" title={summary} /> : <div className="ws-skeleton-block" aria-busy="true" />;
  }

  const set = <K extends keyof TenantDetails>(key: K, value: TenantDetails[K]) => {
    setDone(false);
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || !saved) return;
    const changes = changed(saved, form);
    if (!Object.keys(changes).length) {
      setDone(true);
      return;
    }
    setBusy(true);
    setErrors({});
    setSummary("");
    try {
      const next = await updateTenantDetails(changes);
      setSaved(next);
      setForm(next);
      setDone(true);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setSummary(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={sectionStyle}>
      <div className="settings-fields-2">
        <Field label="Occupation" value={form.occupation} onChange={(event) => set("occupation", event.target.value)} error={errors.occupation} />
        <Field label="Employer" value={form.employer} onChange={(event) => set("employer", event.target.value)} error={errors.employer} />
      </div>
      <div className="settings-fields-2">
        <Select label="Monthly income" value={form.income_band} onChange={(value) => set("income_band", value)} options={INCOME_BANDS} />
        <Field
          label="Rent budget (GH₵ a month)"
          inputMode="numeric"
          value={budget}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 7);
            setBudget(digits);
            set("budget_max_minor", digits ? Number(digits) * 100 : null);
          }}
          error={errors.budget_max_minor}
        />
      </div>
      <div className="settings-fields-2">
        <Field
          label="Move in from"
          type="date"
          value={form.move_in_from ?? ""}
          onChange={(event) => set("move_in_from", event.target.value || null)}
          error={errors.move_in_from}
        />
        <Field
          label="People in your household"
          type="number"
          min={1}
          max={20}
          value={form.household_size ?? ""}
          onChange={(event) => set("household_size", event.target.value ? Number(event.target.value) : null)}
          error={errors.household_size}
        />
      </div>
      <div className="settings-fields-2">
        <Select label="Pets" value={asYesNo(form.has_pets)} onChange={(value) => set("has_pets", fromYesNo(value))} options={YES_NO} />
        <Select label="Smoker" value={asYesNo(form.smoker)} onChange={(value) => set("smoker", fromYesNo(value))} options={YES_NO} />
      </div>
      {summary ? <Notice tone="error" title={summary} /> : null}
      {done ? <Notice tone="success" title="Saved" /> : null}
      <div><Button type="submit" busy={busy}>Save details</Button></div>
    </form>
  );
}

/** A provider's business, when it is a registered company. */
export function BusinessSection() {
  const [saved, setSaved] = useState<BusinessDetails | null>(null);
  const [form, setForm] = useState<BusinessDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    void getBusinessDetails()
      .then((details) => {
        setSaved(details);
        setForm(details);
      })
      .catch(() => setSummary("Could not load these details."));
  }, []);

  if (!form || !saved) {
    return summary ? <Notice tone="error" title={summary} /> : <div className="ws-skeleton-block" aria-busy="true" />;
  }

  const set = <K extends keyof BusinessDetails>(key: K, value: BusinessDetails[K]) => {
    setDone(false);
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || !saved) return;
    const changes = changed(saved, form);
    if (!Object.keys(changes).length) {
      setDone(true);
      return;
    }
    setBusy(true);
    setErrors({});
    setSummary("");
    try {
      const next = await updateBusinessDetails(changes);
      setSaved(next);
      setForm(next);
      setDone(true);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setSummary(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={sectionStyle}>
      <Select
        label="Do you operate as a registered company?"
        value={form.is_company ? "yes" : "no"}
        onChange={(value) => set("is_company", value === "yes")}
        options={[["no", "No, as myself"], ["yes", "Yes, a registered company"]]}
      />
      {form.is_company ? (
        <div className="settings-fields-2">
          <Field label="Company name" value={form.company_name} onChange={(event) => set("company_name", event.target.value)} error={errors.company_name} />
          <Field
            label="Registration number"
            value={form.company_registration_number}
            onChange={(event) => set("company_registration_number", event.target.value)}
            error={errors.company_registration_number}
          />
        </div>
      ) : null}
      {summary ? <Notice tone="error" title={summary} /> : null}
      {done ? <Notice tone="success" title="Saved" /> : null}
      <div><Button type="submit" busy={busy}>Save details</Button></div>
    </form>
  );
}
