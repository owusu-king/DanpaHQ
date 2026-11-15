"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CreateRentingAccount } from "@/components/portal/CreateRentingAccount";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { Icon, type IconName } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import styles from "./application.module.css";
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
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { state, refresh } = useSession();
  const { toast } = useToast();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [application, setApplication] = useState<MyApplication | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

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
    if (!Object.keys(errors).length) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    const group = invalid?.closest("details");
    if (group) group.open = true;
    invalid?.focus();
  }, [errors]);

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
    if (!id) return;
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
  }, [id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!listing || busy || state.status !== "signed_in") return;

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
      return;
    }

    setBusy(true);
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
      // A cross-field or listing-level restriction has no input to attach to.
      const summary = fields.non_field_errors ?? fields.listing_id;
      delete fields.non_field_errors;
      delete fields.listing_id;
      setErrors(fields);
      const detail = summary ?? summaryErrorFrom(cause, fields);
      if (detail) toast({ tone: "error", title: "Application wasn’t sent", description: detail });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading" || state.status === "signed_out") {
    return <main style={SHELL}><p className="type-caption">Preparing your application…</p></main>;
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
    return <main style={SHELL}><p className="type-caption">Opening your tenant workspace…</p></main>;
  }
  if (loadError || !id) {
    return <ApplicationUnavailable title="This rental couldn’t be opened" message={loadError || "Choose a rental in Explore to start an application."} action={<Link href="/rentals" className="btn btn-primary">Browse rentals</Link>} />;
  }
  if (!listing) {
    return <main style={SHELL}><p className="type-caption">Loading rental details…</p></main>;
  }

  if (application) {
    return (
      <main className={styles.page}>
        <Link href={`/record/listing?id=${listing.id}` as never} className={styles.back}>← Back to rental</Link>
        <section className={styles.receipt} aria-labelledby="application-sent">
          <p className={styles.status}><Icon name="check" /> {application.status_display}</p>
          <h1 id="application-sent" tabIndex={-1} ref={focusReceipt}>Application sent</h1>
          <p className={styles.lede}>The provider has received your application for <strong>{listing.headline}</strong>.</p>
          <dl className={styles.receiptFacts}>
            <div><dt>Advance offered</dt><dd>{months(application.advance_months_offered)}</dd></div>
            <div><dt>Advance requested</dt><dd>{months(application.advance_months_asked)}</dd></div>
          </dl>
          {!application.meets_advance ? <p className={styles.receiptNote}>Your offer is {months(application.advance_shortfall_months)} below the requested advance. The provider can still consider it.</p> : null}
          <div className={styles.next}>
            <h2>What happens next</h2>
            <p>Follow the provider’s response in Applications.</p>
            {state.status === "signed_in" && !state.me.is_phone_verified && state.me.email ? <p>{state.me.is_email_verified ? "We’ll send updates by email." : "Verify your email to receive updates there."}</p> : null}
          </div>
          <Link href={`/applications?application=${encodeURIComponent(application.id)}` as never} className="btn btn-primary">View application status</Link>
        </section>
      </main>
    );
  }

  const offered = advanceMonths === "" ? null : Number(advanceMonths);
  const shortfall = offered === null || !Number.isInteger(offered) || offered < 0 || offered > 36
    ? null
    : Math.max(listing.advance_months - offered, 0);
  const rentalPath = `/record/listing?id=${listing.id}` as const;
  const area = [listing.locality_name, listing.district_name].filter(Boolean).join(", ");
  const photo = listing.cover_url || listing.gallery.find((item) => item.download_url)?.download_url;

  return (
    <main className={styles.page}>
      <Link href={rentalPath} className={styles.back}>← Back to rental</Link>
      <header className={styles.intro}>
        <p className={styles.kicker}>Rentals / Apply</p>
        <h1>Rental application</h1>
        <p className={styles.lede}>Tell the provider what you can offer and when you’d like to move.</p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.summary} aria-label="Rental summary">
          <div className={`${styles.photo}${photo ? "" : ` ${styles.noPhoto}`}`}>
            {photo ? (
              // Signed listing images are served directly from the files service.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" />
            ) : <Icon name="home" />}
          </div>
          <div className={styles.summaryBody}>
            <p className={styles.kicker}>Your rental</p>
            <h2>{listing.headline}</h2>
            {area ? <p className={styles.meta}><Icon name="pin" /> {area}</p> : null}
            <dl className={styles.terms}>
              <div><dt>Rent</dt><dd>{listing.rent_formatted ? `${listing.rent_formatted} / ${listing.rent_period === "yearly" ? "year" : "month"}` : "On request"}</dd></div>
              <div><dt>Advance requested</dt><dd>{listing.advance_label}</dd></div>
            </dl>
          </div>
        </aside>

        <form ref={formRef} onSubmit={submit} className={styles.form} noValidate>
          <section className={styles.section} aria-labelledby="move-title">
            <SectionHeading number="01" id="move-title" title="Your offer" description="Only the rent advance is required." />
            <Field
              label="Advance you can offer (months)"
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
              <Field label="Preferred move-in date" error={errors.move_in_from} type="date" value={moveInFrom} onChange={(event) => setMoveInFrom(event.target.value)} />
              <Field label="Household size" error={errors.household_size} type="number" inputMode="numeric" min={1} max={30} step={1} placeholder="Number of people" value={householdSize} onChange={(event) => setHouseholdSize(event.target.value)} />
            </div>
          </section>

          <section className={styles.section} aria-labelledby="context-title">
            <SectionHeading number="02" id="context-title" title="About your household" description="These details are optional. Share what you’re comfortable providing." />
            <div className={styles.disclosures}>
          <OptionalSection icon="account" title="Work and income">
            <div className={styles.fields}>
              <Field label="Occupation" error={errors.occupation} value={occupation} onChange={(event) => setOccupation(event.target.value)} maxLength={120} />
              <Field label="Employer" error={errors.employer} value={employer} onChange={(event) => setEmployer(event.target.value)} maxLength={160} />
            </div>
            <Select label="Monthly income range" value={incomeBand} onChange={setIncomeBand} options={INCOME_BANDS} error={errors.income_band} />
          </OptionalSection>

          <OptionalSection icon="users" title="Guarantor">
            <div className={styles.fields}>
              <Field label="Guarantor name" error={errors.guarantor_name} value={guarantorName} onChange={(event) => setGuarantorName(event.target.value)} maxLength={160} />
              <Field label="Relationship to you" error={errors.guarantor_relationship} value={guarantorRelationship} onChange={(event) => setGuarantorRelationship(event.target.value)} maxLength={60} />
            </div>
            <Field label="Guarantor mobile number" hint="Use a Ghana mobile number." error={errors.guarantor_phone} type="tel" value={guarantorPhone} onChange={(event) => setGuarantorPhone(event.target.value)} maxLength={20} />
          </OptionalSection>

          <OptionalSection icon="mail" title="Note to the provider">
            <textarea
              aria-label="Note to the provider"
              aria-describedby={errors.message ? "apply-note-error" : undefined}
              aria-invalid={Boolean(errors.message)}
              className={styles.note} value={message} onChange={(event) => setMessage(event.target.value)}
              placeholder="For example, let them know if your move-in date is flexible."
              maxLength={1000} rows={4}
            />
            <div className={styles.noteMeta}>
              {errors.message ? <span id="apply-note-error" role="alert" className="type-caption field-error">{errors.message}</span> : null}
              <span className="type-caption">{message.length} / 1,000</span>
            </div>
          </OptionalSection>
            </div>
          </section>

          <div className={styles.submit}>
            <p><Icon name="info" /> The provider will receive these details for review. Sending an application doesn’t commit you to a tenancy.</p>
            <Button type="submit" busy={busy} busyLabel="Sending…">Submit application</Button>
          </div>
        </form>
      </div>
    </main>
  );
}

function SectionHeading({ number, id, title, description }: { number: string; id: string; title: string; description: string }) {
  return <header className={styles.sectionHeading}>
    <span className={styles.number} aria-hidden="true">{number}</span>
    <div><h2 id={id}>{title}</h2><p>{description}</p></div>
  </header>;
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

function months(count: number) {
  return `${count} month${count === 1 ? "" : "s"}`;
}

function focusReceipt(node: HTMLHeadingElement | null) {
  node?.focus();
}

function ApplicationUnavailable({ title, message, action }: { title: string; message: string; action: ReactNode }) {
  return <main style={SHELL}>
    <h1 className="type-title-2">{title}</h1>
    <Notice tone="error" title={title} body={message} />
    <div className={styles.recovery}>{action}</div>
  </main>;
}

const SHELL: React.CSSProperties = {
  maxWidth: "44rem",
  margin: "0 auto",
  padding: "var(--space-8) var(--space-5) var(--space-12)",
};
