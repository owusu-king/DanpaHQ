"use client";

import { ChevronDown, Download } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/billing/CurrentPlan";
import type { BillingPaymentRecord, PlanCatalogue, PortfolioBilling } from "@/lib/billing";
import {
  formatAmount,
  formatDate,
  historyLine,
  intervalLabel,
  invoiceDescription,
  paymentStatusOf,
  periodRange,
  planByCode,
  planPrice,
} from "@/lib/billingPresentation";
import { getPaymentReceiptDocument, paymentMethodLabel } from "@/lib/payments";

/**
 * The quieter half of the page: how the subscription is billed, what the
 * Portfolio has paid Rooomly, and how the plan got here.
 *
 * Plan, subscription, invoice and payment stay distinct. The subscription's
 * terms are a short list of facts; each payment row is an invoice and what
 * happened to its payment; the plan's history is on request. Nothing here is
 * shown for a Portfolio that has never been billed — a Free plan has no billing
 * cycle, and a row that says "Next payment: —" is noise dressed as a record.
 */
export function BillingRecords({
  billing,
  catalogue,
  onPayEarly,
}: {
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  onPayEarly: () => void;
}) {
  const subscription = billing.subscription;
  const paid = subscription?.is_live && subscription.funding === "paid";
  const records = billing.viewer.can_view_invoices ? billing.invoices : [];
  // A single "started on Free" line is not history anybody needs to open.
  const history = billing.history.length > 1 ? billing.history : [];

  if (!paid && !records.length && !history.length) return null;

  return (
    <div className="billing-records">
      {paid && subscription ? (
        <BillingTerms billing={billing} catalogue={catalogue} subscription={subscription} onPayEarly={onPayEarly} />
      ) : null}
      {records.length ? <Payments records={records} /> : null}
      {history.length ? (
        <details className="billing-history">
          <summary>
            <span>Plan history</span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <ol>
            {history.map((event) => (
              <li key={event.id}>
                <span>{historyLine(event, catalogue)}</span>
                <time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function BillingTerms({
  billing,
  catalogue,
  subscription,
  onPayEarly,
}: {
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  subscription: NonNullable<PortfolioBilling["subscription"]>;
  onPayEarly: () => void;
}) {
  const interval = subscription.billing_interval;
  const next = subscription.scheduled_plan
    ? planByCode(catalogue, subscription.scheduled_plan.code)
    : planByCode(catalogue, subscription.plan.code);
  const nextPrice = next ? planPrice(next, interval) : null;
  const lastPaid = billing.invoices.find((record) => record.payment.status === "succeeded");
  const lapsed = subscription.status === "grace_period" || subscription.status === "past_due";

  let renewal: string | null = null;
  if (!subscription.cancel_at_period_end && nextPrice !== null) {
    const amount = formatAmount(nextPrice, subscription.plan.currency);
    renewal = lapsed
      ? `${amount} · was due ${formatDate(subscription.current_period_start)}`
      : subscription.scheduled_plan
        ? `${amount} for ${subscription.scheduled_plan.name} · due ${formatDate(subscription.current_period_end)}`
        : `${amount} · due ${formatDate(subscription.current_period_end)}`;
  }

  return (
    <section className="billing-section" aria-labelledby="billing-terms-title">
      <h3 id="billing-terms-title">Billing</h3>
      <dl className="billing-terms">
        <div>
          <dt>Billing cycle</dt>
          <dd>{intervalLabel(interval)}</dd>
        </div>
        {renewal ? (
          <div>
            <dt>Next payment</dt>
            <dd>
              <span>{renewal}</span>
              {billing.renewal.available && !lapsed && billing.viewer.can_change_plan && billing.checkout.available ? (
                <button type="button" className="billing-inline-action" onClick={onPayEarly}>
                  Pay early
                </button>
              ) : null}
            </dd>
          </div>
        ) : null}
        {lastPaid?.payment.method ? (
          <div>
            <dt>Last paid with</dt>
            <dd>{paymentMethodLabel(lastPaid.payment.method)}</dd>
          </div>
        ) : null}
        {billing.billing_account?.billing_email ? (
          <div>
            <dt>Billing email</dt>
            <dd>{billing.billing_account.billing_email}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function Payments({ records }: { records: BillingPaymentRecord[] }) {
  return (
    <section className="billing-section" aria-labelledby="billing-payments-title">
      <h3 id="billing-payments-title">Payments</h3>
      <ul className="billing-payments">
        {records.map((record) => {
          const status = paymentStatusOf(record);
          return (
            <li key={record.id} className="billing-payment">
              <div className="billing-payment-what">
                <p className="billing-payment-title">{invoiceDescription(record)}</p>
                <p className="billing-payment-meta">
                  {paymentMeta(record).map((fact, index) => (
                    <span key={fact}>
                      {index > 0 ? " · " : ""}
                      <span className="billing-payment-fact">{fact}</span>
                    </span>
                  ))}
                </p>
                {record.payment.status === "failed" && record.payment.failure_message ? (
                  <p className="billing-payment-failure">{record.payment.failure_message}</p>
                ) : null}
              </div>
              <p className="billing-payment-amount">{formatAmount(record.amount_minor, record.currency)}</p>
              <StatusBadge tone={status.tone} label={status.label} />
              <div className="billing-payment-receipt">
                {record.payment.receipt_id ? (
                  <ReceiptDownload receiptId={record.payment.receipt_id} number={record.number} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * One line of facts under a payment: when, what it covered, which invoice.
 *
 * A payment that starts a period on the day it was made names only the end of
 * that period — "Paid 30 Aug 2026 · until 29 Sep 2026" — rather than printing
 * the same date twice. An early renewal, whose period starts later, names both.
 * Returned as separate facts so a narrow row wraps between them, never through
 * the middle of a date or an invoice number.
 */
function paymentMeta(record: BillingPaymentRecord): string[] {
  const occurred = formatDate(record.payment.occurred_at ?? record.issued_at);
  const verb = record.payment.status === "succeeded" ? "Paid" : record.payment.status === "failed" ? "Tried" : "Started";
  const start = formatDate(record.period_start);
  const covers = !record.period_end
    ? ""
    : start === occurred
      ? `until ${formatDate(record.period_end)}`
      : periodRange(record.period_start, record.period_end);
  return [`${verb} ${occurred}`, covers, record.number].filter(Boolean);
}

function ReceiptDownload({ receiptId, number }: { receiptId: string; number: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function download() {
    setState("busy");
    try {
      // The frozen PDF issued when the provider confirmed the payment, fetched
      // with the session rather than linked, because the document is private.
      const blob = await getPaymentReceiptDocument(receiptId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rooomly-receipt-${number}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      className="billing-receipt"
      onClick={() => void download()}
      disabled={state === "busy"}
      aria-label={`Download the receipt for ${number}`}
    >
      <Download size={16} aria-hidden="true" />
      {state === "busy" ? "Preparing…" : state === "failed" ? "Try again" : "Receipt"}
    </button>
  );
}
