"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { agreedTerms, homeOf, money, months, per, standing } from "@/lib/agreementMeaning";
import { ApiFailure } from "@/lib/api";
import { getLeaseDocument, leaseAction, type Lease, type RenderedAgreement } from "@/lib/console";
import { acceptMyLease, declineMyLease, type RentCharge } from "@/lib/tenant";
import { onDate } from "@/lib/time";
import { Check } from "@/components/Check";

/**
 * One agreement, in full, and the decision at the end of it.
 *
 * A full workspace record beside the collection on wide screens and one pane
 * on narrow screens. The agreement is substantial, resumable work rather than
 * a quick interruption, so it does not live in a dialog.
 *
 * The order inside is still the argument, and the reason there is no sticky
 * footer: advance notice, then money, then dates, then conditions, then who is
 * party to it, then the record — and only then the two buttons. Pinning Accept
 * to the bottom of the frame would put it back in front of the reading, which
 * is the exact defect this area was rewritten to fix.
 */
export function AgreementRecord({
  lease,
  charges,
  onChanged,
}: {
  lease: Lease;
  charges: RentCharge[];
  onChanged: () => Promise<void>;
}) {
  // A pane had to be told to scroll back to the top when a different agreement
  // opened in it. A page arrives at its own beginning.
  const terms = agreedTerms(lease);
  const state = standing(lease);
  const rendered = lease.agreement?.rendered_document?.sections?.length
    ? lease.agreement.rendered_document
    : null;

  useEffect(() => {
    if (lease.workflow_version === "canonical_v1" && lease.status === "offered" && !lease.tenant_reviewed_at) {
      void leaseAction(lease.id, "review").catch(() => undefined);
    }
  }, [lease.id, lease.status, lease.tenant_reviewed_at, lease.workflow_version]);

  return (
    <div className="tenant-agreement-record">
        <div className="tenant-agreement-record-panel" key={lease.id}>
          <header className="tenant-agreement-record-head">
            <div>
              <p className={`agreement-standing is-${state.stage}`}>
                <i aria-hidden="true" />{state.line}
              </p>
              <h2>{homeOf(terms)}</h2>
              <p className="type-caption">
                With {terms.landlordName}
                {terms.address ? ` · ${terms.address}` : lease.locality_name ? ` · ${lease.locality_name}` : ""}
              </p>
            </div>
          </header>

          <div className="tenant-agreement-record-body">
            {/* The thing most likely to change the decision goes first. */}
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
                body="Its snapshot predates agreement versioning, so the terms below are read from the live record rather than a frozen copy. Check them against what you agreed."
              />
            ) : null}

            <section className="record-section">
              <h3>What it costs</h3>
              <p className="agreement-total">
                {money(terms.moveInTotalMinor, terms.rentCurrency)}
                <span> to move in</span>
              </p>
              <dl className="agreement-terms">
                <div><dt>Rent</dt><dd>{money(terms.rentMinor, terms.rentCurrency)} per {per(terms.rentPeriod)}</dd></div>
                <div><dt>Advance</dt><dd>{months(terms.advanceMonths)}</dd></div>
                <div><dt>Deposit</dt><dd>{terms.depositMonths ? months(terms.depositMonths) : "None"}</dd></div>
                <div><dt>Agency fee</dt><dd>{terms.agencyFeeMonths ? months(terms.agencyFeeMonths) : "None"}</dd></div>
              </dl>
              <p className="type-caption">Nothing is paid through Rooomly. This records what was agreed.</p>
            </section>

            <section className="record-section">
              <h3>For how long</h3>
              <dl className="agreement-terms">
                <div><dt>Starts</dt><dd>{terms.startsOn ? onDate(terms.startsOn) : "Not set"}</dd></div>
                <div><dt>Term</dt><dd>{months(terms.termMonths)}</dd></div>
                <div><dt>Ends</dt><dd>{terms.endsOn ? onDate(terms.endsOn) : "Not set"}</dd></div>
              </dl>
            </section>

            {!rendered ? <section className="record-section">
              <h3>Conditions</h3>
              <p className="agreement-conditions">
                {terms.conditions || "No additional conditions were recorded."}
              </p>
            </section> : null}

            {!rendered ? <section className="record-section">
              <h3>Between</h3>
              <dl className="agreement-terms">
                <div><dt>Landlord</dt><dd>{terms.landlordName}</dd></div>
                <div><dt>Tenant</dt><dd>{terms.tenantName}</dd></div>
              </dl>
            </section> : null}

            {rendered ? <TenantAgreementDocument document={rendered} /> : null}

            {/* Who pressed accept and when. */}
            {lease.agreement ? (
              <section className="record-section agreement-record">
                <h3>The record</h3>
                {lease.agreement.accepted_by.length ? (
                  <ul className="agreement-acceptances">
                    {lease.agreement.accepted_by.map((acceptance) => (
                      <li key={`${acceptance.party}-${acceptance.accepted_at}`}>
                        <strong>{acceptance.name}</strong>
                        <span> accepted on {onDate(acceptance.accepted_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="type-caption">Nobody has accepted this yet.</p>
                )}
                <p className="type-caption">
                  {lease.agreement.reference_number ? `${lease.agreement.reference_number} · ` : ""}
                  Template {lease.agreement.template.version || lease.agreement.schema_version} · record{" "}
                  <code>{lease.agreement.content_hash.slice(0, 16)}…</code>
                </p>
                <p className="type-caption">
                  This identifies the exact terms above. It is not an electronic signature.
                </p>
                {lease.agreement.final_pdf_url ? <DocumentActions lease={lease} /> : null}
              </section>
            ) : null}

            {lease.status === "active" && charges.length ? (
              <RentSoFar charges={charges} />
            ) : null}

            {state.decisionOpen ? (
              <Decision lease={lease} terms={terms} onChanged={onChanged} />
            ) : null}
          </div>
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
        <section key={section.key}><h4>{section.title}</h4><p>{section.body}</p></section>
      ))}
    </article>
  );
}

function DocumentActions({ lease }: { lease: Lease }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(kind: "view" | "download" | "print") {
    const pendingWindow = kind === "view" || kind === "print" ? window.open("", "_blank") : null;
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
  return <div className="agreement-confirm">{error ? <Notice tone="error" title={error} /> : null}<div className="agreement-actions"><Button variant="secondary" disabled={busy} onClick={() => void run("view")}>View PDF</Button><Button variant="secondary" disabled={busy} onClick={() => void run("download")}>Download</Button><Button variant="quiet" disabled={busy} onClick={() => void run("print")}>Print</Button></div></div>;
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
          <Button onClick={() => setStep("accept")}>Accept agreement</Button>
          <Button variant="quiet" onClick={() => setStep("decline")}>Decline</Button>
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
              busy={busy === "accept"}
              busyLabel="Accepting…"
              disabled={mustAcknowledge && !acknowledged}
              onClick={() => void run("accept", () => acceptMyLease(lease.id, acknowledged))}
            >Yes, accept it</Button>
            <Button variant="quiet" disabled={busy !== null} onClick={() => setStep("choose")}>
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
              variant="destructive"
              busy={busy === "decline"}
              busyLabel="Declining…"
              onClick={() => void run("decline", () => declineMyLease(lease.id, reason.trim()))}
            >Yes, decline it</Button>
            <Button variant="quiet" disabled={busy !== null} onClick={() => setStep("choose")}>
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
