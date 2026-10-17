"use client";

/**
 * One tenancy's rent account: what is owed, what has been claimed, what needs
 * an answer.
 *
 * This used to live inside a `<dialog>` on the payments page. A modal was the
 * wrong container for it — the thing is long (a summary, a review queue, a
 * schedule of charges, a payment history), it carries its own forms, and every
 * one of its actions is consequential enough that somebody may want to leave
 * it, check something, and come back. None of that survives a modal: it cannot
 * be linked to, cannot be reopened from history, and loses its scroll position
 * the moment it closes.
 *
 * Nothing about the domain moved with it. Every action still goes through the
 * same endpoints, and the server still decides what is allowed — a provider
 * without identity, Property authority and a verified receiving account is
 * refused whether or not the button is drawn.
 */

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { ReceiptModal } from "@/components/payments/ReceiptModal";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { type ProviderTenant, uploadFile } from "@/lib/console";
import { formatMoney } from "@/lib/money";
import { formatDate, paymentStatus } from "@/lib/rentDisplay";
import {
  recordRentPayment,
  getPaymentEvidenceDownload,
  rentPaymentAction,
  adjustRentCharge,
  type LeaseLedger,
  type RentCharge,
  type RentPayment,
} from "@/lib/tenant";

const PAYMENT_METHODS: [RentPayment["method"], string][] = [
  ["cash", "Cash"],
  ["momo", "Direct mobile money"],
  ["bank", "Direct bank transfer"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];

export function RentAccountDetail({
  tenant,
  tenantMode = false,
  leaseId,
  ledger,
  onChanged,
}: {
  /** Null when the lease is not in a Portfolio this account can see the tenant
   *  side of. The ledger still renders; the actions do not. */
  tenant: ProviderTenant | null;
  /** A person may also manage Properties. Keep tenant payment actions tied to
   *  the route they deliberately entered, not to whichever account role exists. */
  tenantMode?: boolean;
  leaseId: string;
  ledger: LeaseLedger;
  onChanged: () => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState<string | null>(null);
  const outstanding = ledger.financial_summary.is_post_tenancy
    ? ledger.financial_summary.outstanding_balance_minor
    : ledger.charges.reduce((total, charge) => total + charge.outstanding_minor, 0);
  const overdue = ledger.charges
    .filter((charge) => charge.is_overdue)
    .reduce((total, charge) => total + charge.outstanding_minor, 0);
  const awaiting = ledger.payments.filter((payment) => payment.awaiting_you);
  const paid = ledger.payments
    .filter((payment) => payment.is_confirmed)
    .reduce((total, payment) => total + payment.amount_minor, 0);
  const nextDue = ledger.charges
    .filter((charge) => charge.outstanding_minor > 0)
    .sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
  const ended = ledger.financial_summary.is_post_tenancy;
  const tone = ended ? "ended" : overdue > 0 ? "overdue" : outstanding > 0 ? "outstanding" : "current";
  const currency = ledger.financial_summary.currency || "GHS";
  const money = (minor: number) => formatMoney({ minor, currency });
  const history = [...ledger.payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on));

  return (
    <div className="ra">
      {/* Where the money stands, in one tinted card: the figure that matters and
          the three that explain it. Laterite when late, harmattan when due,
          kola when nothing is. */}
      <section className="ra-hero" data-tone={tone} aria-label="Balance">
        <div className="ra-hero-lead">
          <small>{ended ? "Outstanding after the tenancy" : "Outstanding"}</small>
          <strong>{money(outstanding)}</strong>
          <span>
            {overdue > 0 ? <em>{money(overdue)} overdue</em> : null}
            {overdue > 0 && nextDue ? <i aria-hidden="true">·</i> : null}
            {nextDue ? `Next due ${formatDate(nextDue.due_on)}` : outstanding === 0 ? "Nothing due" : null}
          </span>
        </div>
        <dl className="ra-hero-facts">
          <div><dt>Overdue</dt><dd data-tone={overdue > 0 ? "overdue" : undefined}>{money(overdue)}</dd></div>
          <div><dt>Paid to date</dt><dd>{money(paid)}</dd></div>
          <div><dt>Payment records</dt><dd>{ledger.payments.length}</dd></div>
        </dl>
      </section>

      {ended ? <ClosingSummary summary={ledger.financial_summary} /> : null}

      {awaiting.length ? (
        <section className="ra-panel is-review" aria-labelledby="ra-review">
          <header className="ra-panel-head">
            <span className="ra-panel-mark" aria-hidden="true"><Icon name="warning" /></span>
            <div>
              <h2 id="ra-review">Needs your review <span>{awaiting.length}</span></h2>
              <p>
                Confirm only after checking that the money was received. A claim does not change the
                balance until both parties agree.
              </p>
            </div>
          </header>
          <div className="ra-review-list">
            {awaiting.map((payment) => (
              <PaymentReview key={payment.id} payment={payment} onChanged={onChanged} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="ra-panel" aria-labelledby="ra-due">
        <header className="ra-panel-head">
          <span className="ra-panel-mark" aria-hidden="true"><Icon name="payments" /></span>
          <div>
            <h2 id="ra-due">What is due <span>{ledger.charges.length}</span></h2>
            <p>Each amount keeps its purpose and due date.</p>
          </div>
          {ledger.permissions.record_payment ? (
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setRecording(true)}>
              <Icon name="plus" />Record external payment
            </Button>
          ) : null}
        </header>
        {/* A small modal over the account, not a form pushing the charges down
            the page (owner, 2026-10-05). */}
        <ModalSheet
          open={recording}
          onClose={() => setRecording(false)}
          icon="payments"
          title="Record external payment"
          meta="Money received outside Danpa HQ."
          size="sm"
          className="payment-sheet"
        >
          {(close) => (
            <RecordPaymentForm
              leaseId={leaseId}
              charges={ledger.charges}
              onCancel={close}
              onDone={async () => {
                close();
                await onChanged();
              }}
            />
          )}
        </ModalSheet>
        {tenantMode && !ledger.digital_payment.available ? (
          <Notice
            tone="info"
            title="Online payment setup is not complete"
            body={ledger.digital_payment.reason || "Choose Pay rent to review the amount and current availability."}
          />
        ) : null}
        {ledger.charges.length ? (
          <ul className="rent-charge-list">
            {ledger.charges.map((charge) => (
              <ChargeRow
                key={charge.id}
                charge={charge}
                canWaive={ledger.financial_summary.is_post_tenancy && ledger.permissions.waive}
                canWriteOff={ledger.financial_summary.is_post_tenancy && ledger.permissions.write_off}
                payHref={
                  tenantMode && charge.outstanding_minor > 0
                    ? `/record/payment-checkout?lease=${encodeURIComponent(leaseId)}&obligation=${encodeURIComponent(charge.id)}`
                    : null
                }
                onChanged={onChanged}
              />
            ))}
          </ul>
        ) : (
          <p className="ra-quiet">No charges have been scheduled.</p>
        )}
        {!tenantMode && !ledger.permissions.record_payment ? (
          <Notice
            tone="info"
            title="Receiving actions are locked"
            body="Current identity and approved Property authority are required before a provider can record external money received. Paystack setup is not required."
          />
        ) : null}
      </section>

      <section className="ra-panel" id="payment-history" aria-labelledby="ra-history">
        <header className="ra-panel-head">
          <span className="ra-panel-mark" aria-hidden="true"><Icon name="details" /></span>
          <div>
            <h2 id="ra-history">Payment history <span>{ledger.payments.length}</span></h2>
            <p>Every record, newest first, with how it was paid and where it stands.</p>
          </div>
        </header>
        {history.length ? (
          <ul className="rent-payment-list">
            {history.map((payment) => (
              <li key={payment.id} data-tone={paymentTone(payment)}>
                <span className="ra-pay-mark" aria-hidden="true">
                  <Icon name={payment.source === "PLATFORM_PSP" ? "payments" : "details"} />
                </span>
                <div>
                  <strong>{payment.amount_formatted}</strong>
                  <span>
                    {payment.method_display} · {formatDate(payment.paid_on)}
                    {payment.obligation_label ? ` · ${payment.obligation_label}` : ""}
                  </span>
                </div>
                <div>
                  <span className="ra-pay-state">{paymentStatus(payment)}</span>
                  <span>{payment.source === "PLATFORM_PSP" ? "Processed through Danpa HQ" : "Paid externally · recorded through Danpa HQ"}</span>
                </div>
                {payment.reference || payment.evidence_file || payment.receipt_id || payment.dispute_reason ? (
                  <div className="ra-pay-extra">
                    {payment.reference ? <small>Reference {payment.reference}</small> : null}
                    {payment.evidence_file ? <PaymentEvidenceLink payment={payment} /> : null}
                    {payment.receipt_id ? <button type="button" className="rent-evidence-link" aria-haspopup="dialog" onClick={() => setReceiptOpen(payment.receipt_id)}>View receipt →</button> : null}
                    {payment.dispute_reason ? <small className="ra-dispute">{payment.dispute_reason}</small> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ra-quiet">No payment records yet.</p>
        )}
      </section>

      {tenant?.tenancy_id ? (
        <Link href={`/tenants?tenant=${tenant.tenancy_id}` as never} className="ra-related">
          <span className="ra-panel-mark" aria-hidden="true"><Icon name="users" /></span>
          <span className="ra-related-copy">
            <strong>Open tenancy</strong>
            <small>{tenant.name} · {tenant.property_title} · {tenant.unit_label}</small>
          </span>
          <span className="ra-related-go" aria-hidden="true">→</span>
        </Link>
      ) : null}
      <ReceiptModal receiptId={receiptOpen} onClose={() => setReceiptOpen(null)} />
    </div>
  );
}

/** A record's standing as a colour: confirmed kola, waiting on you amber, disputed laterite. */
function paymentTone(payment: RentPayment) {
  if (payment.evidence === "PSP_CONFIRMED" || payment.status === "confirmed") return "confirmed";
  if (payment.status === "disputed") return "disputed";
  return payment.awaiting_you ? "review" : "waiting";
}

function ClosingSummary({ summary }: { summary: LeaseLedger["financial_summary"] }) {
  const rows = [
    ["Unpaid rent", summary.unpaid_rent_minor],
    ["Other valid charges", summary.other_charges_minor],
    ["Credits", -summary.credits_minor],
    ["Waived amount", -summary.waived_minor],
    ["Written off", -summary.written_off_minor],
  ] as const;
  return (
    <section className="rent-detail-section rent-closing-summary">
      <div className="rent-section-head">
        <div>
          <h3>Closing financial summary</h3>
          <p className="type-caption">
            Tenancy ended{summary.tenancy_ended_on ? ` ${formatDate(summary.tenancy_ended_on)}` : ""}.
            Historical obligations and credits remain open until resolved.
          </p>
        </div>
      </div>
      <dl>
        {rows.filter(([, value]) => value !== 0).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{formatMoney({ minor: value, currency: summary.currency })}</dd></div>
        ))}
        <div className="is-total"><dt>Outstanding balance</dt><dd>{formatMoney({ minor: summary.outstanding_balance_minor, currency: summary.currency })}</dd></div>
        {summary.credit_balance_minor > 0 ? <div className="is-credit"><dt>Credit owed to tenant</dt><dd>{formatMoney({ minor: summary.credit_balance_minor, currency: summary.currency })}</dd></div> : null}
      </dl>
    </section>
  );
}

function PaymentReview({
  payment,
  onChanged,
}: {
  payment: RentPayment;
  onChanged: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<"confirm" | "dispute" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "confirm" | "dispute") {
    setBusy(true);
    setError("");
    try {
      await rentPaymentAction(payment.id, action, reason.trim());
      setDecision(null);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rent-review">
      <div>
        <strong>
          {payment.recorded_by_tenant
            ? `${payment.recorded_by_name} recorded ${payment.amount_formatted}`
            : `${payment.recorded_by_name} recorded receiving ${payment.amount_formatted} from you`}
        </strong>
        <span>
          {payment.method_display} · {payment.obligation_label} · {formatDate(payment.paid_on)}
        </span>
        {payment.reference ? <span>Reference {payment.reference}</span> : null}
        {payment.evidence_file ? <PaymentEvidenceLink payment={payment} /> : null}
      </div>
      {error ? <Notice tone="error" title={error} /> : null}
      {decision ? (
        <div className="rent-inline-confirm">
          <Notice
            tone="warning"
            title={decision === "confirm" ? "Confirm this payment?" : "You did not make this payment?"}
            body={
              decision === "confirm"
                ? "This confirms the external payment and applies it to the linked obligation. Danpa HQ did not process the transfer."
                : "The record remains in history as disputed and will not settle your balance."
            }
          />
          {decision === "dispute" ? (
            <Field
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
            />
          ) : null}
          <div className="rent-actions">
            <Button
              variant={decision === "dispute" ? "destructive" : "primary"}
              busy={busy}
              disabled={decision === "dispute" && !reason.trim()}
              onClick={() => void act(decision)}
            >
              {decision === "confirm" ? (payment.recorded_by_tenant ? "Confirm received" : "Confirm payment") : "Submit dispute"}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setDecision(null)}>
              Go back
            </Button>
          </div>
        </div>
      ) : (
        <div className="rent-actions">
          <Button onClick={() => setDecision("confirm")}>{payment.recorded_by_tenant ? "Confirm received" : "Confirm payment"}</Button>
          <Button variant="destructive" onClick={() => setDecision("dispute")}>
            {payment.recorded_by_tenant ? "Dispute" : "I didn’t make this payment"}
          </Button>
        </div>
      )}
    </div>
  );
}

function PaymentEvidenceLink({ payment }: { payment: RentPayment }) {
  const [busy, setBusy] = useState(false);
  if (!payment.evidence_file) return null;
  return (
    <button
      type="button"
      className="rent-evidence-link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const download = await getPaymentEvidenceDownload(payment.evidence_file!.id);
          window.open(download.url, "_blank", "noopener,noreferrer");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Opening evidence…" : `View evidence · ${payment.evidence_file.name}`}
    </button>
  );
}

function ChargeRow({
  charge,
  canWaive,
  canWriteOff,
  payHref,
  onChanged,
}: {
  charge: RentCharge;
  canWaive: boolean;
  canWriteOff: boolean;
  payHref: string | null;
  onChanged: () => Promise<void>;
}) {
  const [adjusting, setAdjusting] = useState<"waive" | "write-off" | null>(null);
  const [amount, setAmount] = useState(String(charge.outstanding_minor / 100));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const paidMinor = charge.amount_paid_minor ?? 0;
  const share = charge.amount_minor > 0 ? Math.min(1, paidMinor / charge.amount_minor) : 0;
  const tone = charge.outstanding_minor === 0 ? "settled" : charge.is_overdue ? "overdue" : paidMinor > 0 ? "part" : "due";

  return (
    <li data-tone={tone}>
      <div>
        <strong>{charge.kind_display}</strong>
        <span>
          {charge.is_overdue
            ? `${charge.days_overdue} days overdue`
            : `Due ${formatDate(charge.due_on)}`}
        </span>
      </div>
      <div className="rent-charge-amount">
        <strong>{charge.outstanding_minor === 0 ? charge.amount_formatted : charge.outstanding_formatted}</strong>
        <span>{charge.status_display}</span>
      </div>
      {/* How much of it is paid, as a bar: full and kola once settled. */}
      <span className="ra-charge-bar" aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
      {payHref ? (
        <Link className="rent-pay-action type-body-strong" href={payHref as never}>
          Pay rent
        </Link>
      ) : null}
      {(canWaive || canWriteOff) && charge.outstanding_minor > 0 && !adjusting ? (
        <div className="rent-adjustment-actions">
          {canWaive ? <button type="button" className="rent-quiet-action" onClick={() => setAdjusting("waive")}>Waive obligation</button> : null}
          {canWriteOff ? <button type="button" className="rent-quiet-action" onClick={() => setAdjusting("write-off")}>Write off obligation</button> : null}
          {charge.has_dispute ? <a className="rent-quiet-action" href="#payment-history">View dispute</a> : null}
        </div>
      ) : null}
      {adjusting ? (
        <div className="rent-charge-confirm">
          <Notice
            tone="warning"
            title={adjusting === "waive" ? "Waive this amount?" : "Write off this amount?"}
            body={adjusting === "waive"
              ? "The tenant will be released from this amount. It will remain recorded as waived, never paid."
              : "This records that collection is no longer expected. The debt remains in history and will never appear as paid."}
          />
          <Field
            label="Amount (GH₵)"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
          />
          <Field
            label={adjusting === "waive" ? "Reason for waiver" : "Reason for write-off"}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
          />
          {error ? <Notice tone="error" title={error} /> : null}
          <div className="rent-actions">
            <Button
              variant="destructive"
              busy={busy}
              disabled={!reason.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const amountMinor = Math.round(Number(amount) * 100);
                  if (!Number.isFinite(amountMinor) || amountMinor <= 0 || amountMinor > charge.outstanding_minor) {
                    setError("Enter an amount no greater than the outstanding balance.");
                    return;
                  }
                  await adjustRentCharge(charge.id, adjusting, amountMinor, reason.trim());
                  setAdjusting(null);
                  await onChanged();
                } catch (cause) {
                  setError(
                    cause instanceof ApiFailure
                      ? cause.error.message
                      : "Could not record this adjustment.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {adjusting === "waive" ? "Confirm waiver" : "Confirm write-off"}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setAdjusting(null)}>
              Go back
            </Button>
          </div>
        </div>
      ) : null}
      {charge.adjustments.length ? (
        <details className="rent-adjustment-history">
          <summary>View history</summary>
          <ul>
            {charge.adjustments.map((adjustment) => <li key={adjustment.id}>
              <span>{adjustment.kind_display} · {adjustment.amount_formatted}</span>
              <small>{formatDate(adjustment.effective_at)} · {adjustment.actor_name || "Migrated record"}</small>
              <small>{adjustment.reason}</small>
            </li>)}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export function RecordPaymentForm({
  leaseId,
  charges,
  onCancel,
  onDone,
}: {
  leaseId: string;
  charges: RentCharge[];
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const openCharges = charges.filter((charge) => charge.outstanding_minor > 0);
  const [chargeId, setChargeId] = useState(openCharges[0]?.id ?? "");
  const selected = openCharges.find((charge) => charge.id === chargeId);
  const [amount, setAmount] = useState(selected ? String(selected.outstanding_minor / 100) : "");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<RentPayment["method"]>("momo");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nothing is owed: say so, rather than an empty "Apply to" and a disabled send.
  if (!openCharges.length) {
    return (
      <div className="rent-record-form">
        <Notice
          tone="info"
          title="Nothing is owed right now"
          body="A payment is recorded against an amount due. When the next charge is raised, you can record money received for it here."
        />
        <div className="rent-actions">
          <Button variant="secondary" onClick={onCancel}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rent-record-form">
      <Notice
        tone="info"
        title="Recorded, not collected"
        body="This does not collect or transfer money. The tenant must confirm it before the balance changes."
      />
      <label className="rent-field type-caption">
        Apply to
        <select
          value={chargeId}
          onChange={(event) => {
            setChargeId(event.target.value);
            const charge = openCharges.find((row) => row.id === event.target.value);
            if (charge) setAmount(String(charge.outstanding_minor / 100));
          }}
        >
          {openCharges.map((charge) => (
            <option key={charge.id} value={charge.id}>
              {charge.kind_display} · {charge.outstanding_formatted}
            </option>
          ))}
        </select>
      </label>
      <div className="rent-form-grid">
        <Field
          label="Amount"
          prefix="GH₵"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
        />
        <Field
          label="Date received"
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
          type="date"
        />
      </div>
      <fieldset className="payment-chips">
        <legend className="type-caption">Method</legend>
        {PAYMENT_METHODS.map(([value, label]) => (
          <label key={value} className="payment-chip">
            <input
              type="radio"
              name={`payment-method-${leaseId}`}
              value={value}
              checked={method === value}
              onChange={() => setMethod(value)}
              className="control-input"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Field
        label="Reference (optional)"
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        maxLength={120}
      />
      <label className="rent-evidence-upload type-caption">
        Evidence (optional)
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
        />
        <span>{evidenceFile ? evidenceFile.name : "Screenshot or PDF, up to 8MB"}</span>
      </label>
      <Field
        label="Note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={300}
      />
      {error ? <Notice tone="error" title={error} /> : null}
      <div className="rent-actions">
        <Button
          busy={busy}
          disabled={!chargeId || !amount || !paidOn}
          onClick={async () => {
            const amountMinor = Math.round(Number(amount) * 100);
            if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
              return setError("Enter a valid amount.");
            }
            setBusy(true);
            setError("");
            try {
              let evidenceFileId: string | null = null;
              if (evidenceFile) {
                const stored = await uploadFile(evidenceFile, "payment_evidence");
                if (!stored.is_usable) throw new Error(stored.status_message || "Evidence is still being checked.");
                evidenceFileId = stored.id;
              }
              await recordRentPayment({
                lease_id: leaseId,
                charge_id: chargeId || null,
                amount_minor: amountMinor,
                paid_on: paidOn,
                method,
                reference,
                note,
                evidence_file_id: evidenceFileId,
              });
              await onDone();
            } catch (cause) {
              setError(
                cause instanceof ApiFailure
                  ? cause.error.message
                  : cause instanceof Error
                    ? cause.message
                    : "Could not record the payment.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Send for tenant confirmation
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
