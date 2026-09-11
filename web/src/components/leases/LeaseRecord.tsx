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
 */

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
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

  async function documentAction(kind: "view" | "download" | "print") {
    const pendingWindow = kind === "view" || kind === "print" ? window.open("", "_blank") : null;
    setBusy(true); setError("");
    try {
      const blob = await getLeaseDocument(lease.id);
      const url = URL.createObjectURL(blob);
      if (kind === "download") {
        const link = document.createElement("a");
        link.href = url;
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
    <div className="lease-record-detail">
      <div className="lease-record-place">
        <p className="type-body-strong">
          {terms?.property.title ?? lease.property_title}
          {(terms?.space.unit_label ?? lease.unit_label)
            ? ` · ${terms?.space.unit_label ?? lease.unit_label}`
            : ""}
          {(terms?.space.bed_label ?? lease.bed_label)
            ? ` · ${terms?.space.bed_label ?? lease.bed_label}`
            : ""}
        </p>
        {terms?.property.address ? <p className="type-caption">{terms.property.address}</p> : null}
        <span className={`lease-row-state is-${providerLeaseTone(lease)}`}>
          <i />
          {providerLeaseStatus(lease)}
        </span>
      </div>

      {error ? <Notice tone="error" title={error} /> : null}
      {lease.advance_notice ? (
        <Notice
          tone="warning"
          title={`${lease.advance_notice.months} months' advance`}
          body={lease.advance_notice.message}
        />
      ) : null}

      <dl className="lease-record-money">
        <div>
          <dt>Rent</dt>
          <dd>
            {money
              ? formatMoney({ minor: money.rent_minor, currency: money.rent_currency })
              : lease.rent_formatted}
            <small>
              {" "}
              per {money?.rent_period === "yearly" || lease.rent_period === "yearly" ? "year" : "month"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Move-in total</dt>
          <dd>
            {money
              ? formatMoney({ minor: money.move_in_total_minor, currency: money.rent_currency })
              : lease.move_in_total_formatted}
          </dd>
        </div>
      </dl>

      <dl className="lease-record-facts">
        <div>
          <dt>Starts</dt>
          <dd>{formatLeaseDate(term?.starts_on ?? lease.starts_on)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>
            {(term?.ends_on ?? lease.ends_on)
              ? formatLeaseDate((term?.ends_on ?? lease.ends_on)!)
              : `${term?.term_months ?? lease.term_months} months`}
          </dd>
        </div>
        <div>
          <dt>Advance</dt>
          <dd>{money?.advance_months ?? lease.advance_months} months</dd>
        </div>
        <div>
          <dt>Deposit</dt>
          <dd>{money?.deposit_months ?? lease.deposit_months} months</dd>
        </div>
      </dl>

      {(terms?.conditions ?? lease.conditions) ? (
        <section className="lease-record-section">
          <h3>Conditions</h3>
          <p>{terms?.conditions ?? lease.conditions}</p>
        </section>
      ) : null}

      {lease.agreement?.rendered_document?.sections?.length ? (
        <AgreementDocument document={lease.agreement.rendered_document} />
      ) : null}

      <section className="lease-record-section">
        <h3>Acceptance</h3>
        <p className="type-caption">
          {lease.tenant_accepted_at
            ? `${terms?.parties.tenant.name ?? lease.tenant_name} accepted ${formatLeaseDate(lease.tenant_accepted_at)}.`
            : `Waiting for ${terms?.parties.tenant.name ?? lease.tenant_name}.`}{" "}
          {lease.landlord_accepted_at
            ? `Provider accepted ${formatLeaseDate(lease.landlord_accepted_at)}.`
            : ""}
        </p>
      </section>

      {lease.decline_reason ? (
        <Notice tone="info" title="Recorded reason" body={lease.decline_reason} />
      ) : null}

      {lease.agreement ? (
        <details className="lease-record-evidence">
          <summary>Agreement record</summary>
          <p>
            {lease.agreement.reference_number ? `${lease.agreement.reference_number} · ` : ""}
            Template {lease.agreement.template.version || lease.agreement.schema_version} · {lease.agreement.accepted_by.length}{" "}
            acceptance record{lease.agreement.accepted_by.length === 1 ? "" : "s"}
          </p>
          <code>{lease.agreement.content_hash}</code>
          {lease.agreement.final_pdf_url ? (
            <div className="lease-record-actions">
              <Button variant="secondary" disabled={busy} onClick={() => void documentAction("view")}>View PDF</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void documentAction("download")}>Download</Button>
              <Button variant="quiet" disabled={busy} onClick={() => void documentAction("print")}>Print</Button>
            </div>
          ) : null}
        </details>
      ) : (
        <Notice
          tone="warning"
          title="Older agreement"
          body="This agreement predates frozen agreement records. The original lease fields are shown."
        />
      )}

      {confirmation ? (
        <div className="lease-record-confirm">
          <Notice
            tone="warning"
            title={
              confirmation === "end"
                ? "End this tenancy?"
                : lease.status === "draft"
                  ? "Discard this draft?"
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
          <div className="lease-record-actions">
            <Button variant="destructive" busy={busy} onClick={() => void act(confirmation)}>
              {confirmation === "end"
                ? "Confirm end tenancy"
                : lease.status === "draft"
                  ? "Discard draft"
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
          </div>
        </div>
      ) : (
        <div className="lease-record-actions">
          {lease.status === "draft" || lease.status === "ready" ? (
            <>
              <Button busy={busy} onClick={() => void act("offer")}>
                Send agreement
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => setConfirmation("cancel")}
              >
                Discard draft
              </Button>
            </>
          ) : null}
          {lease.status === "tenant_accepted" ? (
            <Button busy={busy} busyLabel="Confirming…" onClick={() => void act("confirm")}>
              Confirm and activate tenancy
            </Button>
          ) : null}
          {lease.status === "offered" ? (
            <Button variant="destructive" disabled={busy} onClick={() => setConfirmation("cancel")}>
              Withdraw offer
            </Button>
          ) : null}
          {lease.status === "active" ? (
            <Button variant="destructive" disabled={busy} onClick={() => setConfirmation("end")}>
              End tenancy
            </Button>
          ) : null}
          {lease.status === "ended" ? (
            <Link className="rent-pay-action type-body-strong" href={`/payments/${lease.id}` as never}>
              Open closing financial account
            </Link>
          ) : null}
        </div>
      )}

      <section className="lease-record-section">
        <h3>Related record</h3>
        <p>
          <Link
            href={
              (terms
                ? `/properties/${terms.property.id}/spaces/${terms.space.unit_id}`
                : "/properties") as never
            }
            className="type-body-strong"
          >
            {terms ? "Open Unit" : "Open Properties"} →
          </Link>
        </p>
      </section>
    </div>
  );
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
