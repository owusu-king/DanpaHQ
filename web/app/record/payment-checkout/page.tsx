"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Radio } from "@/components/Check";
import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  createPaymentIntent,
  listPaymentIntents,
  paystackAccessCode,
  paymentMethodLabel,
  safeCheckoutUrl,
  type DigitalPaymentMethod,
  type PaymentIntent,
} from "@/lib/payments";
import { openPaystackPopup } from "@/lib/paystackPopup";
import { getLeaseLedger, type LeaseLedger } from "@/lib/tenant";

export default function PaymentCheckoutPage() {
  const router = useRouter();
  const params = useSearchParams();
  const leaseId = params.get("lease") ?? "";
  const obligationId = params.get("obligation") ?? "";
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [existing, setExisting] = useState<PaymentIntent | null>(null);
  const [method, setMethod] = useState<DigitalPaymentMethod>("mobile_money");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!leaseId || !obligationId) {
      setError("This payment link is incomplete.");
      setLoading(false);
      return;
    }
    Promise.all([getLeaseLedger(leaseId), listPaymentIntents()])
      .then(([nextLedger, intents]) => {
        if (cancelled) return;
        setLedger(nextLedger);
        const open = intents.find(
          (intent) => intent.obligation_id === obligationId &&
            ["created", "pending", "processing"].includes(intent.status),
        );
        setExisting(open ?? null);
        setMethod(nextLedger.digital_payment.methods[0] ?? "mobile_money");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiFailure ? cause.error.message : "We could not prepare checkout.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leaseId, obligationId]);

  const charge = useMemo(
    () => ledger?.charges.find((row) => row.id === obligationId) ?? null,
    [ledger, obligationId],
  );

  async function continueIntent(intent: PaymentIntent) {
    setBusy(true);
    setError("");
    const returnToDanpaHQ = () => {
      router.push(`/record/payment-return?intent=${encodeURIComponent(intent.id)}` as never);
    };
    const accessCode = paystackAccessCode(intent);
    if (accessCode) {
      try {
        await openPaystackPopup(intent, {
          onSuccess: returnToDanpaHQ,
          onCancel: () => setBusy(false),
          onError: (message) => {
            setError(message);
            setBusy(false);
          },
        });
      } catch {
        setError("Secure checkout could not open. Check your connection and try again.");
        setBusy(false);
      }
      return;
    }

    // Intents created before popup support do not have an access code. Let
    // those expire naturally only if their original hosted checkout is also
    // unavailable; otherwise preserve their one-time continuation path.
    const checkoutUrl = safeCheckoutUrl(intent);
    if (checkoutUrl) {
      window.location.assign(checkoutUrl);
      return;
    }
    setBusy(false);
    returnToDanpaHQ();
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const intent = await createPaymentIntent(obligationId, method);
      await continueIntent(intent);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Checkout could not be started.");
      setBusy(false);
    }
  }

  return (
    <div className="payment-journey">
      <Link className="payment-back" href={`/record/payment?leaseId=${leaseId}&mode=tenant` as never}>← Rent account</Link>
      <PageHeader title="Review payment" description="Confirm the obligation and choose how to pay." />
      {loading ? <LoadingRows rows={3} /> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {!loading && ledger && charge ? (
        <>
          <section className="payment-review-block">
            <div>
              <span className="type-caption">You are paying</span>
              <strong>{charge.kind_display}</strong>
              <span className="type-caption">Due {formatDate(charge.due_on)}</span>
            </div>
            <strong className="payment-review-amount">{charge.outstanding_formatted}</strong>
          </section>

          {existing ? (
            <Notice
              tone="info"
              title="A payment is already in progress"
              body="Continue the existing attempt so the same obligation is never charged twice."
            />
          ) : ledger.digital_payment.available ? (
            <section className="payment-method-section">
              <h2>Payment method</h2>
              <div className="payment-methods" role="radiogroup" aria-label="Payment method">
                {ledger.digital_payment.methods.map((value) => (
                  <Radio
                    key={value}
                    name="payment-method"
                    checked={method === value}
                    onChange={(checked) => { if (checked) setMethod(value); }}
                    label={paymentMethodLabel(value)}
                  />
                ))}
              </div>
            </section>
          ) : (
            <Notice tone="info" title="Online payment is not available" body={ledger.digital_payment.reason || "Use the payment arrangement agreed with your provider."} />
          )}

          <div className="payment-total">
            <span>Total you pay</span>
            <strong>{charge.outstanding_formatted}</strong>
            <small>Any payment processing fee is paid by the property owner.</small>
          </div>
          {existing ? (
            <Button busy={busy} busyLabel="Opening secure checkout…" onClick={() => void continueIntent(existing)}>Continue payment</Button>
          ) : ledger.digital_payment.available ? (
            <Button busy={busy} busyLabel="Opening secure checkout…" onClick={() => void start()}>
              Continue securely
            </Button>
          ) : null}
          <p className="payment-trust-note type-caption">Danpa HQ confirms payment with the processor. A browser return alone never marks rent as paid.</p>
        </>
      ) : null}
      {!loading && ledger && !charge ? <Notice tone="error" title="This charge is no longer available." /> : null}
    </div>
  );
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
