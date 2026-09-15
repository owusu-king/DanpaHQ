import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import {
  getPortfolioSummary,
  getPayoutDestination,
  listOrganizationProperties,
  listOrganizations,
  listPropertyExpenses,
  recordPropertyExpense,
  type ManagedProperty,
  type PayoutDestinationState,
  type PortfolioSummary,
  type PropertyExpense,
} from "@/organizations";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type PaymentsView = "balances" | "records" | "payouts" | "expenses";
type BalanceFilter = "all" | "overdue" | "outstanding" | "current";
type Tenant = PortfolioSummary["tenants"][number];
type Payment = PortfolioSummary["recent_payments"][number];
type Settlement = PortfolioSummary["recent_settlements"][number];
type Row = { kind: "tenant"; tenant: Tenant } | { kind: "payment"; payment: Payment } | { kind: "settlement"; settlement: Settlement } | { kind: "expense"; expense: PropertyExpense };

export default function ProviderPaymentsScreen() {
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const { activeContext } = useAuth();
  const [organizationId, setOrganizationId] = useState("");
  const [canManagePayouts, setCanManagePayouts] = useState(false);
  const [payoutDestination, setPayoutDestination] = useState<PayoutDestinationState | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [expenses, setExpenses] = useState<PropertyExpense[]>([]);
  const [view, setView] = useState<PaymentsView>("balances");
  const [filter, setFilter] = useState<BalanceFilter>("all");
  const [query, setQuery] = useState("");
  const [showExpense, setShowExpense] = useState(action === "expense");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      const mayManagePayouts = Boolean(
        organization?.current_user_role === "owner" || organization?.current_user_role === "admin",
      );
      setOrganizationId(organization?.id ?? "");
      setCanManagePayouts(mayManagePayouts);
      if (organization) {
        const [portfolio, propertyRows, expenseRows, destination] = await Promise.all([
          getPortfolioSummary(organization.id),
          listOrganizationProperties(organization.id),
          listPropertyExpenses(organization.id),
          mayManagePayouts
            ? getPayoutDestination(organization.id).catch(() => null)
            : Promise.resolve(null),
        ]);
        setSummary(portfolio); setProperties(propertyRows); setExpenses(expenseRows); setPayoutDestination(destination);
      } else { setSummary(null); setProperties([]); setExpenses([]); setPayoutDestination(null); }
      setError("");
    } catch { setError("Could not load Portfolio payments."); }
  }, [activeContext]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    if (view === "balances") return (summary?.tenants ?? []).filter((tenant) => filter === "all" || tenant.rent.status === filter).filter((tenant) => !needle || `${tenant.name} ${tenant.property_title} ${tenant.unit_label} ${tenant.bed_label ?? ""}`.toLocaleLowerCase("en-GH").includes(needle)).sort((a, b) => rentPriority(a) - rentPriority(b) || a.name.localeCompare(b.name, "en-GH")).map((tenant) => ({ kind: "tenant", tenant }));
    if (view === "records") return (summary?.recent_payments ?? []).filter((payment) => !needle || `${payment.tenant_name} ${payment.property_title} ${payment.unit_label} ${payment.method_display}`.toLocaleLowerCase("en-GH").includes(needle)).map((payment) => ({ kind: "payment", payment }));
    if (view === "payouts") return (summary?.recent_settlements ?? []).filter((settlement) => !needle || `${settlement.tenant_name} ${settlement.property_title} ${settlement.unit_label} ${settlement.status_display}`.toLocaleLowerCase("en-GH").includes(needle)).map((settlement) => ({ kind: "settlement", settlement }));
    return expenses.map((expense) => ({ kind: "expense", expense }));
  }, [expenses, filter, query, summary, view]);

  function openAccount(input: { leaseId: string; tenantName: string; propertyTitle: string; unitLabel: string; bedLabel?: string | null; tenancyId?: string | null; canRecord?: boolean }) {
    router.push({ pathname: "/(app)/rent-account", params: { leaseId: input.leaseId, tenantName: input.tenantName, propertyTitle: input.propertyTitle, unitLabel: input.unitLabel, bedLabel: input.bedLabel ?? "", tenancyId: input.tenancyId ?? "", canRecord: input.canRecord ? "1" : "0" } } as never);
  }

  return <><FlatList
    data={rows}
    keyExtractor={(row) => row.kind === "tenant" ? row.tenant.occupancy_id : row.kind === "payment" ? row.payment.id : row.kind === "settlement" ? row.settlement.id : row.expense.id}
    contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.kola["600"]} />}
    ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.color.field["200"] }} />}
    ListHeaderComponent={<View style={{ gap: space[4], marginBottom: space[3] }}>
      <Type variant="body" style={{ color: theme.color.ink["700"] }}>See what tenants paid and what reached your settlement account.</Type>
      {error ? <Notice tone="error" title={error} /> : null}
      {canManagePayouts && organizationId && payoutDestination && payoutDestination.active_profile?.status !== "verified" ? (
        <AttentionRow
          title="Activate online rent payments"
          detail={payoutDestination.provisioning?.checking ? "Settlement account verification is in progress" : payoutDestination.profiles.length ? "Choose a verified receiving account" : "Add a verified bank or Mobile Money account"}
          onPress={() => router.push({ pathname: "/(app)/payout-account", params: { organizationId } } as never)}
        />
      ) : null}
      {summary ? <>
        {(summary.money.overdue_minor > 0 || summary.money.payment_records_awaiting_you > 0 || summary.money.awaiting_settlement_minor > 0 || summary.money.settlement_attention_minor > 0) ? <View style={{ gap: space[2] }}>{summary.money.overdue_minor > 0 ? <AttentionRow title={`${formatMinor(summary.money.overdue_minor)} overdue`} detail="Open affected balances" onPress={() => { setView("balances"); setFilter("overdue"); }} /> : null}{summary.money.payment_records_awaiting_you > 0 ? <AttentionRow title={`${summary.money.payment_records_awaiting_you} record${summary.money.payment_records_awaiting_you === 1 ? "" : "s"} to review`} detail="Confirm or dispute tenant claims" onPress={() => { setView("records"); setQuery(""); }} /> : null}{summary.money.awaiting_settlement_minor > 0 ? <AttentionRow title={`${formatMinor(summary.money.awaiting_settlement_minor)} awaiting payout`} detail="Track Paystack settlement" onPress={() => { setView("payouts"); setQuery(""); }} /> : null}{summary.money.settlement_attention_minor > 0 ? <AttentionRow title="Payout needs attention" detail="Review affected settlement" onPress={() => { setView("payouts"); setQuery(""); }} /> : null}</View> : null}
        <View style={{ paddingVertical: space[4], borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.field["200"], gap: space[3] }}><View style={{ flexDirection: "row", gap: space[5] }}><Fact label="Rent recorded" value={formatMinor(summary.money.confirmed_received_minor)} /><Fact label="Settled to you" value={formatMinor(summary.money.settled_net_minor)} /></View><View style={{ flexDirection: "row", gap: space[5] }}><Fact label="Outstanding" value={formatMinor(summary.money.outstanding_minor)} /><Fact label="Overdue" value={formatMinor(summary.money.overdue_minor)} overdue={summary.money.overdue_minor > 0} /></View></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }} accessibilityRole="tablist">{(["balances", "records", "payouts", "expenses"] as const).map((value) => <ViewTab key={value} label={value === "balances" ? "Rent due" : value === "records" ? "Records" : value === "payouts" ? "Payouts" : "Expenses"} selected={view === value} onPress={() => { setView(value); setQuery(""); }} />)}</ScrollView>
        {view !== "expenses" ? <Field label={view === "balances" ? "Search balances" : view === "records" ? "Search records" : "Search payouts"} value={query} onChangeText={setQuery} placeholder={view === "balances" ? "Tenant, Property or Unit" : view === "records" ? "Tenant, Property or method" : "Tenant, Property or status"} returnKeyType="search" /> : null}
        {view === "balances" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }} accessibilityRole="toolbar">{(["all", "overdue", "outstanding", "current"] as const).map((value) => <FilterChip key={value} label={value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1)} count={value === "all" ? summary.tenants.length : summary.tenants.filter((tenant) => tenant.rent.status === value).length} selected={filter === value} onPress={() => setFilter(value)} />)}</ScrollView> : null}
        {view === "records" ? <Type variant="caption">{summary.money.payment_records_awaiting_you > 0 ? "Records waiting on you come first, then recent activity. " : "The most recent records are shown. "}Open one for the full rent account and any action needed.</Type> : null}
        {view === "payouts" ? <View style={{ gap: space[3] }}><View style={{ gap: space[3] }}><View style={{ flexDirection: "row", gap: space[4] }}><Fact label="Paid online" value={formatMinor(summary.money.online_paid_minor)} /><Fact label="Awaiting settlement" value={formatMinor(summary.money.awaiting_settlement_minor)} /></View><View style={{ flexDirection: "row", gap: space[4] }}><Fact label="Settled to you" value={formatMinor(summary.money.settled_net_minor)} /><Fact label="Fees deducted" value={formatMinor(summary.money.settled_fee_minor)} /></View></View>{summary.money.awaiting_settlement_minor > 0 ? <Notice tone="info" title="Payout in progress" body={`${formatMinor(summary.money.awaiting_settlement_minor)} has been paid by tenants and is waiting for Paystack's settlement batch. Final fee and net appear after confirmation.`} /> : null}{summary.money.settlement_attention_minor > 0 ? <Notice tone="error" title="A payout needs review" body="Rooomly has not counted it as settled. The payment record remains intact while settlement is reconciled." /> : null}<Type variant="caption">Property owners bear Paystack’s transaction fee. Completed payouts show the final amount after fees.</Type>{canManagePayouts && organizationId ? <Button label="Manage settlement account" variant="secondary" onPress={() => router.push({ pathname: "/(app)/payout-account", params: { organizationId } } as never)} /> : null}</View> : null}
        {view === "expenses" ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}><Type variant="caption" style={{ flex: 1 }}>{formatMinor(expenses.reduce((total, expense) => total + expense.amount_minor, 0))} recorded in this Portfolio.</Type><Button label="Record expense" variant="secondary" onPress={() => setShowExpense(true)} /></View> : null}
      </> : null}
    </View>}
    renderItem={({ item }) => item.kind === "tenant" ? <TenantRow tenant={item.tenant} onPress={() => item.tenant.lease_id && openAccount({ leaseId: item.tenant.lease_id, tenantName: item.tenant.name, propertyTitle: item.tenant.property_title, unitLabel: item.tenant.unit_label, bedLabel: item.tenant.bed_label, tenancyId: item.tenant.tenancy_id, canRecord: item.tenant.can_record_payment })} /> : item.kind === "payment" ? <PaymentRow payment={item.payment} onPress={() => { const tenant = summary?.tenants.find((row) => row.lease_id === item.payment.lease_id); openAccount({ leaseId: item.payment.lease_id, tenantName: item.payment.tenant_name, propertyTitle: item.payment.property_title, unitLabel: item.payment.unit_label, tenancyId: tenant?.tenancy_id, canRecord: tenant?.can_record_payment }); }} /> : item.kind === "settlement" ? <SettlementRow settlement={item.settlement} /> : <ExpenseRow expense={item.expense} />}
    ListEmptyComponent={summary === null && !error ? <Type variant="caption">Loading payments…</Type> : error ? null : <View style={{ paddingVertical: space[6], gap: space[2] }}><Type variant="bodyStrong">{query ? "No matching records" : view === "balances" ? "No balances in this view" : view === "records" ? "No payment records yet" : view === "payouts" ? "No online payouts yet" : "No expenses recorded"}</Type><Type variant="caption">{query ? "Try a different search." : view === "balances" ? "Choose another balance status." : view === "records" ? "Confirmed and tenant-recorded payments appear here." : view === "payouts" ? "Paystack-confirmed rent and payout progress will appear here." : "Property expenses you record appear here."}</Type></View>}
    ListFooterComponent={summary && summary.verification.payments_ready < summary.verification.properties_total && (view === "balances" || view === "records") ? <Notice tone="info" title="Online collection is not ready for some Properties" body="It needs current identity, Property authority and a Portfolio settlement account the payment provider has verified. Recording money you were paid directly is unaffected." /> : null}
  />
  <ExpenseModal visible={showExpense} organizationId={organizationId} properties={properties} onClose={() => setShowExpense(false)} onDone={async () => { setShowExpense(false); await load(); }} />
  </>;
}

function AttentionRow({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${detail}.`} onPress={onPress} {...pressableFeedback(theme.color.laterite["100"])} style={({ pressed }) => ({ minHeight: 64, padding: space[3], gap: space[1], borderLeftWidth: 3, borderLeftColor: theme.color.laterite["600"], backgroundColor: theme.color.field["0"], opacity: pressed ? .8 : 1 })}><Type variant="bodyStrong">{title}</Type><Type variant="caption" style={{ color: theme.color.kola["600"] }}>{detail} →</Type></Pressable>; }
function Fact({ label, value, note, overdue = false }: { label: string; value: string; note?: string; overdue?: boolean }) { return <View style={{ flex: 1, minWidth: 120, gap: space[1] }}><Type variant="caption">{label}</Type><Type variant="title2" style={overdue ? { color: theme.color.laterite["600"] } : undefined}>{value}</Type>{note ? <Type variant="caption">{note}</Type> : null}</View>; }
function ViewTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: space[1], borderBottomWidth: 2, borderBottomColor: selected ? theme.color.kola["600"] : "transparent" }}><Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["500"], textAlign: "center" }}>{label}</Type></Pressable>; }
function FilterChip({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} {...pressableFeedback(theme.color.kola["50"])} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space[3], borderWidth: 1, borderColor: selected ? theme.color.kola["300"] : theme.color.field["200"], borderRadius: 22, backgroundColor: selected ? theme.color.kola["50"] : "transparent" }}><Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["500"] }}>{label} · {count}</Type></Pressable>; }
function TenantRow({ tenant, onPress }: { tenant: Tenant; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={`${tenant.name}. ${tenant.property_title}, ${tenant.unit_label}. ${rentStatus(tenant)}. ${formatMinor(tenant.rent.outstanding_minor, tenant.lease_rent_currency ?? "GHS")} outstanding.`} disabled={!tenant.lease_id} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={({ pressed }) => ({ minHeight: 96, paddingVertical: space[4], flexDirection: "row", alignItems: "center", gap: space[3], opacity: tenant.lease_id ? pressed ? .8 : 1 : .55 })}><View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{tenant.name}</Type><Type variant="caption">{tenant.property_title} · {tenant.unit_label}{tenant.bed_label ? ` · ${tenant.bed_label}` : ""}</Type><Type variant="caption">{tenant.rent.next_due_on ? `Due ${formatDate(tenant.rent.next_due_on)}` : "Nothing due"}</Type></View><View style={{ alignItems: "flex-end", maxWidth: "42%", gap: space[1] }}><Type variant="bodyStrong" style={{ color: rentColor(tenant.rent.status), textAlign: "right" }}>{rentStatus(tenant)}</Type><Type variant="bodyStrong" style={{ textAlign: "right" }}>{formatMinor(tenant.rent.outstanding_minor, tenant.lease_rent_currency ?? "GHS")}</Type></View><Type variant="title2" style={{ color: theme.color.ink["300"] }}>›</Type></Pressable>; }
function PaymentRow({ payment, onPress }: { payment: Payment; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={`${payment.tenant_name}. ${formatMinor(payment.amount_minor, payment.currency)}. ${paymentStatus(payment)}. Open rent account.`} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={({ pressed }) => ({ minHeight: 104, paddingVertical: space[4], flexDirection: "row", alignItems: "center", gap: space[3], opacity: pressed ? .8 : 1 })}><View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{payment.tenant_name}</Type><Type variant="caption">{payment.property_title} · {payment.unit_label}</Type><Type variant="caption">{payment.method_display} · {formatDate(payment.paid_on)}</Type><Type variant="caption">{payment.source === "EXTERNAL" ? "External · recorded through Rooomly" : "Processed through Rooomly"}</Type></View><View style={{ alignItems: "flex-end", maxWidth: "44%", gap: space[1] }}><Type variant="bodyStrong">{formatMinor(payment.amount_minor, payment.currency)}</Type><Type variant="caption" style={{ color: payment.awaiting_you ? theme.color.laterite["600"] : theme.color.ink["500"], textAlign: "right" }}>{paymentStatus(payment)}</Type></View><Type variant="title2" style={{ color: theme.color.ink["300"] }}>›</Type></Pressable>; }
function SettlementRow({ settlement }: { settlement: Settlement }) {
  const settled = settlement.status === "settled" && settlement.net_minor !== null;
  const attention = settlement.status === "failed" || settlement.status === "reversed";
  const label = settled ? "Settled" : attention ? "Needs review" : "Payout processing";
  const amount = settled ? settlement.net_minor! : settlement.gross_minor;
  return <View accessibilityLabel={`${settlement.tenant_name}. Tenant paid. ${label}. ${formatMinor(amount, settlement.currency)}.`} style={{ minHeight: 108, paddingVertical: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
    <View style={{ flex: 1, gap: space[1] }}>
      <Type variant="bodyStrong">{settlement.tenant_name}</Type>
      <Type variant="caption">{settlement.property_title} · {settlement.unit_label}</Type>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Type variant="caption" style={{ color: theme.color.kola["600"] }}>Paid</Type><View style={{ width: 20, height: 1, backgroundColor: settled ? theme.color.kola["300"] : theme.color.field["300"] }} /><Type variant="caption" style={{ color: settled ? theme.color.kola["600"] : theme.color.ink["500"] }}>Settled</Type></View>
      <Type variant="caption">{settled && settlement.settled_at ? `Settled ${formatDate(settlement.settled_at)}` : settlement.paid_at ? `Paid ${formatDate(settlement.paid_at)}` : "Payment confirmed"}</Type>
    </View>
    <View style={{ alignItems: "flex-end", maxWidth: "46%", gap: space[1] }}><Type variant="bodyStrong">{formatMinor(amount, settlement.currency)}</Type><Type variant="caption" style={{ color: attention ? theme.color.laterite["600"] : settled ? theme.color.kola["600"] : theme.color.harmattan["600"], textAlign: "right" }}>{label}</Type><Type variant="caption" style={{ textAlign: "right" }}>{settled ? `${formatMinor(settlement.fee_minor ?? 0, settlement.currency)} deducted` : "Final payout pending"}</Type></View>
  </View>;
}
function ExpenseRow({ expense }: { expense: PropertyExpense }) { return <View style={{ minHeight: 80, paddingVertical: space[3], flexDirection: "row", gap: space[3] }}><View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{expense.category_display}</Type><Type variant="caption">{expense.property_title} · {formatDate(expense.incurred_on)}</Type>{expense.note ? <Type variant="caption">{expense.note}</Type> : null}</View><Type variant="bodyStrong">{expense.amount_formatted}</Type></View>; }

function ExpenseModal({ visible, organizationId, properties, onClose, onDone }: { visible: boolean; organizationId: string; properties: ManagedProperty[]; onClose: () => void; onDone: () => Promise<void> }) { return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[10], gap: space[4] }}><View style={{ gap: space[1] }}><Type variant="label">INTERNAL RECORD</Type><Type variant="title1" accessibilityRole="header">Record Property expense</Type><Type variant="caption">This records an expense. It does not move money.</Type></View><ExpenseForm organizationId={organizationId} properties={properties} onDone={onDone} /><Button label="Cancel" variant="quiet" onPress={onClose} /></ScrollView></Modal>; }
const EXPENSE_CATEGORIES = [["maintenance", "Maintenance"], ["utilities", "Utilities"], ["staff", "Staff"], ["tax", "Tax or levy"], ["supplies", "Supplies"], ["other", "Other"]] as const;
function ExpenseForm({ organizationId, properties, onDone }: { organizationId: string; properties: ManagedProperty[]; onDone: () => Promise<void> }) { const [propertyId, setPropertyId] = useState(properties[0]?.id ?? ""); const [category, setCategory] = useState("maintenance"); const [amount, setAmount] = useState(""); const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); return <View style={{ gap: space[3] }}><Type variant="label">PROPERTY</Type>{properties.map((property) => <Button key={property.id} label={property.title} variant="secondary" selected={propertyId === property.id} onPress={() => setPropertyId(property.id)} />)}<Type variant="label">CATEGORY</Type><View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{EXPENSE_CATEGORIES.map(([value, label]) => <Button key={value} label={label} variant="quiet" selected={category === value} onPress={() => setCategory(value)} />)}</View><Field label="Amount (GH₵)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><Field label="Date (YYYY-MM-DD)" value={incurredOn} onChangeText={setIncurredOn} /><Field label="Note (optional)" value={note} onChangeText={setNote} />{error ? <Notice tone="error" title={error} /> : null}<Button label="Save expense record" busy={busy} disabled={!propertyId || !amount.trim()} onPress={async () => { const amountMinor = Math.round(Number(amount) * 100); if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter a valid amount."); setBusy(true); setError(""); try { await recordPropertyExpense(organizationId, { property_id: propertyId, amount_minor: amountMinor, category, incurred_on: incurredOn, note }); await onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the expense."); } finally { setBusy(false); } }} /></View>; }
function rentPriority(tenant: Tenant) { return tenant.rent.status === "overdue" ? 0 : tenant.rent.status === "outstanding" ? 1 : 2; }
function rentStatus(tenant: Tenant) { return tenant.rent.status === "overdue" ? "Overdue" : tenant.rent.status === "outstanding" ? "Payment due" : "Current"; }
function rentColor(status: Tenant["rent"]["status"]) { return status === "overdue" ? theme.color.laterite["600"] : status === "outstanding" ? theme.color.harmattan["600"] : theme.color.kola["600"]; }
function paymentStatus(payment: Payment) { return payment.evidence === "PSP_CONFIRMED" ? "Processor confirmed" : payment.awaiting_you ? "Review needed" : payment.status === "confirmed" ? "Confirmed by both" : payment.status === "disputed" ? "Disputed" : "Waiting for tenant"; }
function formatDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }); }
