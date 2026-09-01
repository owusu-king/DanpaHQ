"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  getPaymentReceipt,
  getPaymentReceiptDocument,
  paymentMethodLabel,
  type PaymentReceipt,
} from "@/lib/payments";

type DocumentAction = "view" | "download" | "print";

export default function PaymentReceiptPage() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [error, setError] = useState("");
  const [documentBusy, setDocumentBusy] = useState<DocumentAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPaymentReceipt(receiptId)
      .then((row) => {
        if (!cancelled) setReceipt(row);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof ApiFailure
              ? cause.error.message
              : "We could not load this receipt.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  async function openDocument(kind: DocumentAction) {
    if (!receipt) return;
    const pendingWindow = kind === "view" || kind === "print"
      ? window.open("", "_blank")
      : null;
    setDocumentBusy(kind);
    setError("");
    try {
      const blob = await getPaymentReceiptDocument(receipt.id);
      const url = URL.createObjectURL(blob);
      if (kind === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = `rooomly-receipt-${receipt.receipt_number}.pdf`;
        link.click();
      } else if (pendingWindow) {
        pendingWindow.location.href = url;
        if (kind === "print") {
          pendingWindow.addEventListener("load", () => pendingWindow.print(), { once: true });
        }
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      pendingWindow?.close();
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "The receipt document could not be opened.",
      );
    } finally {
      setDocumentBusy(null);
    }
  }

  const snapshot = receipt?.snapshot;
  const premises = snapshot?.premises;
  const providerName = snapshot?.provider.organization_name || snapshot?.provider.signer_name;
  const period = snapshot?.obligation.period_start && snapshot.obligation.period_end
    ? `${formatDate(snapshot.obligation.period_start)} – ${formatDate(snapshot.obligation.period_end)}`
    : "Not applicable";

  return (
    <div className="payment-journey receipt-page">
      <Link className="payment-back" href="/payments">← Payments</Link>
      <PageHeader
        title="Payment receipt"
        description="Your confirmed payment record, ready whenever you need it."
      />
      {!receipt && !error ? <LoadingRows rows={4} /> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {receipt ? (
        <article className="payment-receipt">
          <header className="payment-receipt-head">
            <div className="payment-receipt-confirmed">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>{receipt.source === "EXTERNAL" ? "External payment confirmed" : "Payment confirmed"}</strong>
                <small>{formatDateTime(receipt.issued_at)}</small>
              </div>
            </div>
            <div className="payment-receipt-reference">
              <span className="type-label">RECEIPT</span>
              <strong className="type-mono">{receipt.receipt_number}</strong>
            </div>
          </header>

          <p className="payment-receipt-amount">{receipt.amount_formatted}</p>

          {snapshot && premises ? (
            <>
              <section className="payment-receipt-home" aria-label="Premises">
                <span className="type-label">PAYMENT FOR</span>
                <h2>
                  {premises.property_title}
                  {premises.unit_label ? ` · ${premises.unit_label}` : ""}
                  {premises.bed_label ? ` · ${premises.bed_label}` : ""}
                </h2>
                <p>{premises.address.display || premises.address.locality}</p>
              </section>

              <dl className="payment-receipt-facts">
                <ReceiptFact label="Tenant" value={snapshot.tenant.name} />
                <ReceiptFact label="Received by" value={providerName || "Property provider"} />
                <ReceiptFact label="Payment for" value={snapshot.obligation.kind_label} />
                <ReceiptFact label="Period covered" value={period} />
                <ReceiptFact
                  label="Premises"
                  value={`${premises.space_type_label} · ${premises.is_furnished ? "Furnished" : "Unfurnished"}`}
                />
                <ReceiptFact label="Payment method" value={snapshot.payment.method_label} />
                <ReceiptFact label="Payment source" value={snapshot.payment.source_label} />
                <ReceiptFact label="Evidence" value={snapshot.evidence.label} />
                {snapshot.payment.source === "PLATFORM_PSP" ? <>
                  <ReceiptFact label="Processor" value={titleCase(snapshot.processor.name)} />
                  <ReceiptFact label="Transaction reference" value={snapshot.processor.transaction_id} mono />
                </> : null}
                {snapshot.payment.source === "EXTERNAL" && snapshot.payment.reference ? <ReceiptFact label="External reference" value={snapshot.payment.reference} mono /> : null}
                {snapshot.evidence.filename ? <ReceiptFact label="Attached evidence" value={snapshot.evidence.filename} /> : null}
              </dl>
            </>
          ) : (
            <dl className="payment-receipt-facts">
              <ReceiptFact label="Issued" value={formatDateTime(receipt.issued_at)} />
              <ReceiptFact label="Method" value={paymentMethodLabel(receipt.payment_method)} />
              <ReceiptFact label="Payment source" value={receipt.source === "EXTERNAL" ? "Paid externally and recorded through Rooomly" : "Processed through Rooomly"} />
              {receipt.source === "PLATFORM_PSP" ? <><ReceiptFact label="Processor" value={titleCase(receipt.provider)} /><ReceiptFact label="Transaction reference" value={receipt.provider_transaction_id} mono /></> : null}
            </dl>
          )}

          {receipt.final_document_available ? (
            <div className="payment-receipt-actions" aria-label="Receipt document actions">
              <Button
                variant="secondary"
                busy={documentBusy === "view"}
                disabled={documentBusy !== null}
                onClick={() => void openDocument("view")}
              >
                View PDF
              </Button>
              <Button
                variant="secondary"
                busy={documentBusy === "download"}
                disabled={documentBusy !== null}
                onClick={() => void openDocument("download")}
              >
                Download
              </Button>
              <Button
                variant="quiet"
                busy={documentBusy === "print"}
                disabled={documentBusy !== null}
                onClick={() => void openDocument("print")}
              >
                Print
              </Button>
            </div>
          ) : null}

          <footer>
            {snapshot?.stamp.notice || "Keep this receipt with your tenancy records."}
          </footer>
        </article>
      ) : null}
    </div>
  );
}

function ReceiptFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "type-mono" : undefined}>{value || "—"}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GH", {
    dateStyle: "medium",
    timeZone: "Africa/Accra",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  });
}

function titleCase(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "—";
}
