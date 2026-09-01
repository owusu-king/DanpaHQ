import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { Notice, Type, space } from "@/components/ui";
import { getLeaseLedger, type LeaseLedger, type RentCharge, type RentPayment } from "@/leases";
import { formatMinor } from "@/listings";
import { listPaymentIntents, type PaymentIntent } from "@/payments";
import { pressableFeedback } from "@/platform";
import { listMyTenancies, tenancyLabel, type Tenancy } from "@/tenancy";
import { theme } from "@/theme";

type Account = { tenancy: Tenancy; ledger: LeaseLedger };
type DueRow = { account: Account; charge: RentCharge; intent: PaymentIntent | null };
type HistoryRow = { account: Account; payment: RentPayment; receiptId: string | null };
type ViewName = "due" | "history";

const OPEN_INTENT = new Set(["created", "pending", "processing"]);
const FAILED_INTENT = new Set(["failed", "expired", "cancelled"]);

export default function TenantPaymentsScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [view, setView] = useState<ViewName>("due");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const [tenancies, paymentIntents] = await Promise.all([
        listMyTenancies(true),
        listPaymentIntents(),
      ]);
      const withLease = tenancies.filter((tenancy) => tenancy.lease?.id);
      const rows = await Promise.all(withLease.map(async (tenancy) => ({
        tenancy,
        ledger: await getLeaseLedger(tenancy.lease!.id),
      })));
      setAccounts(rows);
      setIntents(paymentIntents);
      setError("");
    } catch (cause) {
      setAccounts([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your payments.");
    }
  }, [signedIn]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const dueRows = useMemo<DueRow[]>(() => (accounts ?? []).flatMap((account) =>
    account.ledger.charges.filter((charge) => charge.outstanding_minor > 0).map((charge) => ({
      account,
      charge,
      intent: intents.find((intent) => intent.obligation_id === charge.id && OPEN_INTENT.has(intent.status)) ?? null,
    }))).sort((a, b) => Number(b.charge.is_overdue) - Number(a.charge.is_overdue)
      || a.charge.due_on.localeCompare(b.charge.due_on)), [accounts, intents]);
  const history = useMemo<HistoryRow[]>(() => (accounts ?? []).flatMap((account) =>
    account.ledger.payments.map((payment) => ({
      account,
      payment,
      receiptId: payment.receipt_id,
    }))).sort((a, b) => b.payment.paid_on.localeCompare(a.payment.paid_on)), [accounts]);
  const unsuccessful = useMemo(() => intents.filter((intent) => FAILED_INTENT.has(intent.status))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [intents]);
  const outstanding = dueRows.reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const overdue = dueRows.filter((row) => row.charge.is_overdue)
    .reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const inProgress = dueRows.filter((row) => row.intent).length;
  const confirmationRows = (accounts ?? []).flatMap((account) => account.ledger.payments
    .filter((payment) => payment.awaiting_you).map((payment) => ({ account, payment })));

  if (!signedIn) {
    return <AuthPrompt title="Your payments" body="Sign in to see rent due, payment activity and receipts for every home." next="/(app)/(tabs)/payments" />;
  }

  return <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }}>
    <View style={{ gap: space[1] }}>
      <Type variant="label">RENT & PAYMENTS</Type>
      <Type variant="display2" accessibilityRole="header">Payments</Type>
      <Type variant="body">Rent due, secure payments and the records you keep.</Type>
    </View>
    {error ? <Notice tone="error" title={error} /> : null}
    {accounts === null ? <Type variant="caption">Loading your payments…</Type> : null}
    {accounts?.length === 0 && !error ? <Notice tone="info" title="No rent account yet" body="Your payments will appear here when an agreement creates a rent schedule." /> : null}
    {accounts?.length ? <>
      {overdue > 0 ? <Attention title={`${formatMinor(overdue)} overdue`} detail="Open the affected rent item below." tone="overdue" /> : null}
      {inProgress > 0 ? <Attention title={`${inProgress} payment ${inProgress === 1 ? "in progress" : "attempts in progress"}`} detail="Continue or check status—do not pay the same item again." tone="pending" /> : null}
      <View style={{ paddingVertical: space[4], borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.field["200"], gap: space[4] }}>
        <View style={{ flexDirection: "row", gap: space[5] }}><Fact label="Outstanding" value={formatMinor(outstanding)} /><Fact label="Overdue" value={formatMinor(overdue)} overdue={overdue > 0} /></View>
        <Fact label="Homes with rent accounts" value={String(accounts.length)} />
      </View>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
        <Tab label={`Due now · ${dueRows.length}`} selected={view === "due"} onPress={() => setView("due")} />
        <Tab label={`History · ${history.length + unsuccessful.length}`} selected={view === "history"} onPress={() => setView("history")} />
      </View>
      {view === "due" ? <View accessibilityRole="list" style={{ gap: 0 }}>
        {confirmationRows.map(({ account, payment }) => <Pressable key={payment.id} accessibilityRole="button" accessibilityLabel={`Review external payment of ${payment.amount_formatted} recorded by ${payment.recorded_by_name}.`} onPress={() => openAccount(router, account.tenancy)} {...pressableFeedback(theme.color.harmattan["100"])} style={{ padding: space[4], marginBottom: space[3], gap: space[2], backgroundColor: theme.color.harmattan["100"], borderLeftWidth: 3, borderLeftColor: theme.color.harmattan["500"] }}><Type variant="label">CONFIRM AN EXTERNAL PAYMENT</Type><Type variant="bodyStrong">{payment.recorded_by_name} recorded receiving {payment.amount_formatted} from you via {payment.method_display}.</Type><Type variant="caption">{payment.obligation_label} · {account.tenancy.property.title}</Type><Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>Review payment →</Type></Pressable>)}
        {dueRows.length ? dueRows.map(({ account, charge, intent }) => <DueItem
          key={charge.id}
          account={account}
          charge={charge}
          intent={intent}
          onPress={() => {
            if (intent) {
              router.push({ pathname: "/(app)/payment-status", params: { intentId: intent.id } } as never);
            } else {
              router.push({ pathname: "/(app)/payment-checkout", params: { leaseId: account.tenancy.lease!.id, obligationId: charge.id } } as never);
            }
          }}
        />) : <Empty title="Nothing due" detail="New rent items will appear here with their purpose and due date." />}
        {dueRows.some((row) => !row.account.ledger.digital_payment.available && !row.intent) ? <Type variant="caption" style={{ marginTop: space[4] }}>Choose Pay rent to review the amount and current payment availability. Rooomly will explain anything this home still needs before checkout can begin.</Type> : null}
      </View> : <View accessibilityRole="list">
        {history.length ? history.map(({ account, payment, receiptId }) => <HistoryItem key={payment.id} account={account} payment={payment} action={receiptId ? "Receipt" : "Details"} onPress={() => receiptId
          ? router.push({ pathname: "/(app)/payment-receipt", params: { receiptId } } as never)
          : openAccount(router, account.tenancy)} />) : <Empty title="No completed payment records" detail="Processor-confirmed and mutually confirmed payments will remain here." />}
        {unsuccessful.length ? <View style={{ gap: space[2], marginTop: space[8] }}><Type variant="bodyStrong" accessibilityRole="header">Unsuccessful attempts</Type><Type variant="caption">These attempts did not mark rent as paid.</Type>{unsuccessful.map((intent) => <View key={intent.id} style={{ minHeight: 72, paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"], flexDirection: "row", gap: space[3] }}><View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{intent.property_title}</Type><Type variant="caption">{intent.payment_method.replaceAll("_", " ")} · {formatDate(intent.updated_at)}</Type></View><View style={{ alignItems: "flex-end", gap: space[1] }}><Type variant="bodyStrong">{intent.amount_formatted}</Type><Type variant="caption">{intent.status === "failed" ? "Not completed" : sentenceCase(intent.status)}</Type></View></View>)}</View> : null}
      </View>}
    </> : null}
  </ScrollView>;
}

function Attention({ title, detail, tone }: { title: string; detail: string; tone: "overdue" | "pending" }) {
  return <View style={{ padding: space[3], gap: space[1], borderLeftWidth: 3, borderLeftColor: tone === "overdue" ? theme.color.laterite["600"] : theme.color.harmattan["500"], backgroundColor: theme.color.field["0"] }}><Type variant="bodyStrong">{title}</Type><Type variant="caption">{detail}</Type></View>;
}
function Fact({ label, value, overdue = false }: { label: string; value: string; overdue?: boolean }) {
  return <View style={{ flex: 1, minWidth: 120, gap: space[1] }}><Type variant="caption">{label}</Type><Type variant="title2" style={overdue ? { color: theme.color.laterite["600"] } : undefined}>{value}</Type></View>;
}
function Tab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: selected ? theme.color.kola["600"] : "transparent" }}><Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["500"], textAlign: "center" }}>{label}</Type></Pressable>;
}
function DueItem({ account, charge, intent, onPress }: { account: Account; charge: RentCharge; intent: PaymentIntent | null; onPress: () => void }) {
  const paymentReady = account.ledger.digital_payment.available;
  const action = intent ? "Check status" : "Pay rent";
  return <Pressable accessibilityRole="button" accessibilityLabel={`${account.tenancy.property.title}. ${charge.kind_display}. ${charge.outstanding_formatted}. ${action}.`} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={({ pressed }) => ({ minHeight: 112, paddingVertical: space[4], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"], gap: space[3], opacity: pressed ? .8 : 1 })}>
    <View style={{ flexDirection: "row", gap: space[3] }}><View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{account.tenancy.property.title}</Type><Type variant="caption">{tenancyLabel(account.tenancy)}</Type></View><View style={{ alignItems: "flex-end", gap: space[1] }}><Type variant="title2">{charge.outstanding_formatted}</Type><Type variant="caption" style={charge.is_overdue ? { color: theme.color.laterite["600"] } : undefined}>{intent ? "Confirming payment" : charge.status_display}</Type></View></View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Type variant="caption" style={{ flex: 1 }}>{charge.kind_display} · {charge.is_overdue ? `${charge.days_overdue} days overdue` : `Due ${formatDate(charge.due_on)}`}</Type><View style={{ alignItems: "flex-end", gap: 2 }}><Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>{action} →</Type>{!intent && !paymentReady ? <Type variant="caption">Availability shown next</Type> : null}</View></View>
  </Pressable>;
}
function HistoryItem({ account, payment, action, onPress }: { account: Account; payment: RentPayment; action: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${account.tenancy.property.title}. ${payment.amount_formatted}. ${paymentStatus(payment)}. ${action}.`} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={({ pressed }) => ({ minHeight: 96, paddingVertical: space[4], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"], gap: space[2], opacity: pressed ? .8 : 1 })}><View style={{ flexDirection: "row", gap: space[3] }}><View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{account.tenancy.property.title}</Type><Type variant="caption">{tenancyLabel(account.tenancy)} · {payment.method_display} · {formatDate(payment.paid_on)}</Type><Type variant="caption">{payment.source === "EXTERNAL" ? "Paid externally · recorded through Rooomly" : "Processed through Rooomly"}</Type></View><View style={{ alignItems: "flex-end", gap: space[1] }}><Type variant="bodyStrong">{payment.amount_formatted}</Type><Type variant="caption">{paymentStatus(payment)}</Type></View></View><Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>{action} →</Type></Pressable>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <View style={{ paddingVertical: space[8], gap: space[1] }}><Type variant="bodyStrong">{title}</Type><Type variant="caption">{detail}</Type></View>;
}
function openAccount(router: ReturnType<typeof useRouter>, tenancy: Tenancy) {
  router.push({ pathname: "/(app)/rent-account", params: { leaseId: tenancy.lease?.id ?? "", propertyTitle: tenancy.property.title, unitLabel: tenancy.space.unit_label, bedLabel: tenancy.space.bed_label ?? "", tenancyId: tenancy.id, mode: "tenant" } } as never);
}
function paymentStatus(payment: RentPayment) { return payment.evidence === "PSP_CONFIRMED" ? "Processor confirmed" : payment.awaiting_you ? "Review needed" : payment.status === "confirmed" ? "Confirmed by both" : payment.status === "disputed" ? "Disputed" : payment.recorded_by_tenant ? "Waiting for provider" : "Waiting for you"; }
function sentenceCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " "); }
function formatDate(value: string) { return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }); }
