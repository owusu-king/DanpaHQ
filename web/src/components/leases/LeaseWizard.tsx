"use client";

/**
 * Preparing a tenancy agreement, one decision at a time.
 *
 * Six stops instead of seven: the parties and the rental space were two pages
 * of placeholder text ("Current provider account"), so they are one page of the
 * real names now, read from the accepted request. The rail on the left keeps
 * every step in view with what was chosen there, so the agreement builds up in
 * front of the person making it and any step is one press away.
 *
 * Nothing about the agreement moved. It is the same payload to the same
 * endpoints as the builder page it came from — `draftLease` or `updateLease`,
 * then `ready` to render it, then a separate, deliberate `offer` — and the
 * backend still writes the document from its versioned template. Standard
 * clauses cannot be edited here; custom wording stays a labelled section.
 *
 * It opens inside the request's modal (the same sheet, widened), inside its own
 * sheet from a full-page request, and on `/record/lease-new` for a direct link.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Icon, type IconName } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import {
  draftLease,
  getPortfolioContracts,
  leaseAction,
  listOrganizations,
  updateLease,
  type Lease,
  type LeaseStructuredTerms,
  type RenderedAgreement,
  type TermsTemplate,
} from "@/lib/console";
import { useSession } from "@/lib/session";

/** What the wizard needs to know about the agreement it is preparing. */
export type LeaseSpec = {
  unitId: string;
  bedId: string | null;
  tenantId: string;
  source: { kind: "join_request" | "application"; id: string; listingId?: string };
  initialRentMinor?: number;
  initialAdvanceMonths?: number;
  /** Who and where, as the request knows them. Shown, never sent: the backend
   *  copies the parties and the space from its own records. */
  context?: {
    tenantName?: string;
    tenantVerified?: boolean;
    providerName?: string;
    propertyTitle?: string;
    unitLabel?: string;
    bedLabel?: string | null;
    locality?: string | null;
    photoUrl?: string | null;
    sourceLabel?: string;
    advanceAsked?: number;
  };
  /** An agreement already saved against this request, to carry on from. */
  lease?: Lease | null;
};

const STEPS: { key: string; label: string; hint: string; icon: IconName }[] = [
  { key: "parties", label: "Parties", hint: "Who signs, and what is let.", icon: "users" },
  { key: "term", label: "Term", hint: "When it starts and how long it runs.", icon: "clock" },
  { key: "money", label: "Rent & payments", hint: "What is paid, and when.", icon: "payments" },
  { key: "duties", label: "Responsibilities", hint: "Utilities, and who looks after what.", icon: "shield" },
  { key: "extra", label: "Additional terms", hint: "Occupants, conditions and your own wording.", icon: "details" },
  { key: "review", label: "Review & send", hint: "The agreement as the tenant will read it.", icon: "leases" },
];
const REVIEW = STEPS.length - 1;

const PROVIDER_DUTIES = [
  ["structural_repairs", "Structural repairs"],
  ["shared_areas", "Shared areas"],
  ["property_rates", "Property rates"],
] as const;
const TENANT_DUTIES = [
  ["routine_cleaning", "Routine cleaning"],
  ["minor_consumables", "Minor consumables"],
  ["report_damage", "Report damage promptly"],
  ["respect_neighbours", "Respect neighbours"],
  ["residential_use", "Residential use only"],
] as const;

type UtilityParty = "tenant" | "provider" | "included" | "shared" | "not_applicable";
const UTILITY_PARTIES: [UtilityParty, string][] = [
  ["tenant", "Tenant"],
  ["provider", "Landlord"],
  ["included", "In rent"],
  ["shared", "Shared"],
  ["not_applicable", "N/A"],
];

const TERM_PRESETS = [6, 12, 24];
const FIRST_OF_PERIOD = "on the first day of each rental period";
const DUE_PRESETS: [string, string][] = [
  [FIRST_OF_PERIOD, "1st of each period"],
  ["on the same day of each rental period as the start date", "Same day as start"],
];

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
  occupants: string[];
  conditions: string;
  customTitle: string;
  customBody: string;
};

function initialForm(spec: LeaseSpec): FormState {
  const lease = spec.lease;
  const terms = lease?.structured_terms ?? {};
  const custom = terms.additional_terms?.[0];
  return {
    rent: lease?.rent_minor
      ? String(lease.rent_minor / 100)
      : spec.initialRentMinor
        ? String(spec.initialRentMinor / 100)
        : "",
    rentPeriod: lease?.rent_period === "yearly" ? "yearly" : "monthly",
    advance: String(lease?.advance_months ?? spec.initialAdvanceMonths ?? 1),
    deposit: String(lease?.deposit_months ?? 0),
    agencyFee: String(lease?.agency_fee_months ?? 0),
    startsOn: lease?.starts_on ?? "",
    term: String(lease?.term_months ?? 12),
    paymentDue: terms.payment_due ?? FIRST_OF_PERIOD,
    water: (terms.utilities?.water as UtilityParty | undefined) ?? "tenant",
    electricity: (terms.utilities?.electricity as UtilityParty | undefined) ?? "tenant",
    providerResponsibilities: terms.provider_responsibilities ?? ["structural_repairs", "shared_areas", "property_rates"],
    tenantResponsibilities: terms.tenant_responsibilities ?? ["routine_cleaning", "report_damage", "respect_neighbours", "residential_use"],
    occupants: (terms.occupants ?? []).map((row) => row.name),
    conditions: lease?.conditions ?? "",
    customTitle: custom?.title ?? "",
    customBody: custom?.body ?? "",
  };
}

type Update = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

export function LeaseWizard({
  spec,
  onExit,
  exitLabel = "Back to request",
  onSent,
  onDone,
}: {
  spec: LeaseSpec;
  /** Leave the wizard without sending. Anything generated stays saved. */
  onExit: () => void;
  exitLabel?: string;
  /** After the offer is sent, for the caller to refresh what it shows. */
  onSent?: (lease: Lease) => void | Promise<void>;
  /** "Done" on the sent screen. */
  onDone?: () => void;
}) {
  const resumable = spec.lease && ["draft", "ready"].includes(spec.lease.status) ? spec.lease : null;
  const [lease, setLease] = useState<Lease | null>(resumable);
  // A generated agreement opens where it was left: on its review.
  const [step, setStep] = useState(resumable?.status === "ready" && resumable.builder_preview ? REVIEW : 0);
  const [reached, setReached] = useState(resumable?.status === "ready" ? REVIEW : resumable ? REVIEW - 1 : 0);
  const [form, setForm] = useState<FormState>(() => initialForm(spec));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Lease | null>(null);

  const structured = useMemo<LeaseStructuredTerms>(() => ({
    payment_due: form.paymentDue,
    utilities: { water: form.water, electricity: form.electricity },
    occupants: form.occupants.map((name) => ({ name })),
    provider_responsibilities: form.providerResponsibilities,
    tenant_responsibilities: form.tenantResponsibilities,
    notice_channels: ["Danpa HQ", "written notice"],
    additional_terms:
      form.customTitle.trim() && form.customBody.trim()
        ? [{ title: form.customTitle.trim(), body: form.customBody.trim() }]
        : [],
  }), [form]);

  const update: Update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setError("");
  };

  function toggle(key: "providerResponsibilities" | "tenantResponsibilities", value: string) {
    update(key, form[key].includes(value) ? form[key].filter((item) => item !== value) : [...form[key], value]);
  }

  function issueAt(at: number): string {
    if (at === 1 && !form.startsOn) return "Choose when the tenancy starts.";
    if (at === 1 && Number(form.term) < 1) return "Enter how many months it runs.";
    if (at === 2 && Number(form.rent) <= 0) return "Enter the rent.";
    if (at === 3 && (!form.providerResponsibilities.length || !form.tenantResponsibilities.length)) {
      return "Choose at least one responsibility for each side.";
    }
    if (at === 4 && Boolean(form.customTitle.trim()) !== Boolean(form.customBody.trim())) {
      return "Give your own term both a title and its wording.";
    }
    return "";
  }

  function go(to: number) {
    setError("");
    setStep(to);
  }

  async function generate() {
    for (let at = 1; at <= 4; at += 1) {
      const issue = issueAt(at);
      if (issue) {
        setStep(at);
        setError(issue);
        return;
      }
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
          unit_id: spec.unitId,
          bed_id: spec.bedId || undefined,
          tenant_id: spec.tenantId,
          join_request_id: spec.source.kind === "join_request" ? spec.source.id : undefined,
          application_id: spec.source.kind === "application" ? spec.source.id : undefined,
          listing_id: spec.source.listingId || undefined,
          ...payload,
        });
      }
      current = await leaseAction(current.id, "ready");
      setLease(current);
      setDirty(false);
      setReached(REVIEW);
      setStep(REVIEW);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not prepare the agreement.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      const offered = await leaseAction(lease.id, "offer");
      setSent(offered);
      await onSent?.(offered);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not send the agreement.");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    const issue = issueAt(step);
    if (issue) {
      setError(issue);
      return;
    }
    if (step === REVIEW - 1) {
      void generate();
      return;
    }
    const to = step + 1;
    setReached((current) => Math.max(current, to));
    go(to);
  }

  const ctx = spec.context ?? {};
  const tenant = ctx.tenantName || "The tenant";
  const firstName = tenant.split(/\s+/)[0];

  if (sent) {
    return (
      <div className="lw-done" role="status">
        <span className="lw-done-mark" aria-hidden="true"><Icon name="check" /></span>
        <h3>Agreement sent</h3>
        <p>{tenant} can now review and accept it.</p>
        <dl className="lw-done-facts">
          <div><dt>Starts</dt><dd>{longDate(sent.starts_on)}</dd></div>
          <div><dt>Rent</dt><dd>{sent.rent_formatted ?? cedis(sent.rent_minor)}<small>/{sent.rent_period === "yearly" ? "yr" : "mo"}</small></dd></div>
          <div><dt>Term</dt><dd>{sent.term_months} mo</dd></div>
        </dl>
        <div className="lw-done-actions">
          <Link className="btn btn-secondary" href={`/documents?view=leases&lease=${sent.id}` as never}>View agreement</Link>
          <Button onClick={onDone ?? onExit}>Done</Button>
        </div>
      </div>
    );
  }

  const document = lease?.builder_preview?.rendered_document ?? null;
  const current = STEPS[step] ?? STEPS[0]!;
  // Changed after it was generated: the review is out of date until regenerated.
  const stale = step === REVIEW && dirty;

  return (
    <div className="lw" data-step={current.key}>
      <nav className="lw-rail" aria-label="Agreement steps">
        <ol>
          {STEPS.map((item, index) => {
            const state = index === step ? "current" : index < reached || (index === reached && index !== step) ? "done" : "todo";
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className="lw-rail-step"
                  data-state={index <= reached ? state : "todo"}
                  aria-current={index === step ? "step" : undefined}
                  disabled={busy || index > reached || (index === REVIEW && !document)}
                  onClick={() => go(index)}
                >
                  <span className="lw-rail-mark" aria-hidden="true">
                    {index < step || (index <= reached && index !== step && index !== REVIEW) ? <Icon name="check" /> : index + 1}
                  </span>
                  <span className="lw-rail-copy">
                    <strong>{item.label}</strong>
                    <small>{railSummary(index, form, ctx, Boolean(document))}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="lw-rail-foot"><Icon name="shield" />Standard clauses come from Danpa HQ&apos;s template</p>
      </nav>

      <section className="lw-stage" aria-labelledby="lw-step-title">
        <header className="lw-stage-head">
          <span className="lw-stage-count">Step {step + 1} of {STEPS.length}</span>
          <h3 id="lw-step-title">{current.label}</h3>
          <p>{current.hint}</p>
          <span className="lw-progress" aria-hidden="true"><i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></span>
        </header>

        <div className="lw-stage-body" key={step}>
          {step === 0 ? <PartiesStep spec={spec} /> : null}
          {step === 1 ? <TermStep form={form} update={update} /> : null}
          {step === 2 ? <MoneyStep form={form} update={update} advanceAsked={ctx.advanceAsked} offered={spec.initialAdvanceMonths} /> : null}
          {step === 3 ? <DutiesStep form={form} update={update} toggle={toggle} /> : null}
          {step === 4 ? <ExtraStep form={form} update={update} /> : null}
          {step === REVIEW ? (
            <ReviewStep form={form} lease={lease} document={document} stale={stale} onEdit={go} />
          ) : null}
          {error ? <Notice tone="error" title={error} /> : null}
        </div>

        <footer className="lw-foot">
          {step === 0 ? (
            <Button variant="quiet" disabled={busy} onClick={onExit}>{exitLabel}</Button>
          ) : (
            <Button variant="quiet" disabled={busy} onClick={() => go(step - 1)}>
              Back
            </Button>
          )}
          <span className="lw-foot-spacer" />
          {step === REVIEW ? (
            stale || !document ? (
              <Button busy={busy} busyLabel="Regenerating…" onClick={() => void generate()}>Regenerate agreement</Button>
            ) : (
              <>
                <Button variant="quiet" disabled={busy} onClick={onExit}>Save for later</Button>
                <Button busy={busy} busyLabel="Sending…" onClick={() => void send()}>
                  <Icon name="share" />Send to {firstName}
                </Button>
              </>
            )
          ) : (
            <Button busy={busy} busyLabel="Generating…" onClick={next}>
              {step === REVIEW - 1 ? "Generate agreement" : "Continue"}
            </Button>
          )}
        </footer>
      </section>
    </div>
  );
}

/** The wizard in a sheet of its own, for a request opened on its own page. */
export function LeaseWizardModal({
  open,
  spec,
  onClose,
  onSent,
}: {
  open: boolean;
  spec: LeaseSpec;
  onClose: () => void;
  onSent?: (lease: Lease) => void | Promise<void>;
}) {
  const ctx = spec.context ?? {};
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      size="sm"
      icon="leases"
      title="Tenancy agreement"
      meta={[ctx.tenantName, ctx.propertyTitle, ctx.unitLabel].filter(Boolean).join(" · ") || undefined}
      className="lease-wizard-sheet is-wizard"
      closeLabel="Close agreement"
    >
      {(close) => <LeaseWizard spec={spec} onExit={close} exitLabel="Cancel" onSent={onSent} onDone={close} />}
    </ModalSheet>
  );
}

// --- steps ------------------------------------------------------------------------

function PartiesStep({ spec }: { spec: LeaseSpec }) {
  const ctx = spec.context ?? {};
  const place = [ctx.unitLabel, ctx.bedLabel].filter(Boolean).join(" · ");
  return (
    <div className="lw-parties">
      <div className="lw-party">
        <span className="lw-party-avatar is-provider" aria-hidden="true"><Icon name="portfolio" /></span>
        <span className="lw-party-copy">
          <small>Landlord</small>
          <strong>{ctx.providerName || "Your Portfolio"}</strong>
        </span>
      </div>
      <span className="lw-parties-link" aria-hidden="true"><Icon name="leases" /></span>
      <div className="lw-party">
        <span className="lw-party-avatar" aria-hidden="true">{initialsOf(ctx.tenantName || "T")}</span>
        <span className="lw-party-copy">
          <small>Tenant</small>
          <strong>{ctx.tenantName || "Accepted applicant"}</strong>
          {ctx.tenantVerified ? <em><Icon name="verification" />Phone verified</em> : null}
        </span>
      </div>

      <div className="lw-home">
        <span className="lw-home-photo" aria-hidden="true">
          {ctx.photoUrl ? (
            /* Short-lived signed URLs from the files service. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={ctx.photoUrl} alt="" />
          ) : <Icon name="properties" />}
        </span>
        <span className="lw-home-copy">
          <small>Rental space</small>
          <strong>{ctx.propertyTitle || "The accepted Property"}</strong>
          <span>{[place || null, ctx.locality].filter(Boolean).join(" · ") || "Unit from the request"}</span>
        </span>
        {ctx.sourceLabel ? <span className="lw-chip">{ctx.sourceLabel}</span> : null}
      </div>

      <p className="lw-quiet"><Icon name="lock" />Taken from verified accounts and the request. Nothing to re-enter.</p>
    </div>
  );
}

function TermStep({ form, update }: { form: FormState; update: Update }) {
  const months = Number(form.term) || 0;
  const custom = !TERM_PRESETS.includes(months);
  const ends = form.startsOn && months ? endOf(form.startsOn, months) : null;
  return (
    <div className="lw-grid">
      <Field autoFocus label="Starts on" type="date" value={form.startsOn} onChange={(event) => update("startsOn", event.target.value)} />
      <div className="lw-field">
        <span className="lw-label">Length</span>
        <div className="lw-chips" role="radiogroup" aria-label="Length">
          {TERM_PRESETS.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={months === value} className="lw-chip-button" onClick={() => update("term", String(value))}>
              {value} months
            </button>
          ))}
          <button type="button" role="radio" aria-checked={custom} className="lw-chip-button" onClick={() => update("term", custom ? form.term : "")}>
            Other
          </button>
        </div>
      </div>
      {custom ? (
        <Field label="Months" inputMode="numeric" value={form.term} onChange={(event) => update("term", event.target.value.replace(/\D/g, "").slice(0, 3))} />
      ) : null}

      <div className="lw-span lw-timeline" data-empty={ends ? undefined : ""}>
        <span className="lw-timeline-end">
          <small>Starts</small>
          <strong>{form.startsOn ? longDate(form.startsOn) : "Pick a date"}</strong>
        </span>
        <span className="lw-timeline-bar" aria-hidden="true"><i /><em>{months ? `${months} months` : "—"}</em></span>
        <span className="lw-timeline-end is-right">
          <small>Ends</small>
          <strong>{ends ? longDate(ends) : "—"}</strong>
        </span>
      </div>
    </div>
  );
}

function MoneyStep({ form, update, advanceAsked, offered }: { form: FormState; update: Update; advanceAsked?: number; offered?: number }) {
  const rentMinor = Math.round(Number(form.rent || 0) * 100);
  const monthly = form.rentPeriod === "yearly" ? rentMinor / 12 : rentMinor;
  const advance = Number(form.advance || 0);
  const deposit = Number(form.deposit || 0);
  const agency = Number(form.agencyFee || 0);
  const total = monthly * (advance + deposit + agency);
  const due = DUE_PRESETS.find(([value]) => value === form.paymentDue);
  const [otherDue, setOtherDue] = useState(!due);

  return (
    <div className="lw-money">
      <div className="lw-money-fields">
        <div className="lw-rent">
          <Field autoFocus label="Rent" prefix="GH₵" inputMode="decimal" placeholder="0.00" value={form.rent} onChange={(event) => update("rent", event.target.value.replace(/[^0-9.]/g, ""))} />
          <div className="lw-seg" role="radiogroup" aria-label="Paid">
            {(["monthly", "yearly"] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={form.rentPeriod === value} onClick={() => update("rentPeriod", value)}>
                {value === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>

        <div className="lw-steppers">
          <Stepper label="Advance" value={advance} onChange={(value) => update("advance", String(value))}
            hint={offered !== undefined && advanceAsked !== undefined ? `Offered ${offered} of ${advanceAsked}` : undefined} />
          <Stepper label="Deposit" value={deposit} onChange={(value) => update("deposit", String(value))} />
          <Stepper label="Agency fee" value={agency} onChange={(value) => update("agencyFee", String(value))} />
        </div>

        <div className="lw-field">
          <span className="lw-label">Rent due</span>
          <div className="lw-chips" role="radiogroup" aria-label="Rent due">
            {DUE_PRESETS.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={!otherDue && form.paymentDue === value} className="lw-chip-button"
                onClick={() => { setOtherDue(false); update("paymentDue", value); }}>
                {label}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={otherDue} className="lw-chip-button" onClick={() => setOtherDue(true)}>Other</button>
          </div>
          {otherDue ? (
            <Field label="When rent is due" placeholder="e.g. by the 5th of each month" value={due ? "" : form.paymentDue} onChange={(event) => update("paymentDue", event.target.value)} />
          ) : null}
        </div>
      </div>

      <aside className="lw-receipt" aria-label="Move-in total">
        <small>Due at move-in</small>
        <strong className="lw-receipt-total">{cedis(total)}</strong>
        <ul>
          <li><span>Advance · {advance} mo</span><span>{cedis(monthly * advance)}</span></li>
          <li><span>Deposit · {deposit} mo</span><span>{cedis(monthly * deposit)}</span></li>
          <li><span>Agency fee · {agency} mo</span><span>{cedis(monthly * agency)}</span></li>
        </ul>
        <p>Estimate. The agreement states the final figures.</p>
      </aside>
    </div>
  );
}

function DutiesStep({ form, update, toggle }: {
  form: FormState;
  update: Update;
  toggle: (key: "providerResponsibilities" | "tenantResponsibilities", value: string) => void;
}) {
  return (
    <div className="lw-duties">
      <div className="lw-utilities">
        {(["water", "electricity"] as const).map((utility) => (
          <div key={utility} className="lw-utility">
            <span className="lw-label">{utility === "water" ? "Water" : "Electricity"}</span>
            <div className="lw-seg is-wide" role="radiogroup" aria-label={`${utility === "water" ? "Water" : "Electricity"} paid by`}>
              {UTILITY_PARTIES.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={form[utility] === value} onClick={() => update(utility, value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="lw-sides">
        <DutyList title="Landlord" icon="portfolio" options={PROVIDER_DUTIES} chosen={form.providerResponsibilities} onToggle={(value) => toggle("providerResponsibilities", value)} />
        <DutyList title="Tenant" icon="account" options={TENANT_DUTIES} chosen={form.tenantResponsibilities} onToggle={(value) => toggle("tenantResponsibilities", value)} />
      </div>
    </div>
  );
}

function DutyList({ title, icon, options, chosen, onToggle }: {
  title: string;
  icon: IconName;
  options: readonly (readonly [string, string])[];
  chosen: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <section className="lw-side">
      <header><Icon name={icon} /><strong>{title}</strong><span>{chosen.length}</span></header>
      <div className="lw-chips">
        {options.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={chosen.includes(value)} className="lw-chip-button is-toggle" onClick={() => onToggle(value)}>
            {chosen.includes(value) ? <Icon name="check" /> : <Icon name="plus" />}{label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ExtraStep({ form, update }: { form: FormState; update: Update }) {
  const templates = useTermsTemplates();
  const [name, setName] = useState("");
  const chosen = templates.find((row) => row.name === form.customTitle.trim() && row.body === form.customBody.trim());

  // The Portfolio's default fills an empty custom term once, when it arrives.
  useEffect(() => {
    const preferred = templates.find((row) => row.is_default);
    if (!preferred || form.customTitle.trim() || form.customBody.trim()) return;
    update("customTitle", preferred.name);
    update("customBody", preferred.body);
    // Only on arrival: clearing the term afterwards must not refill it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  function addOccupant() {
    const value = name.trim();
    if (!value || form.occupants.includes(value)) return;
    update("occupants", [...form.occupants, value]);
    setName("");
  }

  return (
    <div className="lw-extra">
      <div className="lw-field">
        <span className="lw-label">Other occupants <small>optional</small></span>
        <div className="lw-tags">
          {form.occupants.map((person) => (
            <span key={person} className="lw-tag">
              {person}
              <button type="button" aria-label={`Remove ${person}`} onClick={() => update("occupants", form.occupants.filter((row) => row !== person))}><Icon name="close" /></button>
            </span>
          ))}
          <input
            className="lw-tag-input"
            aria-label="Add an occupant"
            placeholder={form.occupants.length ? "Add another" : "Type a name, press Enter"}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); addOccupant(); }
            }}
            onBlur={addOccupant}
          />
        </div>
      </div>

      <label className="lw-field">
        <span className="lw-label">Practical conditions <small>optional</small></span>
        <textarea className="lw-textarea" rows={3} placeholder="e.g. No pets. Quiet hours after 10pm." value={form.conditions} onChange={(event) => update("conditions", event.target.value)} />
      </label>

      <section className="lw-custom">
        <header>
          <strong>Your own term</strong>
          <span className="lw-chip">Labelled as yours</span>
        </header>
        {templates.length ? (
          <div className="lw-chips" aria-label="Saved templates">
            {templates.map((row) => (
              <button key={row.id} type="button" aria-pressed={chosen?.id === row.id} className="lw-chip-button is-toggle"
                onClick={() => {
                  update("customTitle", chosen?.id === row.id ? "" : row.name);
                  update("customBody", chosen?.id === row.id ? "" : row.body);
                }}>
                <Icon name="details" />{row.name}{row.is_default ? <em>default</em> : null}
              </button>
            ))}
          </div>
        ) : null}
        <Field label="Title" value={form.customTitle} onChange={(event) => update("customTitle", event.target.value)} />
        <textarea className="lw-textarea" rows={4} aria-label="Wording" placeholder="The complete wording" value={form.customBody} onChange={(event) => update("customBody", event.target.value)} />
      </section>
    </div>
  );
}

function ReviewStep({ form, lease, document, stale, onEdit }: {
  form: FormState;
  lease: Lease | null;
  document: RenderedAgreement | null;
  stale: boolean;
  onEdit: (step: number) => void;
}) {
  if (!document) return <p className="lw-quiet">Generating the agreement…</p>;
  const rent = Math.round(Number(form.rent || 0) * 100);
  return (
    <div className="lw-review">
      <div className="lw-facts">
        <Fact label="Starts" value={form.startsOn ? longDate(form.startsOn) : "—"} onEdit={() => onEdit(1)} />
        <Fact label="Term" value={`${form.term} months`} onEdit={() => onEdit(1)} />
        <Fact label="Rent" value={`${cedis(rent)}/${form.rentPeriod === "yearly" ? "yr" : "mo"}`} onEdit={() => onEdit(2)} />
        <Fact label="Move-in" value={lease?.move_in_total_formatted ?? cedis(lease?.move_in_total_minor ?? 0)} onEdit={() => onEdit(2)} />
      </div>

      {stale ? <Notice tone="info" title="You changed something" body="Regenerate to see it in the agreement." /> : null}
      {lease?.advance_notice ? (
        <Notice tone={lease.advance_notice.stance === "allow" ? "info" : "warning"} title="Advance" body={lease.advance_notice.message} />
      ) : null}

      <article className="lw-paper" data-stale={stale || undefined}>
        <header>
          <small>{document.reference_number}</small>
          <h4>{document.title}</h4>
          <span>Template {document.template.version}</span>
        </header>
        {document.production_notice ? <p className="lw-paper-notice"><Icon name="warning" />{document.production_notice}</p> : null}
        {document.sections.map((section) => (
          <section key={section.id} data-kind={section.kind}>
            <h5>{section.title}</h5>
            <p>{section.body}</p>
          </section>
        ))}
      </article>
    </div>
  );
}

// --- parts -------------------------------------------------------------------------

function Stepper({ label, value, onChange, hint }: { label: string; value: number; onChange: (value: number) => void; hint?: string }) {
  return (
    <div className="lw-stepper">
      <span className="lw-label">{label}</span>
      <div className="lw-stepper-control">
        <button type="button" aria-label={`Fewer months of ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <output aria-live="polite"><strong>{value}</strong><small>mo</small></output>
        <button type="button" aria-label={`More months of ${label.toLowerCase()}`} disabled={value >= 24} onClick={() => onChange(Math.min(24, value + 1))}>+</button>
      </div>
      {hint ? <small className="lw-stepper-hint">{hint}</small> : null}
    </div>
  );
}

function Fact({ label, value, onEdit }: { label: string; value: ReactNode; onEdit: () => void }) {
  return (
    <button type="button" className="lw-fact" onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <Icon name="pencil" />
    </button>
  );
}

function railSummary(index: number, form: FormState, ctx: NonNullable<LeaseSpec["context"]>, generated: boolean) {
  switch (index) {
    case 0: return ctx.tenantName ?? "From the request";
    case 1: return form.startsOn ? `${shortDate(form.startsOn)} · ${form.term || "?"} mo` : "Not set";
    case 2: return Number(form.rent) > 0 ? `${cedis(Math.round(Number(form.rent) * 100))}/${form.rentPeriod === "yearly" ? "yr" : "mo"}` : "Not set";
    case 3: return `${form.providerResponsibilities.length + form.tenantResponsibilities.length} duties`;
    case 4: {
      const extras = form.occupants.length + (form.conditions.trim() ? 1 : 0) + (form.customTitle.trim() ? 1 : 0);
      return extras ? `${extras} added` : "Optional";
    }
    default: return generated ? "Ready to send" : "After generating";
  }
}

function cedis(minor: number) {
  return `GH₵${(minor / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseDay(value: string) {
  return new Date(value.length === 10 ? `${value}T12:00:00` : value);
}

function longDate(value: string) {
  return parseDay(value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

function shortDate(value: string) {
  return parseDay(value).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

/** The last day of a term that starts on `start` and runs `months`. */
function endOf(start: string, months: number) {
  const date = parseDay(start);
  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * The Portfolio's saved terms templates (Documents › Contracts). Their
 * `${placeholders}` stay as written here and are filled from this agreement's
 * facts when the backend renders it, so Review shows the finished wording.
 */
function useTermsTemplates() {
  const { activeContext } = useSession();
  const [templates, setTemplates] = useState<TermsTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    const preferred = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
    void (async () => {
      try {
        const organizationId = preferred || (await listOrganizations())[0]?.id;
        if (!organizationId) return;
        const contracts = await getPortfolioContracts(organizationId);
        if (!cancelled) setTemplates(contracts.templates);
      } catch {
        // Templates are a convenience here; without them the term is typed as before.
      }
    })();
    return () => { cancelled = true; };
  }, [activeContext]);
  return templates;
}
