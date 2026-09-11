import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { BillingPaymentRecord, PlanCatalogue, PortfolioBilling } from "@/billing";
import {
  formatAmount,
  formatDate,
  historyLine,
  intervalLabel,
  invoiceDescription,
  paymentFacts,
  paymentStatusOf,
  planByCode,
  planPrice,
} from "@/billingPresentation";
import { QuietLink } from "@/components/account/IndexRows";
import { FactRow, SectionTitle, StatusBadge } from "@/components/billing/BillingParts";
import { Disclosure } from "@/components/property/WorkspacePatterns";
import { Type, space } from "@/components/ui";
import { shareReceiptDocument } from "@/paymentDocuments";
import { paymentMethodLabel } from "@/payments";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The quieter half of the screen: how the subscription is billed, what the
 * Portfolio has paid Rooomly, and how the plan got here.
 *
 * Plan, subscription, invoice and payment stay distinct. The terms are a short
 * list of facts; each payment is an invoice and what happened to its payment;
 * the plan's history is on request. Nothing here is shown for a Portfolio that
 * has never been billed — a Free plan has no billing cycle, and a row that says
 * "Next payment: —" is noise dressed as a record.
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
    <View style={{ gap: space[8] }}>
      {paid && subscription ? (
        <BillingTerms billing={billing} catalogue={catalogue} subscription={subscription} onPayEarly={onPayEarly} />
      ) : null}
      {records.length ? <Payments records={records} /> : null}
      {history.length ? (
        <Disclosure title="Plan history">
          {history.map((event) => (
            <View key={event.id} style={{ flexDirection: "row", alignItems: "baseline", gap: space[3] }}>
              <Type variant="body" style={{ flex: 1 }}>
                {historyLine(event, catalogue)}
              </Type>
              <Type variant="caption">{formatDate(event.occurred_at)}</Type>
            </View>
          ))}
        </Disclosure>
      ) : null}
    </View>
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
  const canPayEarly =
    billing.renewal.available && !lapsed && billing.viewer.can_change_plan && billing.checkout.available;

  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>Billing</SectionTitle>
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
        <FactRow label="Billing cycle" value={intervalLabel(interval)} />
        {renewal ? (
          <FactRow
            label="Next payment"
            value={renewal}
            action={canPayEarly ? <QuietLink label="Pay early" onPress={onPayEarly} /> : null}
          />
        ) : null}
        {lastPaid?.payment.method ? (
          <FactRow label="Last paid with" value={paymentMethodLabel(lastPaid.payment.method)} />
        ) : null}
        {billing.billing_account?.billing_email ? (
          <FactRow label="Billing email" value={billing.billing_account.billing_email} />
        ) : null}
      </View>
    </View>
  );
}

function Payments({ records }: { records: BillingPaymentRecord[] }) {
  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>Payments</SectionTitle>
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
        {records.map((record) => (
          <PaymentRow key={record.id} record={record} />
        ))}
      </View>
    </View>
  );
}

function PaymentRow({ record }: { record: BillingPaymentRecord }) {
  const status = paymentStatusOf(record);
  return (
    <View style={{ gap: space[2], paddingVertical: space[4], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[3] }}>
        <Type variant="bodyStrong" style={{ flex: 1 }}>
          {invoiceDescription(record)}
        </Type>
        <Type variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
          {formatAmount(record.amount_minor, record.currency)}
        </Type>
      </View>
      <Type variant="caption">{paymentFacts(record).join(" · ")}</Type>
      {record.payment.status === "failed" && record.payment.failure_message ? (
        <Type variant="caption" style={{ color: theme.color.laterite["600"] }}>
          {record.payment.failure_message}
        </Type>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] }}>
        <StatusBadge tone={status.tone} label={status.label} />
        {record.payment.receipt_id ? <ReceiptButton receiptId={record.payment.receipt_id} number={record.number} /> : null}
      </View>
    </View>
  );
}

function ReceiptButton({ receiptId, number }: { receiptId: string; number: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function open() {
    setState("busy");
    try {
      // The frozen PDF issued when the provider confirmed the payment, opened in
      // the system's document sheet to view, save or send.
      await shareReceiptDocument(receiptId, number);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Receipt for ${number}`}
      accessibilityState={{ busy: state === "busy" }}
      disabled={state === "busy"}
      hitSlop={6}
      onPress={() => void open()}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: space[2],
        paddingHorizontal: space[2],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="share-outline" size={18} color={theme.color.ink["700"]} />
      <Type variant="captionStrong" style={{ color: theme.color.ink["900"] }}>
        {state === "busy" ? "Preparing…" : state === "failed" ? "Try again" : "Receipt"}
      </Type>
    </Pressable>
  );
}
