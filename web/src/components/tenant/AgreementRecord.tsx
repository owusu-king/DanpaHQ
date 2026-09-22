"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { agreedTerms, homeOf, money, months, per, standing } from "@/lib/agreementMeaning";
import { ApiFailure } from "@/lib/api";
import { getLeaseDocument, leaseAction, type Lease, type RenderedAgreement } from "@/lib/console";
import { acceptMyLease, declineMyLease, type RentCharge } from "@/lib/tenant";
import { onDate } from "@/lib/time";
import { Check } from "@/components/Check";

export function AgreementDetailModal({
  lease,
  charges,
  onChanged,
  onClose,
}: {
  lease: Lease;
  charges: RentCharge[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeTimer = useRef<number | null>(null);
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (dialog?.open) dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    setLeaving(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    closeTimer.current = window.setTimeout(() => dialog.close(), 170);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`agreement-modal${leaving ? " is-leaving" : ""}`}
      aria-labelledby="agreement-modal-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <div className="agreement-modal-surface">
        <button type="button" className="agreement-modal-close" aria-label="Close agreement" onClick={requestClose}>
          <Icon name="close" />
        </button>
        <AgreementRecord
          lease={lease}
          charges={charges}
          onChanged={onChanged}
          modal
          headingRef={headingRef}
        />
      </div>
    </dialog>
  );
}

/**
 * One authoritative agreement record, shared by its durable route and the
 * tenant's in-context reading modal. The shell may change, but the frozen
 * terms, evidence and lifecycle actions never fork.
 *
 * Metadata establishes the decision first, the rendered agreement remains the
 * centre of the reading surface, and every mutation/document action lives in
 * the footer rather than drifting through the legal text.
 */
export function AgreementRecord({
  lease,
  charges,
  onChanged,
  modal = false,
  headingRef,
}: {
  lease: Lease;
  charges: RentCharge[];
  onChanged: () => Promise<void>;
  modal?: boolean;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}) {
  const terms = agreedTerms(lease);
  const state = standing(lease);
  const rendered = lease.agreement?.rendered_document?.sections?.length
    ? lease.agreement.rendered_document
    : null;
  const [bodyScrolled, setBodyScrolled] = useState(false);
  const unit = [terms.unitLabel, terms.bedLabel].filter(Boolean).join(" · ");
  const location = terms.address || lease.locality_name;

  useEffect(() => {
    if (lease.workflow_version === "canonical_v1" && lease.status === "offered" && !lease.tenant_reviewed_at) {
      void leaseAction(lease.id, "review").catch(() => undefined);
    }
  }, [lease.id, lease.status, lease.tenant_reviewed_at, lease.workflow_version]);

  return (
    <div className={`tenant-agreement-record${modal ? " is-modal" : ""}`} data-body-scrolled={bodyScrolled || undefined}>
      <div className="tenant-agreement-record-panel" key={lease.id}>
        <header className="tenant-agreement-record-head">
          <div className="agreement-record-identity">
            <span className="agreement-record-seal" aria-hidden="true"><Icon name="leases" /></span>
            <div>
              <p className={`agreement-standing is-${state.stage}`}><i aria-hidden="true" />{state.line}</p>
              <h2 id={modal ? "agreement-modal-title" : undefined} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
                {terms.propertyTitle}
              </h2>
              <p>{[unit, location].filter(Boolean).join(" · ")}</p>
            </div>
          </div>

          <dl className="agreement-record-meta">
            <div>
              <dt>Agreement</dt>
              <dd>{lease.agreement?.reference_number || "Record pending"}</dd>
            </div>
            <div>
              <dt>{state.stage === "past" && terms.endsOn ? "Ended" : "Starts"}</dt>
              <dd>{state.stage === "past" && terms.endsOn ? onDate(terms.endsOn) : terms.startsOn ? onDate(terms.startsOn) : "Not set"}</dd>
            </div>
          </dl>
        </header>

        <div
          className="tenant-agreement-record-body"
          onScroll={(event) => setBodyScrolled(event.currentTarget.scrollTop > 2)}
        >
          {lease.advance_notice || !terms.frozen ? (
            <div className="agreement-notices">
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
            </div>
          ) : null}

          {lease.agreement ? (
            <section className="agreement-evidence" aria-labelledby="agreement-evidence-title">
              <header className="agreement-section-heading">
                <span aria-hidden="true"><Icon name="check" /></span>
                <div>
                  <h3 id="agreement-evidence-title">Acceptance record</h3>
                  <p>The people and version attached to these exact terms.</p>
                </div>
              </header>

              {lease.agreement.accepted_by.length ? (
                <ul className="agreement-acceptances">
                  {lease.agreement.accepted_by.map((acceptance) => (
                    <li key={`${acceptance.party}-${acceptance.accepted_at}`}>
                      <span aria-hidden="true"><Icon name="check" /></span>
                      <div><strong>{acceptance.name}</strong><small>accepted on {onDate(acceptance.accepted_at)}</small></div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="agreement-evidence-empty">No acceptance has been recorded yet.</p>
              )}

              <details className="agreement-technical-record">
                <summary>
                  <span className="agreement-record-summary-copy">
                    <Icon name="audit" />
                    <span><strong>Record details</strong><small>Template and document fingerprint</small></span>
                  </span>
                  <Icon name="chevron-down" />
                </summary>
                <div className="agreement-technical-record-body">
                  <dl>
                    <div><dt>Template</dt><dd>{lease.agreement.template.version || lease.agreement.schema_version}</dd></div>
                    <div><dt>Document hash</dt><dd><code>{lease.agreement.content_hash.slice(0, 16)}…</code></dd></div>
                  </dl>
                  <p>This identifies the exact terms above. It is not an electronic signature.</p>
                </div>
              </details>
            </section>
          ) : null}

          {lease.status === "active" && charges.length ? <RentSoFar charges={charges} /> : null}

          <section className="agreement-essentials" aria-labelledby="agreement-essentials-title">
            <header className="agreement-essentials-head">
              <div>
                <p>At a glance</p>
                <h3 id="agreement-essentials-title">Key terms</h3>
              </div>
            </header>

            <dl className="agreement-glance-row">
              <div className="is-primary">
                <dt><Icon name="payments" />Move-in total</dt>
                <dd>{money(terms.moveInTotalMinor, terms.rentCurrency)}</dd>
              </div>
              <div>
                <dt>Ongoing rent</dt>
                <dd>{money(terms.rentMinor, terms.rentCurrency)}<small>per {per(terms.rentPeriod)}</small></dd>
              </div>
              <div>
                <dt>Term</dt>
                <dd>{months(terms.termMonths)}<small>{terms.endsOn ? `ends ${onDate(terms.endsOn)}` : "End not set"}</small></dd>
              </div>
              <div>
                <dt>Starts</dt>
                <dd>{terms.startsOn ? onDate(terms.startsOn) : "Not set"}</dd>
              </div>
              <div>
                <dt>Advance</dt>
                <dd>{months(terms.advanceMonths)}</dd>
              </div>
              <div>
                <dt>Deposit</dt>
                <dd>{terms.depositMonths ? months(terms.depositMonths) : "None"}</dd>
              </div>
            </dl>
          </section>
          <section className="agreement-document-reader" aria-labelledby="agreement-document-title">
            <header className="agreement-section-heading">
              <span aria-hidden="true"><Icon name="leases" /></span>
              <div>
                <h3 id="agreement-document-title">Complete agreement</h3>
                <p>Read the full terms below. The document is preserved with this record.</p>
              </div>
            </header>

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
          </section>

        </div>

        <footer className="tenant-agreement-record-footer">
          <span className="agreement-footer-note">
            <Icon name={state.decisionOpen ? "leases" : "check"} />
            {state.decisionOpen ? "Review the complete agreement before deciding" : "Saved in your agreement history"}
          </span>
          <div className="agreement-footer-actions">
            {lease.agreement?.final_pdf_url ? <DocumentActions lease={lease} /> : null}
            {state.decisionOpen ? <Decision lease={lease} terms={terms} onChanged={onChanged} /> : null}
          </div>
        </footer>
      </div>
    </div>
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

function DocumentActions({ lease }: { lease: Lease }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(kind: "download" | "print") {
    const pendingWindow = kind === "print" ? window.open("", "_blank") : null;
    setBusy(true); setError("");
    try {
      const blob = await getLeaseDocument(lease.id);
      const url = URL.createObjectURL(blob);
      if (kind === "download") {
        const link = document.createElement("a"); link.href = url;
        link.download = `rooomly-agreement-${lease.agreement?.reference_number ?? lease.id}.pdf`;
        link.click();
      } else if (pendingWindow) {
        pendingWindow.location.href = url;
        if (kind === "print") pendingWindow.addEventListener("load", () => pendingWindow.print(), { once: true });
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      pendingWindow?.close();
      setError(cause instanceof ApiFailure ? cause.error.message : "The final document could not be opened.");
    } finally { setBusy(false); }
  }
  return (
    <div className="agreement-document-actions">
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="agreement-actions">
        <Button className="agreement-document-action is-download" variant="secondary" disabled={busy} onClick={() => void run("download")}>
          <Icon name="download" />Download
        </Button>
        <Button className="agreement-document-action is-print" variant="quiet" disabled={busy} onClick={() => void run("print")}>
          <Icon name="print" />Print
        </Button>
      </div>
    </div>
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
  const [step, setStep] = useState<"choose" | "accept" | "decline">("choose");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");

  const mustAcknowledge = lease.advance_notice?.requires_acknowledgement ?? false;

  async function run(kind: "accept" | "decline", work: () => Promise<unknown>) {
    setBusy(kind);
    setError("");
    try {
      await work();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="agreement-decision">
      <h3>Your decision</h3>
      {error ? <Notice tone="error" title={error} /> : null}

      {step === "choose" ? (
        <div className="agreement-actions">
          <Button className="agreement-accept-action" onClick={() => setStep("accept")}>Accept agreement</Button>
          <Button className="agreement-decline-action" variant="quiet" onClick={() => setStep("decline")}>Decline</Button>
        </div>
      ) : step === "accept" ? (
        <div className="agreement-confirm">
          <p className="agreement-consequence">
            You are accepting {money(terms.moveInTotalMinor, terms.rentCurrency)} to move in and{" "}
            {money(terms.rentMinor, terms.rentCurrency)} per {per(terms.rentPeriod)} for{" "}
            {months(terms.termMonths)} from {terms.startsOn ? onDate(terms.startsOn) : "the agreed date"}.
          </p>
          <p className="type-caption">
            You cannot undo this yourself, and the terms cannot be changed afterwards — a different
            arrangement means a new agreement.
          </p>
          {mustAcknowledge ? (
            <Check
              label="I have read the advance-rent notice at the top of this agreement."
              checked={acknowledged}
              onChange={setAcknowledged}
            />
          ) : null}
          <div className="agreement-actions">
            <Button
              className="agreement-confirm-accept"
              busy={busy === "accept"}
              busyLabel="Accepting…"
              disabled={mustAcknowledge && !acknowledged}
              onClick={() => void run("accept", () => acceptMyLease(lease.id, acknowledged))}
            >Yes, accept it</Button>
            <Button className="agreement-back-action" variant="quiet" disabled={busy !== null} onClick={() => setStep("choose")}>
              Go back
            </Button>
          </div>
        </div>
      ) : (
        <div className="agreement-confirm">
          <p className="agreement-consequence">
            Declining ends this offer. The landlord would have to send a new one.
          </p>
          <label className="agreement-reason-field">
            <span className="type-caption">Reason (optional)</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Tell the landlord what did not work, if you want to."
            />
          </label>
          <div className="agreement-actions">
            <Button
              className="agreement-confirm-decline"
              variant="destructive"
              busy={busy === "decline"}
              busyLabel="Declining…"
              onClick={() => void run("decline", () => declineMyLease(lease.id, reason.trim()))}
            >Yes, decline it</Button>
            <Button className="agreement-back-action" variant="quiet" disabled={busy !== null} onClick={() => setStep("choose")}>
              Go back
            </Button>
          </div>
        </div>
      )}
    </section>
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
    <section className="record-section">
      <h3>Rent so far</h3>
      <ul className="agreement-charges">
        {charges.map((charge) => {
          const outstanding = charge.outstanding_minor > 0;
          return (
            <li key={charge.id}>
              <span>
                <strong>{charge.kind_display}</strong>
                <em>Due {onDate(charge.due_on)}</em>
              </span>
              <span className={outstanding && charge.is_overdue ? "is-overdue" : undefined}>
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
