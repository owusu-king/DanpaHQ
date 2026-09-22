import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, RefreshControl, ScrollView, StyleSheet, View, Pressable } from "react-native";

import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { shortDate, useHomeDensity } from "@/components/home/plinth";
import {
  ActiveFilter,
  ChoiceRow,
  EmptyState,
  FAINT,
  Figure,
  FigureGrid,
  FilterGroup,
  Footnote,
  HARMATTAN,
  InfoNote,
  KOLA,
  KOLA_DEEP,
  LAGOON,
  LATERITE,
  ListHead,
  ListRow,
  MUTED,
  PRESSED,
  QuietAction,
  RowLine,
  RowSeparator,
  SearchField,
  SheetFooter,
  SignalPanel,
  SummaryPanel,
  rowStyles,
  type IconName,
  type Signal,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { ModalSafeArea, SafeBottom } from "@/components/sheet/ModalSafeArea";
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
import { isAndroid, pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * The Portfolio's money: what is owed, what was paid, and what reached you.
 *
 * Refined on review (2026-09-15) into one calm reading order. The figures come
 * first, in one glass panel that leads with what is still owed; then anything
 * that needs a decision, as rows that go straight to it; then the list. The four
 * views and the rent statuses used to be a row of tabs and a row of chips spread
 * across the page. They are one Filter control now, opening a sheet that groups
 * what to show and, for rent, which balances — and the list's heading and a single
 * removable token say what is on. The parts are `PortfolioList`'s, shared with
 * Tenants, so the two pages read as one product.
 *
 * Tenant payment and provider settlement stay different financial facts:
 * "Awaiting settlement" is never counted as money that arrived, and a payout row
 * shows both checkpoints, Paid and then Settled.
 */

type PaymentsView = "balances" | "records" | "payouts" | "expenses";
type BalanceFilter = "all" | "overdue" | "outstanding" | "current";
type Tenant = PortfolioSummary["tenants"][number];
type Payment = PortfolioSummary["recent_payments"][number];
type Settlement = PortfolioSummary["recent_settlements"][number];
type Row = { kind: "tenant"; tenant: Tenant } | { kind: "payment"; payment: Payment } | { kind: "settlement"; settlement: Settlement } | { kind: "expense"; expense: PropertyExpense };

const VIEWS: readonly PaymentsView[] = ["balances", "records", "payouts", "expenses"];
const STATUSES: readonly BalanceFilter[] = ["all", "overdue", "outstanding", "current"];

const VIEW_LABEL: Record<PaymentsView, string> = {
  balances: "Rent due",
  records: "Records",
  payouts: "Payouts",
  expenses: "Expenses",
};
const VIEW_ICON: Record<PaymentsView, IconName> = {
  balances: "time-outline",
  records: "document-text-outline",
  payouts: "arrow-down-circle-outline",
  expenses: "receipt-outline",
};
const STATUS_LABEL: Record<BalanceFilter, string> = {
  all: "All balances",
  overdue: "Overdue",
  outstanding: "Outstanding",
  current: "Current",
};
const SEARCH: Record<Exclude<PaymentsView, "expenses">, { label: string; hint: string }> = {
  balances: { label: "Search balances", hint: "Tenant, Property or Unit" },
  records: { label: "Search records", hint: "Tenant, Property or method" },
  payouts: { label: "Search payouts", hint: "Tenant, Property or status" },
};

/** Each rent status in the colour it already carries across the product. */
const STATUS_TONE: Record<Exclude<BalanceFilter, "all">, string> = {
  overdue: LATERITE,
  outstanding: HARMATTAN,
  current: KOLA,
};

export default function ProviderPaymentsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
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
  const [filtering, setFiltering] = useState(false);
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

  const viewCount = (value: PaymentsView) =>
    value === "balances"
      ? summary?.tenants.length ?? 0
      : value === "records"
        ? summary?.recent_payments.length ?? 0
        : value === "payouts"
          ? summary?.recent_settlements.length ?? 0
          : expenses.length;
  const statusCount = (value: BalanceFilter) =>
    (summary?.tenants ?? []).filter((tenant) => value === "all" || tenant.rent.status === value).length;

  function showView(value: PaymentsView) {
    setView(value);
    setQuery("");
  }

  function openAccount(input: { leaseId: string; tenantName: string; propertyTitle: string; unitLabel: string; bedLabel?: string | null; tenancyId?: string | null; canRecord?: boolean }) {
    router.push({ pathname: "/(app)/rent-account", params: { leaseId: input.leaseId, tenantName: input.tenantName, propertyTitle: input.propertyTitle, unitLabel: input.unitLabel, bedLabel: input.bedLabel ?? "", tenancyId: input.tenancyId ?? "", canRecord: input.canRecord ? "1" : "0" } } as never);
  }

  // What needs a decision, in the order it always had. Each goes straight to it.
  const signals: Signal[] = [];
  if (canManagePayouts && organizationId && payoutDestination && payoutDestination.active_profile?.status !== "verified") {
    signals.push({
      key: "activate",
      icon: "flash-outline",
      tone: KOLA,
      wash: theme.color.kola["50"],
      title: "Activate online rent payments",
      detail: payoutDestination.provisioning?.checking ? "Settlement account verification is in progress" : payoutDestination.profiles.length ? "Choose a verified receiving account" : "Add a verified bank or Mobile Money account",
      onPress: () => router.push({ pathname: "/(app)/payout-account", params: { organizationId } } as never),
    });
  }
  if (summary) {
    if (summary.money.overdue_minor > 0) {
      signals.push({ key: "overdue", icon: "alert-circle-outline", tone: LATERITE, wash: theme.color.laterite["100"], title: `${formatMinor(summary.money.overdue_minor)} overdue`, hint: "Shows overdue balances", onPress: () => { setView("balances"); setFilter("overdue"); } });
    }
    if (summary.money.payment_records_awaiting_you > 0) {
      signals.push({ key: "records", icon: "document-text-outline", tone: HARMATTAN, wash: theme.color.harmattan["100"], title: `${summary.money.payment_records_awaiting_you} record${summary.money.payment_records_awaiting_you === 1 ? "" : "s"} to review`, hint: "Confirm or dispute tenant claims", onPress: () => { setView("records"); setQuery(""); } });
    }
    if (summary.money.awaiting_settlement_minor > 0) {
      signals.push({ key: "awaiting", icon: "hourglass-outline", tone: LAGOON, wash: theme.color.lagoon["100"], title: `${formatMinor(summary.money.awaiting_settlement_minor)} awaiting payout`, hint: "Shows payouts", onPress: () => { setView("payouts"); setQuery(""); } });
    }
    if (summary.money.settlement_attention_minor > 0) {
      signals.push({ key: "attention", icon: "warning-outline", tone: LATERITE, wash: theme.color.laterite["100"], title: "Payout needs attention", hint: "Shows payouts", onPress: () => { setView("payouts"); setQuery(""); } });
    }
  }

  const activeFilters = view === "balances" && filter !== "all" ? 1 : 0;
  const last = rows.length - 1;
  const narrow = density.veryCompact;

  return (
    <IndexGround>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.kind === "tenant" ? row.tenant.occupancy_id : row.kind === "payment" ? row.payment.id : row.kind === "settlement" ? row.settlement.id : row.expense.id}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: space[12] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ItemSeparatorComponent={RowSeparator}
        ListHeaderComponent={<View style={{ gap: density.sectionGap + space[2], marginBottom: space[3] }}>
          {error ? <Notice tone="error" title={error} /> : null}
          {summary ? <SummaryPanel
            label="Outstanding"
            value={formatMinor(summary.money.outstanding_minor)}
            note={summary.money.overdue_minor > 0
              ? { text: `${formatMinor(summary.money.overdue_minor)} overdue`, tone: "alert" }
              : { text: "Nothing overdue", tone: "calm" }}
            facts={[
              { label: "Rent recorded", value: formatMinor(summary.money.confirmed_received_minor) },
              { label: "Settled to you", value: formatMinor(summary.money.settled_net_minor) },
            ]}
          /> : null}
          <SignalPanel title="Needs attention" signals={signals} />
          {summary ? <View style={{ gap: space[3] }}>
            <ListHead title={VIEW_LABEL[view]} count={rows.length} filters={activeFilters} onFilter={() => setFiltering(true)} />
            {view === "balances" && filter !== "all" ? (
              <ActiveFilter label={STATUS_LABEL[filter]} tone={STATUS_TONE[filter]} onClear={() => setFilter("all")} />
            ) : null}
            {view !== "expenses" ? <SearchField label={SEARCH[view].label} placeholder={SEARCH[view].hint} value={query} onChangeText={setQuery} /> : null}
            {view === "payouts" ? <View style={{ gap: space[3] }}>
              <FigureGrid figures={[
                { label: "Paid online", value: formatMinor(summary.money.online_paid_minor) },
                { label: "Awaiting settlement", value: formatMinor(summary.money.awaiting_settlement_minor) },
                { label: "Settled to you", value: formatMinor(summary.money.settled_net_minor) },
                { label: "Fees deducted", value: formatMinor(summary.money.settled_fee_minor) },
              ]} />
              {summary.money.awaiting_settlement_minor > 0 ? <InfoNote tone="lagoon" icon="hourglass-outline" title="Payout in progress" body={`${formatMinor(summary.money.awaiting_settlement_minor)} is waiting for Paystack's settlement batch.`} /> : null}
              {summary.money.settlement_attention_minor > 0 ? <InfoNote tone="laterite" icon="warning-outline" title="A payout needs review" body="It is not counted as settled until it is reconciled." /> : null}
              <Footnote>Property owners bear Paystack’s transaction fee. Completed payouts show the final amount after fees.</Footnote>
              {canManagePayouts && organizationId ? <QuietAction icon="card-outline" label="Manage settlement account" onPress={() => router.push({ pathname: "/(app)/payout-account", params: { organizationId } } as never)} /> : null}
            </View> : null}
            {view === "expenses" ? <View style={styles.expenseBar}>
              <Figure label="Recorded" value={formatMinor(expenses.reduce((total, expense) => total + expense.amount_minor, 0))} />
              <QuietAction icon="add" label="Record expense" onPress={() => setShowExpense(true)} />
            </View> : null}
          </View> : null}
        </View>}
        renderItem={({ item, index }) => <ListRow first={index === 0} last={index === last}>
          {item.kind === "tenant" ? <TenantRow tenant={item.tenant} narrow={narrow} onPress={() => item.tenant.lease_id && openAccount({ leaseId: item.tenant.lease_id, tenantName: item.tenant.name, propertyTitle: item.tenant.property_title, unitLabel: item.tenant.unit_label, bedLabel: item.tenant.bed_label, tenancyId: item.tenant.tenancy_id, canRecord: item.tenant.can_record_payment })} /> : item.kind === "payment" ? <PaymentRow payment={item.payment} onPress={() => { const tenant = summary?.tenants.find((row) => row.lease_id === item.payment.lease_id); openAccount({ leaseId: item.payment.lease_id, tenantName: item.payment.tenant_name, propertyTitle: item.payment.property_title, unitLabel: item.payment.unit_label, tenancyId: tenant?.tenancy_id, canRecord: tenant?.can_record_payment }); }} /> : item.kind === "settlement" ? <SettlementRow settlement={item.settlement} narrow={narrow} /> : <ExpenseRow expense={item.expense} />}
        </ListRow>}
        ListEmptyComponent={summary === null && !error ? <Type variant="caption" style={styles.loading}>Loading payments…</Type> : error ? null : <EmptyState
          icon={query ? "search-outline" : VIEW_ICON[view]}
          title={query ? "No matching records" : view === "balances" ? "No balances in this view" : view === "records" ? "No payment records yet" : view === "payouts" ? "No online payouts yet" : "No expenses recorded"}
          hint={query ? "Try a different search." : view === "balances" ? "Choose another rent status." : undefined}
        />}
        ListFooterComponent={summary && summary.verification.payments_ready < summary.verification.properties_total && (view === "balances" || view === "records") ? <View style={{ marginTop: space[5] }}><InfoNote tone="lagoon" icon="information-circle-outline" title="Online collection is not ready for some Properties" body="It needs current identity, Property authority and a verified settlement account. Recording money paid to you directly still works." /></View> : null}
      />
      <FilterSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        view={view}
        filter={filter}
        results={rows.length}
        viewCount={viewCount}
        statusCount={statusCount}
        onView={showView}
        onFilter={setFilter}
        onReset={() => { setView("balances"); setFilter("all"); setQuery(""); }}
      />
      <ExpenseModal visible={showExpense} organizationId={organizationId} properties={properties} onClose={() => setShowExpense(false)} onDone={async () => { setShowExpense(false); await load(); }} />
    </IndexGround>
  );
}

function TenantRow({ tenant, narrow, onPress }: { tenant: Tenant; narrow: boolean; onPress: () => void }) {
  const tone = rentColor(tenant.rent.status);
  const amount = formatMinor(tenant.rent.outstanding_minor, tenant.lease_rent_currency ?? "GHS");
  const due = tenant.rent.next_due_on;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tenant.name}. ${tenant.property_title}, ${tenant.unit_label}. ${rentStatus(tenant)}. ${amount} outstanding.${due ? ` Due ${shortDate(due)}.` : ""}`}
      disabled={!tenant.lease_id}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, tenant.lease_id ? null : { opacity: 0.55 }, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.statusDot, { backgroundColor: tone, borderColor: alpha(tone, 0.18) }]} />
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{tenant.name}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{amount}</Type>}
        />
        <RowLine
          start={<Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{tenant.property_title} · {tenant.unit_label}{tenant.bed_label ? ` · ${tenant.bed_label}` : ""}</Type>}
          end={(
            <Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: tone }]}>
              {rentStatus(tenant)}{due && !narrow ? ` · ${shortDate(due)}` : ""}
            </Type>
          )}
        />
      </View>
    </Pressable>
  );
}

function PaymentRow({ payment, onPress }: { payment: Payment; onPress: () => void }) {
  const external = payment.source === "EXTERNAL";
  const amount = formatMinor(payment.amount_minor, payment.currency);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${payment.tenant_name}. ${amount}. ${paymentStatus(payment)}. ${payment.method_display}, ${shortDate(payment.paid_on)}. ${external ? "External, recorded through Rooomly" : "Processed through Rooomly"}. Open rent account.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[rowStyles.well, { backgroundColor: external ? theme.color.field["100"] : theme.color.kola["50"] }]}>
        <Ionicons name={external ? "create-outline" : "flash-outline"} size={15} color={external ? theme.color.ink["700"] : KOLA} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{payment.tenant_name}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{amount}</Type>}
        />
        <RowLine
          start={<Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{payment.property_title} · {payment.unit_label}</Type>}
          end={<Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: payment.awaiting_you ? LATERITE : MUTED }]}>{paymentStatus(payment)}</Type>}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>{payment.method_display} · {shortDate(payment.paid_on)}</Type>
      </View>
    </Pressable>
  );
}

function SettlementRow({ settlement, narrow }: { settlement: Settlement; narrow: boolean }) {
  const settled = settlement.status === "settled" && settlement.net_minor !== null;
  const attention = settlement.status === "failed" || settlement.status === "reversed";
  const label = settled ? "Settled" : attention ? "Needs review" : "Payout processing";
  const amount = settled ? settlement.net_minor! : settlement.gross_minor;
  const tone = attention ? LATERITE : settled ? KOLA : HARMATTAN;
  const wash = attention ? theme.color.laterite["100"] : settled ? theme.color.kola["50"] : theme.color.harmattan["100"];
  const when = settled && settlement.settled_at ? shortDate(settlement.settled_at) : settlement.paid_at ? shortDate(settlement.paid_at) : "";
  const fee = settled ? `${formatMinor(settlement.fee_minor ?? 0, settlement.currency)} fee` : "Fee pending";
  return (
    <View accessible accessibilityLabel={`${settlement.tenant_name}. Tenant paid. ${label}. ${formatMinor(amount, settlement.currency)}. ${fee}.`} style={rowStyles.row}>
      <View style={[rowStyles.well, { backgroundColor: wash }]}>
        <Ionicons name={attention ? "warning-outline" : VIEW_ICON.payouts} size={15} color={tone} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{settlement.tenant_name}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{formatMinor(amount, settlement.currency)}</Type>}
        />
        <RowLine
          start={<Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{settlement.property_title} · {settlement.unit_label}</Type>}
          end={<Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: tone }]}>{label}</Type>}
        />
        <RowLine
          start={(
            // Two checkpoints, never one: a pending row must not look like money that arrived.
            <View style={styles.checkpoints}>
              <Ionicons name="checkmark-circle" size={12} color={KOLA} />
              <Type variant="caption" style={[styles.checkpoint, { color: KOLA_DEEP }]}>Paid</Type>
              <View style={[styles.checkpointLine, { backgroundColor: settled ? theme.color.kola["300"] : theme.color.field["300"] }]} />
              <Ionicons name={settled ? "checkmark-circle" : attention ? "alert-circle" : "ellipse-outline"} size={12} color={settled ? KOLA : attention ? LATERITE : FAINT} />
              <Type variant="caption" style={[styles.checkpoint, { color: settled ? KOLA_DEEP : MUTED }]}>Settled</Type>
              {when ? <Type variant="caption" numberOfLines={1} style={styles.checkpointWhen}>{when}</Type> : null}
            </View>
          )}
          end={narrow ? undefined : <Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>{fee}</Type>}
        />
      </View>
    </View>
  );
}

function ExpenseRow({ expense }: { expense: PropertyExpense }) {
  return (
    <View style={rowStyles.row}>
      <View style={[rowStyles.well, { backgroundColor: theme.color.field["100"] }]}>
        <Ionicons name="receipt-outline" size={15} color={theme.color.ink["700"]} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{expense.category_display}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{expense.amount_formatted}</Type>}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{expense.property_title} · {shortDate(expense.incurred_on)}</Type>
        {expense.note ? <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>{expense.note}</Type> : null}
      </View>
    </View>
  );
}

/**
 * Every filter, in one sheet, in two groups: what to show, and — for rent —
 * which balances. Each answer carries its count, so a choice never lands on an
 * empty list by surprise, and the sheet closes on what it will show.
 */
function FilterSheet({
  visible,
  onClose,
  view,
  filter,
  results,
  viewCount,
  statusCount,
  onView,
  onFilter,
  onReset,
}: {
  visible: boolean;
  onClose: () => void;
  view: PaymentsView;
  filter: BalanceFilter;
  results: number;
  viewCount: (value: PaymentsView) => number;
  statusCount: (value: BalanceFilter) => number;
  onView: (value: PaymentsView) => void;
  onFilter: (value: BalanceFilter) => void;
  onReset: () => void;
}) {
  const changed = view !== "balances" || filter !== "all";
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filter"
      closeLabel="Close filter"
      footer={<SheetFooter canReset={changed} onReset={onReset} results={results} onShow={onClose} />}
    >
      <FilterGroup title="Show">
        {VIEWS.map((value, index) => (
          <ChoiceRow
            key={value}
            first={index === 0}
            icon={VIEW_ICON[value]}
            label={VIEW_LABEL[value]}
            count={viewCount(value)}
            selected={view === value}
            onPress={() => onView(value)}
          />
        ))}
      </FilterGroup>
      {view === "balances" ? (
        <FilterGroup title="Rent status">
          {STATUSES.map((value, index) => (
            <ChoiceRow
              key={value}
              first={index === 0}
              tone={value === "all" ? undefined : STATUS_TONE[value]}
              label={STATUS_LABEL[value]}
              count={statusCount(value)}
              selected={filter === value}
              onPress={() => onFilter(value)}
            />
          ))}
        </FilterGroup>
      ) : null}
    </BottomSheet>
  );
}

function ExpenseModal({ visible, organizationId, properties, onClose, onDone }: { visible: boolean; organizationId: string; properties: ManagedProperty[]; onClose: () => void; onDone: () => Promise<void> }) { return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><ModalSafeArea><SafeBottom render={(bottom) => <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[8] + bottom, gap: space[4] }}><View style={{ gap: space[1] }}><Type variant="label">INTERNAL RECORD</Type><Type variant="title1" accessibilityRole="header">Record Property expense</Type><Type variant="caption">This records an expense. It does not move money.</Type></View><ExpenseForm organizationId={organizationId} properties={properties} onDone={onDone} /><Button label="Cancel" variant="quiet" onPress={onClose} /></ScrollView>} /></ModalSafeArea></Modal>; }
const EXPENSE_CATEGORIES = [["maintenance", "Maintenance"], ["utilities", "Utilities"], ["staff", "Staff"], ["tax", "Tax or levy"], ["supplies", "Supplies"], ["other", "Other"]] as const;
function ExpenseForm({ organizationId, properties, onDone }: { organizationId: string; properties: ManagedProperty[]; onDone: () => Promise<void> }) { const [propertyId, setPropertyId] = useState(properties[0]?.id ?? ""); const [category, setCategory] = useState("maintenance"); const [amount, setAmount] = useState(""); const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); return <View style={{ gap: space[3] }}><Type variant="label">PROPERTY</Type>{properties.map((property) => <Button key={property.id} label={property.title} variant="secondary" selected={propertyId === property.id} onPress={() => setPropertyId(property.id)} />)}<Type variant="label">CATEGORY</Type><View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{EXPENSE_CATEGORIES.map(([value, label]) => <Button key={value} label={label} variant="quiet" selected={category === value} onPress={() => setCategory(value)} />)}</View><Field label="Amount (GH₵)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><Field label="Date (YYYY-MM-DD)" value={incurredOn} onChangeText={setIncurredOn} /><Field label="Note (optional)" value={note} onChangeText={setNote} />{error ? <Notice tone="error" title={error} /> : null}<Button label="Save expense record" busy={busy} disabled={!propertyId || !amount.trim()} onPress={async () => { const amountMinor = Math.round(Number(amount) * 100); if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter a valid amount."); setBusy(true); setError(""); try { await recordPropertyExpense(organizationId, { property_id: propertyId, amount_minor: amountMinor, category, incurred_on: incurredOn, note }); await onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the expense."); } finally { setBusy(false); } }} /></View>; }
function rentPriority(tenant: Tenant) { return tenant.rent.status === "overdue" ? 0 : tenant.rent.status === "outstanding" ? 1 : 2; }
function rentStatus(tenant: Tenant) { return tenant.rent.status === "overdue" ? "Overdue" : tenant.rent.status === "outstanding" ? "Payment due" : "Current"; }
function rentColor(status: Tenant["rent"]["status"]) { return status === "overdue" ? LATERITE : status === "outstanding" ? HARMATTAN : KOLA; }
function paymentStatus(payment: Payment) { return payment.evidence === "PSP_CONFIRMED" ? "Processor confirmed" : payment.awaiting_you ? "Review needed" : payment.status === "confirmed" ? "Confirmed by both" : payment.status === "disputed" ? "Disputed" : "Waiting for tenant"; }

const styles = StyleSheet.create({
  expenseBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[1],
  },
  statusDot: {
    width: 10,
    height: 10,
    marginTop: 5,
    borderRadius: 5,
    borderWidth: 3,
  },
  checkpoints: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  checkpoint: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  checkpointLine: {
    width: 14,
    height: 1.5,
    borderRadius: 1,
  },
  checkpointWhen: {
    flexShrink: 1,
    marginLeft: 4,
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  loading: {
    paddingVertical: space[6],
    textAlign: "center",
    color: MUTED,
  },
});
