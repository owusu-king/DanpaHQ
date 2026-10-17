"use client";

/**
 * One payment record, opened from the Portfolio's list, over the list.
 *
 * The list carries a summary (who, how much, which way it stands); the record
 * itself — reference, note, evidence, the charge it settles, who confirmed it
 * and when, a dispute's reason — lives in the lease's ledger, so the sheet reads
 * that ledger and finds the record in it. If the record is not there (moved on,
 * or the ledger is behind), the summary still reads and the rent account is a
 * press away.
 *
 * Read top to bottom: how much and where it stands; who paid, for what; how the
 * record got here (recorded → confirmed → applied); the facts; what the payer
 * said and showed. The decision a provider owes — confirm or dispute — is
 * pinned to the foot, through the same endpoint the rent account uses.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Icon, type IconName } from "@/components/portal/icons";
import { ReceiptView } from "@/components/payments/ReceiptModal";
import { ModalViews, useModalViews } from "@/components/workspace/ModalViews";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatDate, paymentStatus, recentPaymentStatus, type RecentPayment } from "@/lib/rentDisplay";
import {
  getLeaseLedger,
  getPaymentEvidenceDownload,
  rentPaymentAction,
  type LeaseLedger,
  type RentPayment,
} from "@/lib/tenant";

type Tone = "review" | "confirmed" | "waiting" | "disputed";

export function PaymentRecordModal({
  record,
  onClose,
  onChanged,
}: {
  record: RecentPayment | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [shown, setShown] = useState<RecentPayment | null>(record);
  // Deeper views in the same sheet: the receipt, not a second dialog over it.
  const nav = useModalViews<{ kind: "receipt"; id: string }>(Boolean(record), record?.id);
  // Held while closing, so the sheet plays its exit with what it showed.
  if (record && record !== shown) setShown(record);
  const current = record ?? shown;
  if (!current) return null;
  const receipt = nav.top?.kind === "receipt" ? nav.top : null;

  return (
    <ModalSheet
      open={Boolean(record)}
      onClose={onClose}
      size="sm"
      icon="payments"
      title={receipt ? "Receipt" : "Payment record"}
      meta={receipt ? `${current.tenant_name} · ${current.property_title}` : `${current.property_title} · ${current.unit_label}`}
      className={receipt ? "receipt-sheet" : "record-sheet"}
      closeLabel="Close payment record"
      onBack={nav.depth ? nav.back : undefined}
      backLabel="Back to payment record"
      viewKey={receipt ? `receipt-${receipt.id}` : "record"}
    >
      <ModalViews depth={nav.depth} direction={nav.direction}>
        <RecordBody key={current.id} record={current} onChanged={onChanged} onViewReceipt={(id) => nav.push({ kind: "receipt", id })} />
        {nav.views.map((view) => <ReceiptView key={view.id} receiptId={view.id} />)}
      </ModalViews>
    </ModalSheet>
  );
}

function RecordBody({ record, onChanged, onViewReceipt }: { record: RecentPayment; onChanged: () => void | Promise<void>; onViewReceipt: (receiptId: string) => void }) {
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [decision, setDecision] = useState<"confirm" | "dispute" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getLeaseLedger(record.lease_id)
      .then((result) => { if (live) { setLedger(result); setLoadError(""); } })
      .catch((cause) => { if (live) setLoadError(cause instanceof ApiFailure ? cause.error.message : "Could not load this record."); });
    return () => { live = false; };
  }, [record.lease_id, attempt]);

  const payment = ledger?.payments.find((row) => row.id === record.id) ?? null;
  const charge = payment?.charge ? ledger?.charges.find((row) => row.id === payment.charge) ?? null : null;
  const loading = !ledger && !loadError;

  // The full record's standing when it has arrived; the summary's until then.
  const tone = toneOf(payment ?? record);
  const status = payment ? paymentStatus(payment) : recentPaymentStatus(record);
  const awaiting = payment ? payment.awaiting_you : record.awaiting_you;
  const amount = formatMoney({ minor: record.amount_minor, currency: record.currency });
  const recordedByTenant = payment?.recorded_by_tenant ?? record.recorded_by_tenant;
  const processed = record.source === "PLATFORM_PSP";

  async function act(action: "confirm" | "dispute") {
    if (!payment) return;
    setBusy(true);
    setError("");
    try {
      await rentPaymentAction(payment.id, action, reason.trim());
      setDecision(null);
      setAttempt((value) => value + 1);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pr">
      <section className="pr-hero" data-tone={tone} aria-label="Payment">
        <span className="pr-hero-mark" aria-hidden="true"><Icon name="payments" /></span>
        <span className="pr-amount">{amount}</span>
        <span className={`pr-state is-${tone}`}><Icon name={iconOf(tone)} />{status}</span>
        <span className="pr-hero-note">{processed ? "Processed through Danpa HQ" : "Paid directly · recorded on Danpa HQ"}</span>
      </section>

      <section className="pr-who" aria-label="Paid by">
        <span className="pr-avatar" aria-hidden="true">{initialsOf(record.tenant_name)}</span>
        <span className="pr-who-copy">
          <strong>{record.tenant_name}</strong>
          <small>{record.property_title} · {record.unit_label}</small>
        </span>
        <span className="pr-for">
          <small>For</small>
          <strong>{payment?.obligation_label ?? charge?.kind_display ?? "Rent"}</strong>
        </span>
      </section>

      <ol className="pr-track" aria-label="How this record got here">
        <TrackStep
          state="done"
          title={processed ? "Paid online" : "Recorded"}
          detail={formatDate((payment?.created_at ?? record.paid_on).slice(0, 10))}
        />
        <TrackStep
          state={tone === "disputed" ? "bad" : tone === "confirmed" ? "done" : "now"}
          title={
            tone === "disputed" ? "Disputed"
              : processed ? "Confirmed by processor"
                : tone === "confirmed" ? "Confirmed by both"
                  : awaiting ? "Your confirmation" : "Tenant’s confirmation"
          }
          detail={
            payment?.disputed_at ? formatDate(payment.disputed_at.slice(0, 10))
              : payment?.confirmed_at ? formatDate(payment.confirmed_at.slice(0, 10))
                : awaiting ? "Waiting on you" : tone === "confirmed" ? "" : "Waiting"
          }
        />
        <TrackStep
          state={tone === "confirmed" ? "done" : "todo"}
          title="Applied to balance"
          detail={tone === "confirmed" ? (charge ? `${charge.kind_display} · due ${formatDate(charge.due_on)}` : "Settled") : tone === "disputed" ? "Not applied" : "After confirmation"}
        />
      </ol>

      {loading ? <div className="pr-loading" aria-busy="true"><span /><span /><span /></div> : null}
      {loadError ? (
        <div className="pr-load-error">
          <Notice tone="error" title={loadError} />
          <Button variant="quiet" size="sm" onClick={() => { setLoadError(""); setAttempt((value) => value + 1); }}>Try again</Button>
        </div>
      ) : null}

      {ledger ? (
        <dl className="pr-facts">
          <Fact icon="clock" label="Paid on" value={formatDate(record.paid_on)} />
          <Fact icon="payments" label="Method" value={record.method_display} />
          <Fact icon="details" label="Reference" value={payment?.reference || "None given"} mono={Boolean(payment?.reference)} />
          <Fact icon="account" label={recordedByTenant ? "Recorded by tenant" : "Recorded by you"} value={payment?.recorded_by_name ?? (recordedByTenant ? record.tenant_name : "You")} />
        </dl>
      ) : null}

      {payment?.note ? (
        <blockquote className="pr-note"><small>{recordedByTenant ? "Tenant’s note" : "Note"}</small>{payment.note}</blockquote>
      ) : null}

      {payment?.evidence_file ? <EvidenceTile file={payment.evidence_file} /> : null}

      {payment?.dispute_reason ? (
        <p className="pr-dispute"><Icon name="warning" /><span><small>Dispute reason</small>{payment.dispute_reason}</span></p>
      ) : null}

      {decision ? (
        <section className={`pr-decide${decision === "dispute" ? " is-danger" : ""}`}>
          <p className="pr-decide-title">{decision === "confirm" ? (recordedByTenant ? "Confirm you received this?" : "Confirm this payment?") : "Dispute this record?"}</p>
          <p className="pr-decide-body">
            {decision === "confirm"
              ? "It settles the linked charge. Danpa HQ did not move this money."
              : "It stays in history as disputed and settles nothing."}
          </p>
          {decision === "dispute" ? (
            <Field label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} autoFocus />
          ) : null}
        </section>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      <div className="pr-actions">
        {awaiting && payment ? (
          decision ? (
            <>
              <Button
                variant={decision === "dispute" ? "destructive" : "primary"}
                busy={busy}
                disabled={decision === "dispute" && !reason.trim()}
                onClick={() => void act(decision)}
              >
                {decision === "confirm" ? (recordedByTenant ? "Confirm received" : "Confirm payment") : "Submit dispute"}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setDecision(null)}>Back</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setDecision("confirm")}><Icon name="check" />{recordedByTenant ? "Confirm received" : "Confirm payment"}</Button>
              <Button variant="quiet" onClick={() => setDecision("dispute")}>Dispute</Button>
            </>
          )
        ) : payment?.receipt_id ? (
          <Button variant="secondary" onClick={() => onViewReceipt(payment.receipt_id!)}><Icon name="details" />View receipt</Button>
        ) : null}
        <span className="pr-actions-spacer" />
        {/* No close first: leaving the page takes the sheet with it. */}
        {/* The tenant's payments, on their own page — not another sheet. */}
        <Link className="pr-account-link" href={`/record/payment?leaseId=${record.lease_id}` as never}>
          All their payments<Icon name="share" />
        </Link>
      </div>
    </div>
  );
}

function TrackStep({ state, title, detail }: { state: "done" | "now" | "bad" | "todo"; title: string; detail: string }) {
  return (
    <li data-state={state}>
      <span className="pr-track-mark" aria-hidden="true">
        {state === "done" ? <Icon name="check" /> : state === "bad" ? <Icon name="close" /> : null}
      </span>
      <span className="pr-track-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </li>
  );
}

function Fact({ icon, label, value, mono = false }: { icon: IconName; label: string; value: string; mono?: boolean }) {
  return (
    <div className="pr-fact">
      <dt><Icon name={icon} />{label}</dt>
      <dd data-mono={mono || undefined}>{value}</dd>
    </div>
  );
}

function EvidenceTile({ file }: { file: NonNullable<RentPayment["evidence_file"]> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pdf = file.content_type === "application/pdf";
  return (
    <button
      type="button"
      className="pr-evidence"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setFailed(false);
        try {
          const download = await getPaymentEvidenceDownload(file.id);
          window.open(download.url, "_blank", "noopener,noreferrer");
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="pr-evidence-mark" aria-hidden="true" data-kind={pdf ? "pdf" : "image"}>{pdf ? "PDF" : <Icon name="photos" />}</span>
      <span className="pr-evidence-copy">
        <small>Evidence</small>
        <strong>{file.name}</strong>
      </span>
      <span className="pr-evidence-open">{busy ? "Opening…" : failed ? "Try again" : "View"}<Icon name="share" /></span>
    </button>
  );
}

/** The same reading as the list's (payments page) and the rent account's. */
function toneOf(payment: { evidence: string; awaiting_you: boolean; status: string }): Tone {
  if (payment.evidence === "PSP_CONFIRMED") return "confirmed";
  if (payment.awaiting_you) return "review";
  if (payment.status === "confirmed") return "confirmed";
  if (payment.status === "disputed") return "disputed";
  return "waiting";
}

function iconOf(tone: Tone): IconName {
  return tone === "confirmed" ? "verification" : tone === "review" ? "warning" : tone === "disputed" ? "warning" : "clock";
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
