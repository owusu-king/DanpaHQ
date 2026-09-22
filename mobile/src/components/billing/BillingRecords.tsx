import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

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
import { TONES } from "@/components/billing/BillingParts";
import { Fact, PREVIEW, Panel, SheetList, SmallAct, ToneWord, ViewAll } from "@/components/billing/BillingSurfaces";
import { FAINT, GroupLabel, INK, KOLA, LATERITE, MUTED, RULE, RowLine } from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Type, space } from "@/components/ui";
import { shareReceiptDocument } from "@/paymentDocuments";
import { paymentMethodLabel } from "@/payments";

/**
 * The quieter half of the screen: how the subscription is billed, what the
 * Portfolio has paid Rooomly, and how the plan got here.
 *
 * Plan, subscription, invoice and payment stay distinct. The terms are a short
 * list of facts; each payment is an invoice and what happened to its payment;
 * the plan's history is on request. Nothing here is shown for a Portfolio that
 * has never been billed — a Free plan has no billing cycle, and a row that says
 * "Next payment: —" is noise dressed as a record.
 *
 * Refined on review (2026-09-15): nothing long is laid out at once. Payments show
 * the latest few and plan history its latest events; "View all" opens every one
 * of them, newest first, in the shared sheet, which scrolls.
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
  const [sheet, setSheet] = useState<"payments" | "history" | null>(null);
  const subscription = billing.subscription;
  const paid = subscription?.is_live && subscription.funding === "paid";
  // Newest first, whatever order they arrive in: the panel shows the latest few.
  const records = useMemo(
    () => (billing.viewer.can_view_invoices ? [...billing.invoices].sort((a, b) => whenOf(b).localeCompare(whenOf(a))) : []),
    [billing],
  );
  // A single "started on Free" line is not history anybody needs to open.
  const history = useMemo(
    () => (billing.history.length > 1 ? [...billing.history].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) : []),
    [billing],
  );

  if (!paid && !records.length && !history.length) return null;

  return (
    <>
      {paid && subscription ? (
        <BillingTerms billing={billing} catalogue={catalogue} subscription={subscription} onPayEarly={onPayEarly} />
      ) : null}

      {records.length ? (
        <View style={styles.section}>
          <GroupLabel count={records.length}>Payments</GroupLabel>
          <Panel>
            {records.slice(0, PREVIEW.payments).map((record, index) => (
              <PaymentRow key={record.id} record={record} first={index === 0} />
            ))}
            {records.length > PREVIEW.payments ? <ViewAll count={records.length} noun="payments" onPress={() => setSheet("payments")} /> : null}
          </Panel>
        </View>
      ) : null}

      {history.length ? (
        <View style={styles.section}>
          <GroupLabel count={history.length}>Plan history</GroupLabel>
          <Panel>
            {history.slice(0, PREVIEW.history).map((event, index) => (
              <HistoryRow key={event.id} line={historyLine(event, catalogue)} date={formatDate(event.occurred_at)} first={index === 0} />
            ))}
            {history.length > PREVIEW.history ? <ViewAll count={history.length} noun="events" onPress={() => setSheet("history")} /> : null}
          </Panel>
        </View>
      ) : null}

      <BottomSheet visible={sheet === "payments"} onClose={() => setSheet(null)} title="Payments" closeLabel="Close payments">
        <SheetList summary={paidSummary(records)}>
          {records.map((record, index) => <PaymentRow key={record.id} record={record} first={index === 0} />)}
        </SheetList>
      </BottomSheet>
      <BottomSheet visible={sheet === "history"} onClose={() => setSheet(null)} title="Plan history" closeLabel="Close plan history">
        <SheetList>
          {history.map((event, index) => (
            <HistoryRow key={event.id} line={historyLine(event, catalogue)} date={formatDate(event.occurred_at)} first={index === 0} />
          ))}
        </SheetList>
      </BottomSheet>
    </>
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
    <View style={styles.section}>
      <GroupLabel>Billing</GroupLabel>
      <Panel>
        <Fact first icon="repeat-outline" label="Billing cycle" value={intervalLabel(interval)} />
        {renewal ? (
          <Fact
            icon="calendar-outline"
            label="Next payment"
            value={renewal}
            action={canPayEarly ? <SmallAct label="Pay early" onPress={onPayEarly} /> : null}
          />
        ) : null}
        {lastPaid?.payment.method ? (
          <Fact icon="card-outline" label="Last paid with" value={paymentMethodLabel(lastPaid.payment.method)} />
        ) : null}
        {billing.billing_account?.billing_email ? (
          <Fact icon="mail-outline" label="Billing email" value={billing.billing_account.billing_email} />
        ) : null}
      </Panel>
    </View>
  );
}

/**
 * One payment, in three lines: what it paid for against how much; when and what
 * it covered against how it went, as a word; and its invoice number beside the
 * receipt that belongs to it. Why a payment failed, when it did, sits under them.
 */
function PaymentRow({ record, first }: { record: BillingPaymentRecord; first: boolean }) {
  const status = paymentStatusOf(record);
  const failed = record.payment.status === "failed";
  const mark: keyof typeof Ionicons.glyphMap = record.payment.status === "succeeded" ? "checkmark" : failed ? "close" : "time-outline";
  // The invoice number takes the last line, beside its receipt, so it is not said twice.
  const when = paymentFacts(record).filter((fact) => fact !== record.number).join(" · ");
  return (
    <View style={[styles.payment, first ? null : styles.ruled]}>
      <View style={[styles.mark, { backgroundColor: TONES[status.tone].bg }]}>
        <Ionicons name={mark} size={15} color={TONES[status.tone].rule} />
      </View>
      <View style={styles.paymentBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={styles.title}>{invoiceDescription(record)}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={styles.amount}>{formatAmount(record.amount_minor, record.currency)}</Type>}
        />
        <RowLine
          start={<Type variant="caption" numberOfLines={2} style={styles.facts}>{when}</Type>}
          end={<ToneWord tone={status.tone} label={status.label} />}
        />
        {failed && record.payment.failure_message ? (
          <Type variant="caption" style={styles.failure}>{record.payment.failure_message}</Type>
        ) : null}
        <RowLine
          start={<Type variant="caption" numberOfLines={1} style={styles.number}>{record.number}</Type>}
          end={record.payment.receipt_id ? <ReceiptButton receiptId={record.payment.receipt_id} number={record.number} /> : null}
        />
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
    <View style={styles.receipt}>
      <SmallAct
        icon="share-outline"
        label={state === "failed" ? "Try again" : "Receipt"}
        accessibilityLabel={`Receipt for ${number}`}
        busy={state === "busy"}
        busyLabel="Preparing…"
        onPress={() => void open()}
      />
    </View>
  );
}

/** One thing that happened to the plan, as a plain sentence, and when. */
function HistoryRow({ line, date, first }: { line: string; date: string; first: boolean }) {
  return (
    <View accessible accessibilityLabel={`${line}, ${date}`} style={[styles.event, first ? null : styles.ruled]}>
      <View style={styles.eventDot} />
      <Type variant="body" style={styles.eventLine}>{line}</Type>
      <Type variant="caption" style={styles.eventDate}>{date}</Type>
    </View>
  );
}

function whenOf(record: BillingPaymentRecord) {
  return record.payment.occurred_at ?? record.issued_at;
}

/** "7 payments · GH₵534.00 paid" — the total only when every payment is in one currency. */
function paidSummary(records: BillingPaymentRecord[]) {
  const count = `${records.length} ${records.length === 1 ? "payment" : "payments"}`;
  const currencies = new Set(records.map((record) => record.currency));
  const succeeded = records.filter((record) => record.payment.status === "succeeded");
  if (currencies.size !== 1 || !succeeded.length) return count;
  const total = succeeded.reduce((sum, record) => sum + record.amount_minor, 0);
  return `${count} · ${formatAmount(total, records[0]?.currency ?? "")} paid`;
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  payment: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  mark: {
    width: 30,
    height: 30,
    marginTop: 1,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  amount: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  facts: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  failure: {
    fontSize: 12.5,
    lineHeight: 17,
    color: LATERITE,
  },
  number: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
    fontVariant: ["tabular-nums"],
  },
  receipt: {
    flexDirection: "row",
  },
  event: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  eventDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: KOLA,
  },
  eventLine: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    color: INK,
  },
  eventDate: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
    fontVariant: ["tabular-nums"],
  },
});
