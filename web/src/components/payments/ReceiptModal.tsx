"use client";

/**
 * A payment receipt, read as the document it is, over whatever opened it.
 *
 * The receipt is shown first — an invoice-shaped page: who paid whom, for what
 * and which period, how, and the reference — and printing is offered after it
 * has been read. There is no separate receipt page: everything is here. Print
 * prints this receipt; Download saves the PDF issued with it.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import { getPaymentReceipt, getPaymentReceiptDocument, paymentMethodLabel, type PaymentReceipt } from "@/lib/payments";
import { downloadBlob, printPdf } from "@/lib/printDocument";

export function ReceiptModal({ receiptId, onClose }: { receiptId: string | null; onClose: () => void }) {
  const [shown, setShown] = useState<string | null>(receiptId);
  // Held while closing, so the sheet plays its exit with what it showed.
  if (receiptId && receiptId !== shown) setShown(receiptId);
  const current = receiptId ?? shown;
  if (!current) return null;
  return (
    <ModalSheet
      open={Boolean(receiptId)}
      onClose={onClose}
      size="sm"
      icon="payments"
      title="Receipt"
      meta="Confirmed payment"
      className="receipt-sheet"
      closeLabel="Close receipt"
    >
      <ReceiptView key={current} receiptId={current} />
    </ModalSheet>
  );
}

export function ReceiptView({ receiptId }: { receiptId: string }) {
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"download" | "print" | null>(null);

  useEffect(() => {
    let live = true;
    getPaymentReceipt(receiptId)
      .then((row) => { if (live) setReceipt(row); })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "We could not load this receipt."); });
    return () => { live = false; };
  }, [receiptId]);

  // Print uses a Unicode-safe copy of the frozen snapshot. Download remains
  // the exact PDF issued with the receipt.
  async function print() {
    if (!receipt) return;
    setBusy("print");
    setError("");
    try {
      await printPdf(await getPaymentReceiptDocument(receipt.id, true));
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The receipt could not be printed.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    if (!receipt) return;
    setBusy("download");
    setError("");
    try {
      downloadBlob(await getPaymentReceiptDocument(receipt.id), `danpahq-receipt-${receipt.receipt_number}.pdf`);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The receipt document could not be downloaded.");
    } finally {
      setBusy(null);
    }
  }

  if (!receipt) {
    return (
      <div className="rc-wrap">
        {error ? <Notice tone="error" title={error} /> : <div className="rc-loading" aria-busy="true"><span /><span /><span /><span /></div>}
      </div>
    );
  }

  const snapshot = receipt.snapshot;
  const premises = snapshot?.premises;
  const provider = snapshot ? snapshot.provider.organization_name || snapshot.provider.signer_name : "";
  const place = premises ? [premises.property_title, premises.unit_label, premises.bed_label].filter(Boolean).join(" · ") : "";
  const period = snapshot?.obligation.period_start && snapshot.obligation.period_end
    ? `${day(snapshot.obligation.period_start)} – ${day(snapshot.obligation.period_end)}`
    : null;
  const external = receipt.source === "EXTERNAL";
  const reference = external ? snapshot?.payment.reference : receipt.provider_transaction_id || snapshot?.processor.transaction_id;

  return (
    <div className="rc-wrap">
      <article className="rc" aria-label={`Receipt ${receipt.receipt_number}`}>
        <header className="rc-head">
          <div className="rc-brand">
            <strong>Danpa HQ</strong>
            <small>Payment receipt</small>
          </div>
          <div className="rc-number">
            <small>Receipt no.</small>
            <strong>{receipt.receipt_number}</strong>
            <small>{dateTime(receipt.issued_at)}</small>
          </div>
        </header>

        <div className="rc-amount">
          <small>Amount received</small>
          <strong>{receipt.amount_formatted}</strong>
          <span className="rc-paid"><Icon name="check" />{external ? "Paid directly · confirmed" : "Paid online · confirmed"}</span>
        </div>

        {snapshot ? (
          <div className="rc-parties">
            <div>
              <small>Received from</small>
              <strong>{snapshot.tenant.name}</strong>
              {place ? <span>{place}</span> : null}
            </div>
            <div>
              <small>Received by</small>
              <strong>{provider || "Property provider"}</strong>
              {premises?.address.display || premises?.address.locality ? <span>{premises.address.display || premises.address.locality}</span> : null}
            </div>
          </div>
        ) : null}

        <table className="rc-lines">
          <thead><tr><th scope="col">Description</th><th scope="col">Amount</th></tr></thead>
          <tbody>
            <tr>
              <td>
                <strong>{snapshot?.obligation.kind_label ?? "Payment"}</strong>
                {period ? <small>{period}</small> : snapshot?.obligation.due_on ? <small>Due {day(snapshot.obligation.due_on)}</small> : null}
              </td>
              <td>{receipt.amount_formatted}</td>
            </tr>
          </tbody>
          <tfoot><tr><th scope="row">Total paid</th><td>{receipt.amount_formatted}</td></tr></tfoot>
        </table>

        <dl className="rc-meta">
          <div><dt>Method</dt><dd>{snapshot?.payment.method_label ?? paymentMethodLabel(receipt.payment_method)}</dd></div>
          <div><dt>{external ? "Reference" : "Transaction"}</dt><dd data-mono={reference ? "" : undefined}>{reference || "—"}</dd></div>
          <div><dt>Source</dt><dd>{snapshot?.payment.source_label ?? (external ? "Paid externally, recorded through Danpa HQ" : "Processed through Danpa HQ")}</dd></div>
          {snapshot?.evidence.label ? <div><dt>Evidence</dt><dd>{snapshot.evidence.label}</dd></div> : null}
        </dl>

        <footer className="rc-foot">{snapshot?.stamp.notice || "Keep this receipt with your tenancy records."}</footer>
      </article>

      {error ? <Notice tone="error" title={error} /> : null}

      <div className="rc-actions">
        <Button variant="secondary" busy={busy === "print"} busyLabel="Preparing…" onClick={() => void print()}><Icon name="print" />Print</Button>
        <span className="rc-actions-spacer" />
        <Button
          busy={busy === "download"}
          busyLabel="Downloading…"
          disabled={!receipt.final_document_available}
          title={receipt.final_document_available ? undefined : "The PDF is still being issued"}
          onClick={() => void download()}
        >
          <Icon name="download" />Download
        </Button>
      </div>
    </div>
  );
}

function day(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GH", { dateStyle: "medium", timeZone: "Africa/Accra" });
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" });
}
