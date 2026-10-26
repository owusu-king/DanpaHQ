"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  getPaymentIntent,
  listPaymentIntents,
  paystackAccessCode,
  refreshPaymentIntent,
  retryPaymentIntent,
  safeCheckoutUrl,
  type PaymentIntent,
} from "@/lib/payments";
import { openPaystackPopup } from "@/lib/paystackPopup";

export default function PaymentReturnPage() {
  const params = useSearchParams();
  const intentParam = params.get("intent") ?? "";
  const reference = params.get("reference") ?? params.get("trxref") ?? "";
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);

  const resolveIntent = useCallback(async () => {
    if (intentParam) return getPaymentIntent(intentParam);
    if (!reference) throw new Error("missing_reference");
    const rows = await listPaymentIntents();
    const match = rows.find((row) => row.client_reference === reference || row.provider_reference === reference);
    if (!match) throw new Error("unknown_reference");
    return match;
  }, [intentParam, reference]);

  const check = useCallback(async (target?: PaymentIntent) => {
    setChecking(true);
    setError("");
    try {
      const current = target ?? intent ?? await resolveIntent();
      const refreshed = ["succeeded", "cancelled"].includes(current.status)
        ? current
        : await refreshPaymentIntent(current.id);
      setIntent(refreshed);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not identify or confirm this payment yet.");
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }, [intent, resolveIntent]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void resolveIntent().then((row) => check(row)).catch(() => {
      setError("We could not identify this payment. Open it again from your rent account.");
      setLoading(false);
    });
  }, [check, resolveIntent]);

  async function retry() {
    if (!intent) return;
    setChecking(true);
    setError("");
    try {
      const next = await retryPaymentIntent(intent.id);
      setIntent(next);
      await continueCheckout(next);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "A new payment attempt could not be started.");
      setChecking(false);
    }
  }

  async function continueCheckout(target: PaymentIntent) {
    setChecking(true);
    setError("");
    if (paystackAccessCode(target)) {
      try {
        await openPaystackPopup(target, {
          onSuccess: () => void check(target),
          onCancel: () => setChecking(false),
          onError: (message) => {
            setError(message);
            setChecking(false);
          },
        });
      } catch {
        setError("Secure checkout could not open. Check your connection and try again.");
        setChecking(false);
      }
      return;
    }

    const url = safeCheckoutUrl(target);
    if (url) {
      window.location.assign(url);
      return;
    }
    setChecking(false);
    setIntent(target);
  }

  const pending = intent && ["created", "pending", "processing"].includes(intent.status);
  const unsuccessful = intent && ["failed", "expired"].includes(intent.status);
  return (
    <div className="payment-journey payment-status-page">
      <PageHeader title={intent?.status === "succeeded" ? "Payment confirmed" : "Payment status"} description={intent ? `${intent.property_title} · ${intent.unit_label}` : "Confirming securely with the payment processor."} />
      {loading ? <LoadingRows rows={3} /> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {intent?.status === "succeeded" ? (
        <>
          <div className="payment-status-mark is-success" aria-hidden="true">✓</div>
          <p className="payment-status-amount">{intent.amount_formatted}</p>
          <p className="type-caption">Your rent account has been updated. Provider settlement is tracked separately.</p>
          <div className="rent-actions">
            {intent.receipt_id ? <Link className="payment-link-button" href={`/payments?receipt=${intent.receipt_id}` as never}>View receipt</Link> : null}
            <Link className="payment-secondary-link" href={`/record/payment?leaseId=${intent.lease_id}&mode=tenant` as never}>Rent account</Link>
          </div>
        </>
      ) : pending ? (
        <>
          <Notice tone="info" title="Still confirming" body="This can take a moment. Do not start another payment for the same charge." />
          <p className="payment-status-amount">{intent.amount_formatted}</p>
          <div className="rent-actions">
            <Button busy={checking} onClick={() => void check()}>Check again</Button>
            {paystackAccessCode(intent) || safeCheckoutUrl(intent) ? <Button variant="secondary" onClick={() => void continueCheckout(intent)}>Continue checkout</Button> : null}
          </div>
        </>
      ) : unsuccessful ? (
        <>
          <Notice tone="warning" title={intent.status === "expired" ? "Payment attempt expired" : "Payment was not completed"} body={intent.failure_message || "No rent was marked paid. You can safely try again."} />
          <Button busy={checking} onClick={() => void retry()}>Try again</Button>
        </>
      ) : intent?.status === "cancelled" ? (
        <Notice tone="info" title="Payment was cancelled" body="No rent was marked paid." />
      ) : null}
      {intent ? <Link className="payment-back" href={`/record/payment?leaseId=${intent.lease_id}&mode=tenant` as never}>← Back to rent account</Link> : <Link className="payment-back" href="/home">← Back home</Link>}
    </div>
  );
}
