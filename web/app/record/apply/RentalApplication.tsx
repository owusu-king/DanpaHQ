"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { CreateRentingAccount } from "@/components/portal/CreateRentingAccount";
import { Button } from "@/components/Button";
import { StepProgress, type WizardStep } from "@/components/creation/WizardShell";
import { Field, Textarea } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { Icon, type IconName } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import styles from "./application.module.css";
import { ApiFailure } from "@/lib/api";
import { getTenantDetails } from "@/lib/console";
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

const STEPS = [
  { key: "offer", label: "Offer", icon: "home" },
  { key: "household", label: "Household", icon: "users" },
  { key: "review", label: "Review", icon: "eye" },
] as const satisfies readonly Pick<WizardStep, "key" | "label" | "icon">[];

const OFFER_FIELDS = ["advance_months_offered", "move_in_from", "household_size"];

/**
 * The tenant's application claim, sent to the existing application domain.
 *
 * This is deliberately separate from a viewing request. Someone may apply
 * after a remote viewing, before travelling, or without asking for a viewing;
 * neither action silently performs the other.
 */
export function RentalApplication({ id, initialListing, onClose, onSent }: {
  id: string;
  initialListing?: ListingDetail;
  onClose?: () => void;
  onSent?: (application: MyApplication) => void;
}) {
  const router = useRouter();
  const { state, refresh } = useSession();
  const [listing, setListing] = useState<ListingDetail | null>(initialListing ?? null);
  const [loadError, setLoadError] = useState("");
  const [stage, setStage] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const [listingAttempt, setListingAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [application, setApplication] = useState<MyApplication | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const touched = useRef(new Set<string>());
  const focusStep = useRef(false);
  const focusInvalid = useRef(false);
  const nextStage = useRef<number | null>(null);

  const [advanceMonths, setAdvanceMonths] = useState(initialListing ? String(initialListing.advance_months) : "");
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
    const panel = formRef.current?.querySelector<HTMLElement>("[data-stage]:not([hidden])");
    const invalid = focusInvalid.current ? panel?.querySelector<HTMLElement>('[aria-invalid="true"]') : null;
    if (invalid) {
      const group = invalid.closest("details");
      if (group) group.open = true;
      invalid.focus();
    } else if (focusStep.current) {
      panel?.querySelector<HTMLElement>("h2")?.focus();
    }
    focusStep.current = false;
    focusInvalid.current = false;
  }, [errors, stage]);

  useEffect(() => {
    if (state.status === "signed_out") {
      const next = `/record/apply?id=${encodeURIComponent(id)}`;
      router.replace(`/sign-in?workspace=tenant&next=${encodeURIComponent(next)}` as never);
    }
  }, [id, router, state.status]);

  useEffect(() => {
    if (
      state.status !== "signed_in"
      || !state.me.capabilities.tenant.workspace_access
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
    if (!id || initialListing) return;
    let current = true;
    setLoadError("");
    setListing(null);
    getPublicListing(id)
      .then((row) => {
        if (!current) return;
        setListing(row);
        setAdvanceMonths(String(row.advance_months));
      })
      .catch((cause) => {
        if (!current) return;
        setLoadError(
          cause instanceof ApiFailure
            ? cause.error.message
            : "We could not load this rental.",
        );
      });
    return () => { current = false; };
  }, [id, initialListing, listingAttempt]);

  const tenantId = state.status === "signed_in" && state.me.capabilities.active_workspace === "tenant" ? state.me.id : null;
  useEffect(() => {
    if (!tenantId || !listing) return;
    const frame = requestAnimationFrame(() => firstField.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [tenantId, listing]);
  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    void getTenantDetails().then((profile) => {
      if (!active) return;
      if (!touched.current.has("occupation")) setOccupation(profile.occupation || "");
      if (!touched.current.has("employer")) setEmployer(profile.employer || "");
      if (!touched.current.has("household_size") && profile.household_size && profile.household_size <= 30) setHouseholdSize(String(profile.household_size));
      if (!touched.current.has("move_in_from")) setMoveInFrom(profile.move_in_from || "");
      if (!touched.current.has("income_band") && INCOME_BANDS.some(([key]) => key === profile.income_band)) setIncomeBand(profile.income_band);
    }).catch(() => { /* The application can be completed manually. */ });
    return () => { active = false; };
  }, [tenantId]);

  function track(field: string, value: string, set: (value: string) => void) {
    touched.current.add(field);
    set(value);
  }

  function showStage(index: number) {
    focusStep.current = index !== stage;
    setStage(index);
  }

  function validateOffer() {
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
    return localErrors;
  }

  function validateField(field: string) {
    const error = validateOffer()[field];
    setErrors((current) => {
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!listing || busy || state.status !== "signed_in") return;

    setSubmitError("");
    const localErrors = validateOffer();
    const offered = Number(advanceMonths);
    const household = householdSize === "" ? undefined : Number(householdSize);
    const requestedStage = nextStage.current;
    nextStage.current = null;
    if (Object.keys(localErrors).length) {
      focusInvalid.current = true;
      setErrors(localErrors);
      showStage(0);
      return;
    }

    setErrors({});
    if (stage < 2) {
      setCompleted((previous) => Math.max(previous, stage + 1));
      showStage(requestedStage ?? stage + 1);
      return;
    }

    setBusy(true);
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
      onSent?.(created);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      // A cross-field or listing-level restriction has no input to attach to.
      const summary = fields.non_field_errors ?? fields.listing_id;
      delete fields.non_field_errors;
      delete fields.listing_id;
      setErrors(fields);
      const detail = summary ?? summaryErrorFrom(cause, fields);
      if (detail) setSubmitError(detail);
      if (Object.keys(fields).length) {
        focusInvalid.current = true;
        const target = OFFER_FIELDS.some((field) => fields[field]) ? 0 : 1;
        setCompleted(target);
        showStage(target);
      }
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading" || state.status === "signed_out") {
    return <main style={SHELL}><p className="type-caption" role="status">Preparing your application…</p></main>;
  }
  if (state.status === "unavailable") {
    return <ApplicationUnavailable title="We couldn’t confirm your session" message="Try again to reopen your application." action={<Button type="button" onClick={() => void refresh()}>Try again</Button>} />;
  }
  if (state.status === "signed_in" && !state.me.capabilities.tenant.workspace_access) {
    return <main style={SHELL}><h1 className="type-title-2">Apply with a renting account</h1><p className="type-body">Create your own renting account to continue with this application.</p><CreateRentingAccount /></main>;
  }
  if (workspaceError) {
    return <ApplicationUnavailable title="Your renting workspace didn’t open" message={workspaceError} action={<Button type="button" onClick={() => setWorkspaceError("")}>Try again</Button>} />;
  }
  if (
    switchingWorkspace
    || (state.status === "signed_in" && state.me.capabilities.active_workspace !== "tenant")
  ) {
    return <main style={SHELL}><p className="type-caption" role="status">Opening your tenant workspace…</p></main>;
  }
  if (loadError || !id) {
    return (
      <ApplicationUnavailable
        title="This rental couldn’t be opened"
        message={loadError || "Choose a rental in Explore to start an application."}
        action={
          <>
            {id ? <Button type="button" onClick={() => setListingAttempt((previous) => previous + 1)}>Try again</Button> : null}
            <Link href="/rentals" className={id ? "btn btn-quiet" : "btn btn-primary"}>Browse rentals</Link>
          </>
        }
      />
    );
  }
  if (!listing) {
    return <main style={SHELL}><p className="type-caption" role="status">Loading rental details…</p></main>;
  }

  const rentalPath = "/record/listing?id=" + encodeURIComponent(listing.id);
  const leave = onClose ?? (() => router.replace(rentalPath as never));
  const period = listing.rent_period === "yearly" ? "year" : "month";
  const rent = listing.rent_formatted ? listing.rent_formatted + " / " + period : "Rent on request";
  const unit = listing.space?.label || listing.headline;
  const property = listing.property_context?.title || listing.headline;

  if (application) {
    return (
      <ModalSheet open restoreFocus onClose={leave} size="sm" icon="check" title="Application sent"
        className="rental-application-sheet is-receipt"
        footer={() => <Link href={("/applications?application=" + encodeURIComponent(application.id)) as never} className="btn btn-primary">View application status</Link>}>
        <section className={styles.receipt}>
          <h3 tabIndex={-1} ref={focusReceipt}>The provider has your application</h3>
          <p>Your application for {listing.headline} has been sent. Follow the provider’s response in Applications.</p>
          {!application.meets_advance ? <p>Your offer is {months(application.advance_shortfall_months)} below the requested advance. The provider can still consider it.</p> : null}
          {state.status === "signed_in" && !state.me.is_phone_verified && state.me.email ? <p>{state.me.is_email_verified ? "We’ll send updates by email." : "Verify your email to receive updates there."}</p> : null}
        </section>
      </ModalSheet>
    );
  }

  const offered = advanceMonths === "" ? null : Number(advanceMonths);
  const shortfall = offered === null || !Number.isInteger(offered) || offered < 0 || offered > 36
    ? null
    : Math.max(listing.advance_months - offered, 0);

  return (
    <ModalSheet
      open restoreFocus onClose={leave} icon="home" title={"Apply for " + unit} meta={property + " · " + rent}
      size="sm" className="rental-application-sheet" closeLabel="Close application"
      closeDisabled={busy}
      beforeClose={() => touched.current.size === 0 || window.confirm("Discard this application draft?")}
      footer={(close) => (
        <>
          <Button variant="quiet" type="button" disabled={busy} onClick={close}>Cancel</Button>
          {stage > 0 ? <Button variant="quiet" type="button" disabled={busy} onClick={() => showStage(stage - 1)}>Back</Button> : null}
          <Button type="submit" form={formId} busy={busy} busyLabel="Sending…"
            disabled={stage === 2 && Object.keys(validateOffer()).length > 0}>
            {stage === 2 ? "Submit application" : stage === 1 ? "Review application" : "Continue"}
          </Button>
        </>
      )}
    >
      <aside className={styles.summary} aria-label="Rental summary">
        <span>{unit}</span>
        <span>{rent}</span>
        {moveInFrom ? <span>Move in {formatMoveIn(moveInFrom)}</span> : null}
      </aside>
      <form id={formId} ref={formRef} onSubmit={submit} className={styles.form} noValidate aria-busy={busy}
        onChangeCapture={() => touched.current.add("application")}>
          <StepProgress
            label="Application steps"
            steps={STEPS.map((step, index) => ({ ...step, done: index < completed, reachable: !busy && index <= completed }))}
            current={STEPS[stage]!.key}
            onGo={(key) => {
              const index = STEPS.findIndex((step) => step.key === key);
              if (index > stage) {
                nextStage.current = index;
                formRef.current?.requestSubmit();
              }
              else showStage(index);
            }}
          />
          {submitError ? <Notice tone="error" inline title="Application wasn’t sent" body={submitError} /> : null}
          <section data-stage className={styles.section} hidden={stage !== 0} aria-labelledby="move-title">
            <SectionHeading id="move-title" title="Your offer" description="Only the rent advance is required." />
            <Field
              ref={firstField}
              label="Advance you can offer (months)"
              onBlur={() => validateField("advance_months_offered")}
              hint="Enter 0 if you can’t pay any rent in advance."
              error={errors.advance_months_offered}
              type="number" inputMode="numeric" min={0} max={36} step={1} required
              value={advanceMonths} onChange={(event) => setAdvanceMonths(event.target.value)}
            />
            <div aria-live="polite">
              {shortfall !== null ? (
                <p className={`${styles.offer} ${shortfall ? styles.offerShort : ""}`}>
                  <Icon name={shortfall ? "info" : "check"} />
                  <span>{shortfall
                    ? `${shortfall} month${shortfall === 1 ? "" : "s"} below the requested advance. You can still apply.`
                    : "Your offer meets the requested advance."}</span>
                </p>
              ) : null}
            </div>
            <div className={styles.fields}>
              <Field label="Preferred move-in date" error={errors.move_in_from} type="date" value={moveInFrom} onChange={(event) => track("move_in_from", event.target.value, setMoveInFrom)} />
              <Field label="Household size" error={errors.household_size} type="number" inputMode="numeric" min={1} max={30} step={1} placeholder="Number of people" value={householdSize} onBlur={() => validateField("household_size")} onChange={(event) => track("household_size", event.target.value, setHouseholdSize)} />
            </div>
          </section>

          <section data-stage className={styles.section} hidden={stage !== 1} aria-labelledby="context-title">
            <SectionHeading id="context-title" title="Household details" description="These fields are optional. If you leave a field blank, details on your tenant profile may be used." />
            <div className={styles.disclosures}>
              <OptionalSection icon="account" title="Work and income">
                <div className={styles.fields}>
                  <Field label="Occupation" error={errors.occupation} value={occupation} onChange={(event) => track("occupation", event.target.value, setOccupation)} maxLength={120} />
                  <Field label="Employer" error={errors.employer} value={employer} onChange={(event) => track("employer", event.target.value, setEmployer)} maxLength={160} />
                </div>
                <Select label="Monthly income range" value={incomeBand} onChange={(value) => track("income_band", value, setIncomeBand)} options={INCOME_BANDS} error={errors.income_band} />
              </OptionalSection>

              <OptionalSection icon="users" title="Guarantor">
                <div className={styles.fields}>
                  <Field label="Guarantor name" error={errors.guarantor_name} value={guarantorName} onChange={(event) => setGuarantorName(event.target.value)} maxLength={160} />
                  <Field label="Relationship to you" error={errors.guarantor_relationship} value={guarantorRelationship} onChange={(event) => setGuarantorRelationship(event.target.value)} maxLength={60} />
                </div>
                <Field label="Guarantor mobile number" hint="Use a Ghana mobile number." error={errors.guarantor_phone} type="tel" value={guarantorPhone} onChange={(event) => setGuarantorPhone(event.target.value)} maxLength={20} />
              </OptionalSection>

              <OptionalSection icon="mail" title="Note to the provider">
                <Textarea
                  label="Your note" error={errors.message} value={message} onChange={(event) => setMessage(event.target.value)}
                  placeholder="For example, let them know if your move-in date is flexible."
                  maxLength={1000} rows={4}
                />
                <p className={styles.noteMeta}>{message.length} / 1,000</p>
              </OptionalSection>
            </div>
          </section>

          <section data-stage className={styles.section} hidden={stage !== 2} aria-labelledby="review-title">
            <SectionHeading id="review-title" title="Review your application" description="Check the details the provider will receive before you send." />
            <ReviewGroup disabled={busy} title="Your offer" onEdit={() => showStage(0)} rows={[
              ["Advance offered", months(Number(advanceMonths))],
              ["Preferred move-in date", moveInFrom ? formatMoveIn(moveInFrom) : ""],
              ["Household size", householdSize],
            ]} />
            {shortfall ? <p className={styles.receiptNote}>Your offer is {months(shortfall)} below the requested advance. You can still apply.</p> : null}
            <ReviewGroup disabled={busy} title="Household details" onEdit={() => showStage(1)} rows={[
              ["Occupation", occupation.trim()],
              ["Employer", employer.trim()],
              ["Monthly income range", incomeBand ? INCOME_BANDS.find(([key]) => key === incomeBand)?.[1] ?? "" : ""],
              ["Guarantor name", guarantorName.trim()],
              ["Guarantor mobile number", guarantorPhone.trim()],
              ["Relationship to guarantor", guarantorRelationship.trim()],
              ["Note to the provider", message.trim()],
            ]} />
            <p className={styles.receiptNote}>Details from your tenant profile may be included where you left fields blank.</p>
          </section>

      </form>
    </ModalSheet>
  );
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return <header className={styles.sectionHeading}>
    <h2 id={id} tabIndex={-1}>{title}</h2><p>{description}</p>
  </header>;
}

function ReviewGroup({ disabled, title, onEdit, rows }: { disabled: boolean; title: string; onEdit: () => void; rows: [string, string][] }) {
  const provided = rows.filter(([, value]) => value);
  return (
    <div className={styles.reviewGroup}>
      <div className={styles.reviewHead}>
        <h3>{title}</h3>
        <Button type="button" variant="quiet" size="sm" disabled={disabled} aria-label={`Edit ${title.toLowerCase()}`} onClick={onEdit}>Edit</Button>
      </div>
      {provided.length ? (
        <dl>{provided.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
      ) : <p>No optional details added.</p>}
    </div>
  );
}

function OptionalSection({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <details className={styles.optional}>
    <summary>
      <Icon name={icon} />
      <strong>{title}</strong>
      <Icon name="chevron-down" />
    </summary>
    <div className={styles.optionalBody}>{children}</div>
  </details>;
}

function formatMoveIn(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function months(count: number) {
  return `${count} month${count === 1 ? "" : "s"}`;
}

function focusReceipt(node: HTMLHeadingElement | null) {
  node?.focus();
}

function ApplicationUnavailable({ title, message, action }: { title: string; message: string; action: ReactNode }) {
  return <main style={SHELL}>
    <h1 className="type-title-2">{title}</h1>
    <Notice tone="error" inline title={title} body={message} />
    <div className={styles.recovery}>{action}</div>
  </main>;
}

const SHELL: React.CSSProperties = {
  maxWidth: "44rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-5) var(--space-12)",
};
