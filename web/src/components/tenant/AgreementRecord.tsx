"use client";

/**
 * One authoritative agreement record, shared by its durable route and the
 * sheet the tenant's list opens it in. The shell may change, but the frozen
 * terms, evidence and lifecycle actions never fork.
 *
 * Drawn in the vocabulary of the provider's lease record (LeaseRecord, the
 * `lr-*` styles) and the request sheet's hero: where it stands, the money,
 * then the agreement itself — open for reading while a decision is due — and
 * who accepted it. The decision sits in the sheet's sticky foot, so it is
 * always in reach and always after the reading.
 */

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Check } from "@/components/Check";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { agreedTerms, homeOf, money, months, per, standing } from "@/lib/agreementMeaning";
import { ApiFailure } from "@/lib/api";
import { getLeaseDocument, leaseAction, type Lease, type RenderedAgreement } from "@/lib/console";
import { downloadBlob, printPdf } from "@/lib/printDocument";
import { acceptMyLease, declineMyLease, getLeaseLedger, type RentCharge } from "@/lib/tenant";
import { onDate } from "@/lib/time";

/**
 * How an agreement is coloured, on the row and in the record. Presentation
 * only, read from the status `standing()` already resolved.
 */
export type AgreementTone = "action" | "waiting" | "good" | "stopped" | "muted";

export function agreementTone(lease: { status: string }): AgreementTone {
  const state = standing(lease);
  if (state.stage === "action") return "action";
  if (lease.status === "active") return "good";
  if (state.stage === "active") return "waiting";
  if (lease.status === "declined" || lease.status === "cancelled") return "stopped";
  return "muted";
}

/**
 * The record over the list. A plain click on a row opens it; the address keeps
 * it (`?agreement=`), so Back, a refresh or a copied link return to it. The
 * last agreement shown is held so the sheet can play its exit after the
 * address has let it go.
 */
export function AgreementSheet({
  lease,
  onClose,
  onChanged,
}: {
  lease: Lease | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [shown, setShown] = useState<Lease | null>(lease);
  if (lease && lease !== shown) setShown(lease);
  const current = lease ?? shown;
  const charges = useCharges(lease?.status === "active" ? lease.id : null);
  if (!current) return null;
  const state = standing(current);

  return (
    <ModalSheet
      open={Boolean(lease)}
      onClose={onClose}
      icon="leases"
      title="Tenancy agreement"
      meta={
        <>
          <span className={`doc-modal-status is-${agreementTone(current)}`}><i aria-hidden="true" />{state.line}</span>
          {current.agreement?.reference_number ? <><span className="doc-modal-sep" aria-hidden="true">·</span>{current.agreement.reference_number}</> : null}
        </>
      }
      className="request-sheet agreement-sheet"
      closeLabel="Close agreement"
    >
      <AgreementRecord key={current.id} lease={current} charges={charges} onChanged={onChanged} />
    </ModalSheet>
  );
}

/** What is owed on an active tenancy, read when its agreement is opened. */
export function useCharges(leaseId: string | null) {
  const [charges, setCharges] = useState<{ id: string; rows: RentCharge[] } | null>(null);
  useEffect(() => {
    if (!leaseId) return;
    let live = true;
    getLeaseLedger(leaseId)
      .then((ledger) => { if (live) setCharges({ id: leaseId, rows: ledger.charges }); })
      .catch(() => { if (live) setCharges({ id: leaseId, rows: [] }); });
    return () => { live = false; };
  }, [leaseId]);
  return charges && charges.id === leaseId ? charges.rows : [];
}

export function AgreementRecord({
  lease,
  charges,
  onChanged,
}: {
  lease: Lease;
  charges: RentCharge[];
  onChanged: () => Promise<void>;
}) {
  const terms = agreedTerms(lease);
  const state = standing(lease);
  const tone = agreementTone(lease);
  const rendered = lease.agreement?.rendered_document?.sections?.length
    ? lease.agreement.rendered_document
    : null;
  const unit = [terms.unitLabel, terms.bedLabel].filter(Boolean).join(" · ");
  const location = terms.address || lease.locality_name;
  const pastEnd = state.stage === "past" && terms.endsOn;

  useEffect(() => {
    if (lease.workflow_version === "canonical_v1" && lease.status === "offered" && !lease.tenant_reviewed_at) {
      void leaseAction(lease.id, "review").catch(() => undefined);
    }
  }, [lease.id, lease.status, lease.tenant_reviewed_at, lease.workflow_version]);

  return (
    <div className="rq lr ag">
      <section className="rq-hero ag-hero" data-tone={tone} aria-label="Where it stands">
        <div className="ag-home">
          <span className="ag-seal" aria-hidden="true"><Icon name="leases" /></span>
          <span className="ag-home-copy">
            <h2>{terms.propertyTitle}</h2>
            {unit || location ? <small>{[unit, location].filter(Boolean).join(" · ")}</small> : null}
            <span className="ag-landlord">From {terms.landlordName}</span>
          </span>
        </div>
        <p className={`ag-standing is-${tone}`}>
          <i aria-hidden="true" />
          <strong>{state.line}</strong>
          <span>
            {pastEnd ? `Ended ${onDate(terms.endsOn!)}` : terms.startsOn ? `Starts ${onDate(terms.startsOn)}` : `Sent ${onDate(lease.created_at)}`}
          </span>
        </p>
      </section>

      {lease.advance_notice ? (
        <Notice
          tone="warning"
          title={`This asks for ${months(lease.advance_notice.months)} rent in advance`}
          body={lease.advance_notice.message}
        />
      ) : null}
      {!terms.frozen ? (
        <Notice
          tone="warning"
          title="This is an older agreement"
          body="Its snapshot predates agreement versioning. Check these terms against the copy you agreed to."
        />
      ) : null}

      <AgreementProgress lease={lease} />

      {/* The money first: what moving in costs, then what it costs to stay. */}
      <section className="ag-glance" aria-labelledby={`ag-glance-${lease.id}`}>
        <h3 className="ws-visually-hidden" id={`ag-glance-${lease.id}`}>At a glance</h3>
        <dl className="lr-figures">
          <div className="is-primary">
            <dt>Move-in total</dt>
            <dd>{money(terms.moveInTotalMinor, terms.rentCurrency)}</dd>
          </div>
          <div>
            <dt>Rent</dt>
            <dd>{money(terms.rentMinor, terms.rentCurrency)}<small>/{per(terms.rentPeriod)}</small></dd>
          </div>
          <div>
            <dt>Term</dt>
            <dd>{months(terms.termMonths)}</dd>
          </div>
        </dl>
        <dl className="lr-terms">
          <div><dt>Starts</dt><dd>{terms.startsOn ? onDate(terms.startsOn) : "Not set"}</dd></div>
          <div><dt>Ends</dt><dd>{terms.endsOn ? onDate(terms.endsOn) : "Not set"}</dd></div>
          <div><dt>Advance</dt><dd>{months(terms.advanceMonths)}</dd></div>
          <div><dt>Deposit</dt><dd>{terms.depositMonths ? months(terms.depositMonths) : "None"}</dd></div>
        </dl>
      </section>

      {terms.conditions ? (
        <section className="lr-block">
          <h3>Conditions</h3>
          <p>{terms.conditions}</p>
        </section>
      ) : null}

      {lease.decline_reason ? (
        <p className="rq-decision-note"><Icon name="chat" /><span><small>Recorded reason</small>{lease.decline_reason}</span></p>
      ) : null}

      {lease.status === "active" && charges.length ? <RentSoFar charges={charges} /> : null}

      <AgreementDocumentSection lease={lease} rendered={rendered} terms={terms} reading={state.decisionOpen} />

      {lease.agreement ? (
        <section className="ag-evidence" aria-labelledby={`ag-evidence-${lease.id}`}>
          <h3 id={`ag-evidence-${lease.id}`}>Acceptance record</h3>
          {lease.agreement.accepted_by.length ? (
            <ul className="ag-acceptances">
              {lease.agreement.accepted_by.map((acceptance) => (
                <li key={`${acceptance.party}-${acceptance.accepted_at}`}>
                  <span aria-hidden="true"><Icon name="check" /></span>
                  <span><strong>{acceptance.name}</strong><small>accepted on {onDate(acceptance.accepted_at)}</small></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ag-evidence-empty">No acceptance has been recorded yet.</p>
          )}
          <details className="ag-fingerprint">
            <summary><Icon name="audit" />Record details<Icon name="chevron-down" /></summary>
            <dl>
              <div><dt>Template</dt><dd>{lease.agreement.template.version || lease.agreement.schema_version}</dd></div>
              <div><dt>Document hash</dt><dd><code>{lease.agreement.content_hash.slice(0, 16)}…</code></dd></div>
            </dl>
            <p>This identifies the exact terms above. It is not an electronic signature.</p>
          </details>
        </section>
      ) : null}

      {state.decisionOpen ? <Decision lease={lease} terms={terms} onChanged={onChanged} /> : null}
    </div>
  );
}

/**
 * Where the agreement has got to, from the tenant's side: sent to them, their
 * answer, the landlord's confirmation, the tenancy. It stops where it stopped.
 */
function AgreementProgress({ lease }: { lease: Lease }) {
  const order = ["offered", "tenant_accepted", "awaiting_activation", "active", "ended"];
  const reached = order.indexOf(lease.status);
  const declined = lease.status === "declined";
  const withdrawn = lease.status === "cancelled";
  const steps = [
    { label: "Sent to you", detail: lease.ready_at ?? lease.created_at, done: true, bad: false },
    {
      label: declined ? "You declined" : reached >= 1 ? "You accepted" : "Your answer",
      detail: lease.tenant_accepted_at,
      done: reached >= 1 || declined,
      bad: declined,
    },
    {
      label: withdrawn ? "Withdrawn" : "Confirmed",
      detail: lease.provider_confirmed_at ?? lease.landlord_accepted_at,
      done: reached >= 2 || withdrawn,
      bad: withdrawn,
    },
    { label: lease.status === "ended" ? "Ended" : "Moved in", detail: null, done: reached >= 3, bad: false },
  ];
  const stopped = declined || withdrawn;
  const current = stopped ? -1 : steps.findIndex((step) => !step.done);
  return (
    <ol className="lr-track ag-track" aria-label="Agreement progress">
      {steps.map((step, index) => (
        <li key={step.label} data-state={step.bad ? "bad" : step.done ? "done" : index === current ? "now" : "todo"}>
          <span className="lr-track-mark" aria-hidden="true" />
          <strong>{step.label}</strong>
          {step.detail && step.done ? <small>{onDate(step.detail)}</small> : index === current ? <small>{index === 1 ? "Your turn" : "Waiting"}</small> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The agreement itself. While a decision is due it is open, because it is
 * what is being agreed to; afterwards it is one press away, with the frozen
 * PDF beside it.
 */
function AgreementDocumentSection({
  lease,
  rendered,
  terms,
  reading,
}: {
  lease: Lease;
  rendered: RenderedAgreement | null;
  terms: ReturnType<typeof agreedTerms>;
  reading: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accepted = lease.agreement?.accepted_by.length ?? 0;

  async function run(kind: "download" | "print") {
    setBusy(true); setError("");
    try {
      const blob = await getLeaseDocument(lease.id);
      if (kind === "download") downloadBlob(blob, `rooomly-agreement-${lease.agreement?.reference_number ?? lease.id}.pdf`);
      else await printPdf(blob);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The final document could not be opened.");
    } finally { setBusy(false); }
  }

  return (
    <section className="lr-doc ag-doc" aria-label="Agreement document">
      <header className="lr-doc-head">
        <span className="lr-doc-mark" aria-hidden="true"><Icon name="leases" /></span>
        <span className="lr-doc-copy">
          <strong>{lease.agreement?.reference_number || "Residential tenancy agreement"}</strong>
          <small>
            {lease.agreement ? `Template ${lease.agreement.template.version || lease.agreement.schema_version} · ${accepted} of 2 accepted` : "Agreement record"}
          </small>
        </span>
        {lease.agreement?.final_pdf_url ? (
          <span className="lr-doc-actions">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run("download")}><Icon name="download" />Download</Button>
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => void run("print")}><Icon name="print" />Print</Button>
          </span>
        ) : null}
      </header>
      {error ? <Notice tone="error" title={error} /> : null}
      <details className="lr-doc-read" open={reading || undefined}>
        <summary>{reading ? "The complete agreement" : "Read the full agreement"}</summary>
        {rendered ? (
          <TenantAgreementDocument document={rendered} />
        ) : (
          <article className="lease-document tenant-complete-agreement is-fallback">
            <header>
              <p>{lease.agreement?.reference_number || "Agreement record"}</p>
              <h3>Residential tenancy agreement</h3>
              <span>{terms.propertyTitle}</span>
            </header>
            <section>
              <h4>Parties</h4>
              <p>This agreement is between {terms.landlordName} and {terms.tenantName} for {homeOf(terms)}.</p>
            </section>
            <section>
              <h4>Term and payment</h4>
              <p>The tenancy runs for {months(terms.termMonths)} from {terms.startsOn ? onDate(terms.startsOn) : "the agreed start date"}. Rent is {money(terms.rentMinor, terms.rentCurrency)} per {per(terms.rentPeriod)}.</p>
            </section>
            <section>
              <h4>Conditions</h4>
              <p>{terms.conditions || "No additional conditions were recorded."}</p>
            </section>
          </article>
        )}
      </details>
    </section>
  );
}

function TenantAgreementDocument({ document }: { document: RenderedAgreement }) {
  return (
    <article className="lease-document tenant-complete-agreement">
      <header>
        <p>{document.reference_number}</p>
        <h3>{document.title}</h3>
        <span>Template {document.template.version}</span>
      </header>
      {document.production_notice ? <Notice tone="warning" title="Pre-production legal review" body={document.production_notice} /> : null}
      {document.sections.map((section) => (
        <section key={section.id}><h4>{section.title}</h4><p>{section.body}</p></section>
      ))}
    </article>
  );
}

/**
 * Accept or decline, after the reading.
 *
 * Two steps, and the second says what actually happens rather than that
 * something important is about to. Acceptance cannot be undone by the tenant —
 * `OPEN_TO_TENANT` is `offered` alone — and the terms are never edited
 * afterwards: a different arrangement is a new agreement.
 */
function Decision({
  lease,
  terms,
  onChanged,
}: {
  lease: Lease;
  terms: ReturnType<typeof agreedTerms>;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"choose" | "accept" | "decline">("choose");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLElement>(null);

  const mustAcknowledge = lease.advance_notice?.requires_acknowledgement ?? false;

  // The question is asked where the answer is given, not off the bottom of the sheet.
  useEffect(() => {
    if (step !== "choose") confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step]);

  async function run(kind: "accept" | "decline", work: () => Promise<Lease>) {
    setBusy(kind);
    setError("");
    try {
      const updated = await work();
      await onChanged();
      toast(kind === "accept"
        ? { tone: "success", title: "Agreement accepted", description: standing(updated).line }
        : { tone: "success", title: "Agreement declined", description: "The landlord has been told." });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
      setBusy(null);
    }
  }

  return (
    <>
      {error ? <Notice tone="error" title={error} /> : null}

      {step === "accept" ? (
        <section ref={confirmRef} className="ag-confirm is-accept" aria-label="Confirm acceptance">
          <p className="agreement-consequence">
            You are accepting {money(terms.moveInTotalMinor, terms.rentCurrency)} to move in and{" "}
            {money(terms.rentMinor, terms.rentCurrency)} per {per(terms.rentPeriod)} for{" "}
            {months(terms.termMonths)} from {terms.startsOn ? onDate(terms.startsOn) : "the agreed date"}.
          </p>
          <small>
            You cannot undo this yourself, and the terms cannot be changed afterwards — a different
            arrangement means a new agreement.
          </small>
          {mustAcknowledge ? (
            <Check
              label="I have read the advance-rent notice at the top of this agreement."
              checked={acknowledged}
              onChange={setAcknowledged}
            />
          ) : null}
        </section>
      ) : step === "decline" ? (
        <section ref={confirmRef} className="ag-confirm is-decline" aria-label="Confirm declining">
          <p className="agreement-consequence">Declining ends this offer. The landlord would have to send a new one.</p>
          <label className="agreement-reason-field">
            <span>Reason (optional)</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Tell the landlord what did not work, if you want to."
            />
          </label>
        </section>
      ) : null}

      <div className="rq-actions ag-decision" role="group" aria-label="Your decision">
        {step === "choose" ? (
          <>
            <Button className="ag-accept" onClick={() => setStep("accept")}><Icon name="check" />Accept agreement</Button>
            <span className="rq-actions-spacer" />
            <Button className="ag-decline" variant="quiet" onClick={() => setStep("decline")}>Decline</Button>
          </>
        ) : step === "accept" ? (
          <>
            <Button
              className="ag-accept"
              busy={busy === "accept"}
              busyLabel="Accepting…"
              disabled={mustAcknowledge && !acknowledged}
              onClick={() => void run("accept", () => acceptMyLease(lease.id, acknowledged))}
            >Yes, accept it</Button>
            <Button variant="quiet" disabled={busy !== null} onClick={() => setStep("choose")}>Go back</Button>
          </>
        ) : (
          <>
            <Button
              variant="destructive"
              busy={busy === "decline"}
              busyLabel="Declining…"
              onClick={() => void run("decline", () => declineMyLease(lease.id, reason.trim()))}
            >Yes, decline it</Button>
            <Button variant="quiet" disabled={busy !== null} onClick={() => setStep("choose")}>Go back</Button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * What is owed on this tenancy.
 *
 * Here, on the active agreement, because the web tenant has no rent area yet —
 * mobile has `rent-account` and the web nav has no equivalent. It belongs in
 * Rent when Rent exists; removing it now would leave a tenant with no way to
 * see their charges at all.
 */
function RentSoFar({ charges }: { charges: RentCharge[] }) {
  return (
    <section className="ag-charges-block">
      <h3>Rent so far</h3>
      <ul className="agreement-charges">
        {charges.map((charge) => {
          const outstanding = charge.outstanding_minor > 0;
          return (
            <li key={charge.id} data-state={outstanding ? (charge.is_overdue ? "overdue" : "due") : "paid"}>
              <span>
                <strong>{charge.kind_display}</strong>
                <em>Due {onDate(charge.due_on)}</em>
              </span>
              <span>
                {outstanding ? charge.outstanding_formatted ?? charge.amount_formatted : charge.amount_formatted}
                <em>{outstanding ? (charge.is_overdue ? "Overdue" : "Outstanding") : "Paid"}</em>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
