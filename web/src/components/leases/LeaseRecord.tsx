"use client";

/**
 * One agreement, in full.
 *
 * This was the right-hand pane of a split view: a list beside a record, with
 * the first row of the list always opened into it. That was better than a modal
 * and still wrong for what it holds — the terms both parties are bound by, and
 * three irreversible actions (send, withdraw, end a tenancy). A record somebody
 * ends a tenancy from should have an address, so it can be linked to, sent to a
 * colleague, and come back from history.
 *
 * It also meant a provider arriving at Leases was always looking at *somebody's*
 * agreement, chosen for them by sort order, whether or not they had asked.
 *
 * Nothing about who may do what moved. `leaseAction` is unchanged, the actions
 * are still drawn from `lease.status`, and ending a tenancy is still confirmed
 * on a second screen with a reason.
 *
 * Preparing and sending an agreement belongs to the tenancy request it came
 * from, so a draft or a ready agreement reads here as Pending, with one way
 * back to that request — never a second Send or Discard. Each settled state has
 * its one or two actions: an active tenancy can be ended or its agreement
 * downloaded; an ended one opens its closing account. The document itself
 * offers Print.
 */

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import { downloadBlob, printPdf } from "@/lib/printDocument";
import { getLeaseDocument, leaseAction, type Lease, type RenderedAgreement } from "@/lib/console";
import { formatLeaseDate, providerLeaseStatus, providerLeaseTone } from "@/lib/leaseMeaning";
import { formatMoney } from "@/lib/money";

export function LeaseRecord({
  lease,
  onChanged,
}: {
  lease: Lease;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<"cancel" | "end" | null>(null);
  const [reason, setReason] = useState("");

  const terms = lease.agreement?.terms;
  const money = terms?.money;
  const term = terms?.term;

  async function act(action: "offer" | "confirm" | "cancel" | "end") {
    setBusy(true);
    setError("");
    try {
      await leaseAction(lease.id, action, reason.trim(), action === "end");
      setConfirmation(null);
      setReason("");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  // Downloads keep the agreement's frozen PDF. Printing requests a transient
  // copy so older agreements also receive the Unicode-capable document font.
  async function documentAction(kind: "download" | "print") {
    setBusy(true); setError("");
    try {
      const blob = await getLeaseDocument(lease.id, kind === "print");
      const filename = `danpahq-agreement-${lease.agreement?.reference_number ?? lease.id}.pdf`;
      if (kind === "download") downloadBlob(blob, filename);
      else await printPdf(blob);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The final document could not be opened.");
    } finally { setBusy(false); }
  }

  const tenantName = terms?.parties.tenant.name ?? lease.tenant_name;
  const landlordName = terms?.parties.landlord.name ?? lease.landlord_name;
  const place = [
    terms?.property.title ?? lease.property_title,
    terms?.space.unit_label ?? lease.unit_label,
    terms?.space.bed_label ?? lease.bed_label,
  ].filter(Boolean).join(" · ");
  const currency = money?.rent_currency ?? lease.rent_currency ?? "GHS";
  const rentMinor = money?.rent_minor ?? lease.rent_minor;
  const yearly = (money?.rent_period ?? lease.rent_period) === "yearly";
  const advance = money?.advance_months ?? lease.advance_months;
  const deposit = money?.deposit_months ?? lease.deposit_months;
  const agency = money?.agency_fee_months ?? lease.agency_fee_months ?? 0;
  // Older leases carry no move-in figure; it is the months due up front.
  const monthlyMinor = yearly ? Math.round(rentMinor / 12) : rentMinor;
  const moveInMinor = money?.move_in_total_minor || lease.move_in_total_minor || monthlyMinor * (advance + deposit + agency);
  const startsOn = term?.starts_on ?? lease.starts_on;
  const endsOn = term?.ends_on ?? lease.ends_on;
  const termMonths = term?.term_months ?? lease.term_months;
  const conditions = terms?.conditions ?? lease.conditions;
  // Still being prepared or sent from its tenancy request.
  const pending = lease.status === "draft" || lease.status === "ready";
  const requestHref = (lease.application ? `/applications?request=${lease.application}` : "/applications?show=agreement") as never;
  const accepted = lease.agreement?.accepted_by.length ?? Number(Boolean(lease.tenant_accepted_at)) + Number(Boolean(lease.landlord_accepted_at));

  return (
    <div className="lease-record-detail lr">
      {/* Who, and what is let. The status is in the sheet's header already. */}
      <section className="lr-parties" aria-label="Parties">
        <div className="lr-party">
          <small>Landlord</small>
          <strong>{landlordName}</strong>
        </div>
        <span className="lr-parties-join" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" focusable="false"><path d="M3 8h10m-3-3 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div className="lr-party">
          <small>Tenant</small>
          <strong>{tenantName}</strong>
        </div>
        <div className="lr-home">
          <strong>{place}</strong>
          {terms?.property.address ? <span>{terms.property.address}</span> : null}
        </div>
        <span className={`lease-row-state lr-state is-${pending ? "waiting" : providerLeaseTone(lease)}`}>
          <i />
          {pending ? "Pending" : providerLeaseStatus(lease)}
        </span>
      </section>

      <LeaseProgress lease={lease} tenantName={tenantName} />

      {error ? <Notice tone="error" title={error} /> : null}
      {lease.advance_notice ? (
        <Notice
          tone="warning"
          title={`${lease.advance_notice.months} months' advance`}
          body={lease.advance_notice.message}
        />
      ) : null}

      {/* The three figures a manager checks first. */}
      <dl className="lr-figures">
        <div>
          <dt>Rent</dt>
          <dd>{formatMoney({ minor: rentMinor, currency })}<small>/{yearly ? "yr" : "mo"}</small></dd>
        </div>
        <div>
          <dt>Move-in total</dt>
          <dd>{formatMoney({ minor: moveInMinor, currency })}</dd>
        </div>
        <div>
          <dt>Term</dt>
          <dd>{months(termMonths)}</dd>
        </div>
      </dl>

      <dl className="lr-terms">
        <div><dt>Starts</dt><dd>{formatLeaseDate(startsOn)}</dd></div>
        <div><dt>Ends</dt><dd>{endsOn ? formatLeaseDate(endsOn) : "Open-ended"}</dd></div>
        <div><dt>Advance</dt><dd>{months(advance)}</dd></div>
        <div><dt>Deposit</dt><dd>{months(deposit)}</dd></div>
        {agency ? <div><dt>Agency fee</dt><dd>{months(agency)}</dd></div> : null}
      </dl>

      {conditions ? (
        <section className="lr-block">
          <h3>Conditions</h3>
          <p>{conditions}</p>
        </section>
      ) : null}

      {lease.decline_reason ? (
        <Notice tone="info" title="Recorded reason" body={lease.decline_reason} />
      ) : null}

      {pending ? (
        <Notice
          tone="info"
          title="Pending"
          body="This agreement is still being prepared or sent from its tenancy request."
        />
      ) : null}

      {/* The agreement itself: what it is, Print in view, and the full text
          one press away rather than filling the sheet. A pending draft is read
          and sent on its tenancy request, not here. */}
      {pending ? null : lease.agreement ? (
        <section className="lr-doc" aria-label="Agreement document">
          <header className="lr-doc-head">
            <span className="lr-doc-mark" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="18" height="18" focusable="false"><path d="M6 2.75h5.5L15 6.25v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-12.5a1 1 0 0 1 1-1Z M11.25 2.75v3.75H15 M7.75 10h4.5 M7.75 13h4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="lr-doc-copy">
              <strong>{lease.agreement.reference_number ?? "Tenancy agreement"}</strong>
              <small>
                Template {lease.agreement.template.version || lease.agreement.schema_version} · {accepted} of 2 accepted
              </small>
            </span>
            {lease.agreement.final_pdf_url ? (
              <span className="lr-doc-actions">
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void documentAction("print")}>Print</Button>
              </span>
            ) : null}
          </header>
          {lease.agreement.rendered_document?.sections?.length ? (
            <details className="lr-doc-read">
              <summary>Read the full agreement</summary>
              <AgreementDocument document={lease.agreement.rendered_document} />
            </details>
          ) : null}
          <p className="lr-doc-hash" title="The fingerprint of the terms both parties accepted">
            <span>Fingerprint</span>
            <code>{lease.agreement.content_hash}</code>
          </p>
        </section>
      ) : (
        <Notice
          tone="info"
          title="Older agreement"
          body="This agreement predates frozen agreement records. The original lease fields are shown."
        />
      )}

      {confirmation ? (
        <div className="lease-record-confirm lr-confirm">
          <Notice
            tone="warning"
            title={
              confirmation === "end"
                ? "End this tenancy?"
                : "Withdraw this offer?"
            }
            body={
              confirmation === "end"
                ? "This ends the active occupancy. The Unit stays private until you deliberately publish it again."
                : "The tenant will no longer be able to accept this agreement."
            }
          />
          <Field
            label="Reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
          />
        </div>
      ) : null}

      {/* Pinned to the foot: what can be done now, and nothing else. */}
      <div className="lease-record-actions lr-actions">
        {confirmation ? (
          <>
            <Button variant="destructive" busy={busy} onClick={() => void act(confirmation)}>
              {confirmation === "end"
                ? "Confirm end tenancy"
                : "Withdraw offer"}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
                setReason("");
              }}
            >
              Go back
            </Button>
          </>
        ) : (
          <>
            {lease.status === "draft" || lease.status === "ready" ? (
              <Link className="btn btn-primary" href={requestHref}>Review to send</Link>
            ) : null}
            {lease.status === "tenant_accepted" ? (
              <Button busy={busy} busyLabel="Confirming…" onClick={() => void act("confirm")}>
                Confirm and activate tenancy
              </Button>
            ) : null}
            {lease.status === "offered" ? (
              <Button variant="quiet" disabled={busy} onClick={() => setConfirmation("cancel")}>
                Withdraw offer
              </Button>
            ) : null}
            {lease.status === "active" ? (
              <>
                <Button variant="destructive" disabled={busy} onClick={() => setConfirmation("end")}>
                  End tenancy
                </Button>
                {lease.agreement?.final_pdf_url ? (
                  <Button variant="secondary" disabled={busy} onClick={() => void documentAction("download")}>
                    Download
                  </Button>
                ) : null}
              </>
            ) : null}
            {lease.status === "ended" ? (
              <Link className="btn btn-secondary" href={`/payments/${lease.id}` as never}>
                Open closing account
              </Link>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Where the agreement has got to, as four stops: prepared, sent, accepted by
 * the tenant, active. A declined or withdrawn agreement stops where it
 * stopped, in red; an ended tenancy completes the track.
 */
function LeaseProgress({ lease, tenantName }: { lease: Lease; tenantName: string }) {
  const order = ["draft", "ready", "offered", "tenant_accepted", "awaiting_activation", "active", "ended"];
  const reached = order.indexOf(lease.status);
  const stopped = lease.status === "declined" || lease.status === "cancelled";
  const past = (index: number) => !stopped && reached >= index;
  const steps = [
    { label: "Prepared", detail: lease.ready_at, done: past(1) || stopped },
    { label: "Sent", detail: null as string | null, done: past(2) || (stopped && Boolean(lease.tenant_reviewed_at || lease.status === "declined")) },
    {
      label: lease.status === "declined" ? "Declined" : "Accepted",
      detail: lease.tenant_accepted_at,
      done: past(3),
      bad: lease.status === "declined",
    },
    {
      label: lease.status === "cancelled" ? "Withdrawn" : lease.status === "ended" ? "Ended" : "Active",
      detail: lease.provider_confirmed_at ?? lease.landlord_accepted_at,
      done: past(5),
      bad: lease.status === "cancelled",
    },
  ];
  const current = stopped ? -1 : steps.findIndex((step) => !step.done);
  return (
    <ol className="lr-track" aria-label={`Agreement progress, with ${tenantName}`}>
      {steps.map((step, index) => (
        <li key={step.label} data-state={step.bad ? "bad" : step.done ? "done" : index === current ? "now" : "todo"}>
          <span className="lr-track-mark" aria-hidden="true" />
          <strong>{step.label}</strong>
          {step.detail ? <small>{formatLeaseDate(step.detail)}</small> : index === current ? <small>Waiting</small> : null}
        </li>
      ))}
    </ol>
  );
}

function months(value: number) {
  return `${value} month${value === 1 ? "" : "s"}`;
}

function AgreementDocument({ document }: { document: RenderedAgreement }) {
  return (
    <article className="lease-document lease-record-document">
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
