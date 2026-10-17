import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, RefreshControl, ScrollView, StyleSheet, View, Pressable } from "react-native";

import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { shortDate, useHomeDensity } from "@/components/home/plinth";
import {
  FAINT,
  Footnote,
  GroupLabel,
  HARMATTAN,
  INK,
  InfoNote,
  KOLA,
  KOLA_DEEP,
  LAGOON,
  LATERITE,
  ListRow,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  RowLine,
  SearchField,
  SignalPanel,
  rowStyles,
  type Signal,
} from "@/components/portfolio/PortfolioList";
import { ModalSafeArea, SafeBottom } from "@/components/sheet/ModalSafeArea";
import { Bar, Briefing, BriefingButton, Calm, Empty, Face, Fold, MoreRow } from "@/components/work/WorkParts";
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
import { moneyWork, paymentStatus, thisMonth, type MoneyWork } from "@/paymentsWork";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";
import { ProviderTabFrame } from "@/components/nav/NativeTabFrame";

/**
 * The Portfolio's money, read as work (owner, 2026-10-06).
 *
 * This month's rent leads — what has come in against what is still
 * outstanding, as one bar. Then what needs the landlord: overdue balances,
 * tenant claims to confirm or dispute, and any payout that failed. Then what is
 * moving: rent coming due, money paid by tenants and still on its way, and what
 * was received lately. What was paid out and the Property expenses fold into
 * one line each. The four views behind the Filter sheet are gone; each is a
 * section where it matters.
 *
 * Tenant payment and provider settlement stay different financial facts:
 * "Awaiting settlement" is never counted as money that arrived, and a payout row
 * shows both checkpoints, Paid and then Settled.
 */

type Tenant = PortfolioSummary["tenants"][number];
type Payment = PortfolioSummary["recent_payments"][number];
type Settlement = PortfolioSummary["recent_settlements"][number];
type FoldKind = "paid" | "expenses";
type Entry =
  | { kind: "label"; key: string; title: string; count: number; tone?: string; first: boolean }
  | { kind: "tenant"; key: string; tenant: Tenant; first: boolean; last: boolean }
  | { kind: "payment"; key: string; payment: Payment; first: boolean; last: boolean }
  | { kind: "settlement"; key: string; settlement: Settlement; first: boolean; last: boolean }
  | { kind: "expense"; key: string; expense: PropertyExpense; first: boolean; last: boolean }
  | { kind: "more"; key: string; hidden: number }
  | { kind: "payoutNote"; key: string }
  | { kind: "fold"; key: string; fold: FoldKind; count: number; summary: string; open: boolean }
  | { kind: "noExpenses"; key: string }
  | { kind: "recordExpense"; key: string }
  | { kind: "calm"; key: string };

const RECENT_SHOWN = 5;
const SEARCH_FROM = 9;

function ProviderPaymentsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { action } = useLocalSearchParams<{ action?: string }>();
  const { activeContext } = useAuth();
  const [organizationId, setOrganizationId] = useState("");
  const [canManagePayouts, setCanManagePayouts] = useState(false);
  const [payoutDestination, setPayoutDestination] = useState<PayoutDestinationState | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [expenses, setExpenses] = useState<PropertyExpense[]>([]);
  const [open, setOpen] = useState<{ recent: boolean; paid: boolean; expenses: boolean }>({ recent: false, paid: false, expenses: action === "expense" });
  const [searching, setSearching] = useState(false);
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
    finally { setLoaded(true); }
  }, [activeContext]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const work = useMemo(() => summary ? moneyWork(summary) : null, [summary]);
  const month = useMemo(() => summary ? thisMonth(summary) : null, [summary]);
  const needle = query.trim().toLocaleLowerCase("en-GH");
  const entries = useMemo(
    () => summary && work ? entriesFor(summary, work, expenses, { open, needle, payouts: canManagePayouts && Boolean(organizationId) }) : [],
    [summary, work, expenses, open, needle, canManagePayouts, organizationId],
  );

  function openAccount(input: { leaseId: string; tenantName: string; propertyTitle: string; unitLabel: string; bedLabel?: string | null; tenancyId?: string | null; canRecord?: boolean }) {
    router.push({ pathname: "/(app)/rent-account", params: { leaseId: input.leaseId, tenantName: input.tenantName, propertyTitle: input.propertyTitle, unitLabel: input.unitLabel, bedLabel: input.bedLabel ?? "", tenancyId: input.tenancyId ?? "", canRecord: input.canRecord ? "1" : "0" } } as never);
  }
  const openTenant = (tenant: Tenant) => tenant.lease_id && openAccount({ leaseId: tenant.lease_id, tenantName: tenant.name, propertyTitle: tenant.property_title, unitLabel: tenant.unit_label, bedLabel: tenant.bed_label, tenancyId: tenant.tenancy_id, canRecord: tenant.can_record_payment });
  const openPayment = (payment: Payment) => {
    const tenant = summary?.tenants.find((row) => row.lease_id === payment.lease_id);
    openAccount({ leaseId: payment.lease_id, tenantName: payment.tenant_name, propertyTitle: payment.property_title, unitLabel: payment.unit_label, tenancyId: tenant?.tenancy_id, canRecord: tenant?.can_record_payment });
  };

  // Turning online collection on is the one decision that has no row of its own.
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

  const loading = !loaded && summary === null;
  const nothingAtAll = loaded && !error && (!summary || (!summary.tenants.length && !summary.recent_payments.length && !summary.recent_settlements.length && !expenses.length));
  // Claims to confirm are counted by the server: the recent list it sends is capped,
  // so counting the rows on screen would undercount them.
  const toConfirm = summary && summary.money.payment_records_awaiting_you > 0 ? summary.money.payment_records_awaiting_you : 0;
  const needsYou = work ? work.overdue.length + toConfirm + work.attention.length : 0;
  const parts = summary && work ? [
    summary.money.overdue_minor > 0 ? { text: `${formatMinor(summary.money.overdue_minor)} overdue`, tone: LATERITE, strong: true } : null,
    toConfirm ? { text: `${toConfirm} ${toConfirm === 1 ? "record" : "records"} to confirm`, tone: HARMATTAN } : null,
    summary.money.awaiting_settlement_minor > 0 ? { text: `${formatMinor(summary.money.awaiting_settlement_minor)} on its way`, tone: LAGOON } : null,
    !needsYou ? { text: "Nothing overdue or waiting on you", tone: MUTED } : null,
  ].filter((part): part is NonNullable<typeof part> => part !== null) : [];
  const searchable = (summary?.tenants.length ?? 0) + (summary?.recent_payments.length ?? 0) >= SEARCH_FROM;

  return (
    <IndexGround>
      <FlatList
        data={loading || nothingAtAll ? [] : entries}
        keyExtractor={(entry) => entry.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={loading || nothingAtAll ? (error ? <Notice tone="error" title={error} /> : null) : (
          <View style={styles.header}>
            {error ? <Notice tone="error" title={error} /> : null}
            {month ? <MonthCard month={month} /> : null}
            <Briefing
              title={needsYou ? `${needsYou} ${needsYou === 1 ? "thing needs" : "things need"} you` : "Rent is on track"}
              parts={parts}
              trailing={searchable
                ? <BriefingButton icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search payments"} onPress={() => { setSearching((current) => !current); setQuery(""); }} />
                : undefined}
            />
            {searching ? <SearchField label="Search payments" placeholder="Tenant, Property, Unit or method" value={query} onChangeText={setQuery} /> : null}
            <SignalPanel signals={signals} />
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "label") {
            return (
              <View style={[styles.label, entry.first ? null : styles.labelGap]}>
                <GroupLabel count={entry.count} tone={entry.tone}>{entry.title}</GroupLabel>
              </View>
            );
          }
          if (entry.kind === "more") {
            return (
              <ListRow first={false} last>
                <View style={styles.rule} />
                <MoreRow label={`Show ${entry.hidden} more`} onPress={() => setOpen((current) => ({ ...current, recent: true }))} />
              </ListRow>
            );
          }
          if (entry.kind === "calm") return <Calm text="Nobody is overdue and no tenant claim waits on you." />;
          if (entry.kind === "payoutNote") {
            return (
              <View style={styles.note}>
                <Footnote>Property owners bear Paystack’s transaction fee. A payout is counted as yours once it is settled.</Footnote>
                {canManagePayouts && organizationId ? <QuietAction icon="card-outline" label="Manage settlement account" onPress={() => router.push({ pathname: "/(app)/payout-account", params: { organizationId } } as never)} /> : null}
              </View>
            );
          }
          if (entry.kind === "fold") {
            return (
              <View style={styles.labelGap}>
                <Fold
                  title={entry.fold === "paid" ? "Paid out to you" : "Expenses"}
                  icon={entry.fold === "paid" ? "arrow-down-circle-outline" : "receipt-outline"}
                  summary={entry.summary}
                  count={entry.count}
                  open={entry.open}
                  onToggle={() => setOpen((current) => ({ ...current, [entry.fold]: !current[entry.fold] }))}
                />
              </View>
            );
          }
          if (entry.kind === "noExpenses") {
            return <Empty compact icon="receipt-outline" title="No expenses recorded" hint="Repairs, utilities and levies you pay for a Property can be kept here. Recording one moves no money." />;
          }
          if (entry.kind === "recordExpense") {
            return <View style={styles.record}><QuietAction icon="add" label="Record expense" onPress={() => setShowExpense(true)} /></View>;
          }
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              {entry.kind === "tenant" ? <TenantRow tenant={entry.tenant} onPress={() => openTenant(entry.tenant)} />
                : entry.kind === "payment" ? <PaymentRow payment={entry.payment} onPress={() => openPayment(entry.payment)} />
                  : entry.kind === "settlement" ? <SettlementRow settlement={entry.settlement} narrow={density.veryCompact} />
                    : <ExpenseRow expense={entry.expense} />}
            </ListRow>
          );
        }}
        ListEmptyComponent={loading ? <PaymentsSkeleton /> : nothingAtAll ? (
          <Empty
            icon="wallet-outline"
            title="No rent to track yet"
            hint="Balances, payments and payouts appear here once a tenancy is running."
            action={<QuietAction icon="add" label="Record an expense" onPress={() => setShowExpense(true)} />}
          />
        ) : needle ? (
          <Empty icon="search-outline" title="No matching payments" hint="Try another tenant, Property, Unit or method." />
        ) : null}
        ListFooterComponent={summary && !needle && summary.verification.payments_ready < summary.verification.properties_total ? (
          <View style={styles.labelGap}>
            <InfoNote tone="lagoon" icon="information-circle-outline" title="Online collection is not ready for some Properties" body="It needs current identity, Property authority and a verified settlement account. Recording money paid to you directly still works." />
          </View>
        ) : null}
      />
      <ExpenseModal visible={showExpense} organizationId={organizationId} properties={properties} onClose={() => setShowExpense(false)} onDone={async () => { setShowExpense(false); setOpen((current) => ({ ...current, expenses: true })); await load(); }} />
    </IndexGround>
  );
}

function entriesFor(
  summary: PortfolioSummary,
  work: MoneyWork,
  expenses: PropertyExpense[],
  { open, needle, payouts }: { open: { recent: boolean; paid: boolean; expenses: boolean }; needle: string; payouts: boolean },
): Entry[] {
  const out: Entry[] = [];
  const label = (key: string, title: string, count: number, tone?: string) =>
    out.push({ kind: "label", key: `label:${key}`, title, count, tone, first: out.length === 0 });
  const tenants = (list: Tenant[], prefix: string) => list.forEach((tenant, index) => out.push({ kind: "tenant", key: `${prefix}:${tenant.occupancy_id}`, tenant, first: index === 0, last: index === list.length - 1 }));
  const payments = (list: Payment[], prefix: string, cut = false) => list.forEach((payment, index) => out.push({ kind: "payment", key: `${prefix}:${payment.id}`, payment, first: index === 0, last: !cut && index === list.length - 1 }));
  const settlements = (list: Settlement[], prefix: string) => list.forEach((settlement, index) => out.push({ kind: "settlement", key: `${prefix}:${settlement.id}`, settlement, first: index === 0, last: index === list.length - 1 }));

  if (needle) {
    const matches = (text: string) => text.toLocaleLowerCase("en-GH").includes(needle);
    const foundTenants = summary.tenants.filter((tenant) => matches(`${tenant.name} ${tenant.property_title} ${tenant.unit_label} ${tenant.bed_label ?? ""}`));
    const foundPayments = summary.recent_payments.filter((payment) => matches(`${payment.tenant_name} ${payment.property_title} ${payment.unit_label} ${payment.method_display}`));
    if (foundTenants.length) { label("found-tenants", "Balances", foundTenants.length); tenants(foundTenants, "found"); }
    if (foundPayments.length) { label("found-payments", "Payments", foundPayments.length); payments(foundPayments, "found"); }
    return out;
  }

  // What needs the landlord, in the order it costs them.
  if (work.overdue.length) { label("overdue", "Overdue", work.overdue.length, LATERITE); tenants(work.overdue, "overdue"); }
  if (work.toReview.length) { label("review", "To confirm", work.toReview.length, HARMATTAN); payments(work.toReview, "review"); }
  if (work.attention.length) { label("attention", "Payout needs review", work.attention.length, LATERITE); settlements(work.attention, "attention"); }
  if (!work.overdue.length && !work.toReview.length && !work.attention.length && (summary.tenants.length || summary.recent_payments.length)) out.push({ kind: "calm", key: "calm" });

  // What is moving.
  if (work.due.length) { label("due", "Coming due", work.due.length); tenants(work.due, "due"); }
  if (work.onTheWay.length) {
    label("way", "On its way to you", work.onTheWay.length, LAGOON);
    settlements(work.onTheWay, "way");
    out.push({ kind: "payoutNote", key: "payoutNote" });
  }
  if (work.recent.length) {
    label("recent", "Received", work.recent.length);
    const cut = !open.recent && work.recent.length > RECENT_SHOWN + 1;
    const shown = cut ? work.recent.slice(0, RECENT_SHOWN) : work.recent;
    payments(shown, "recent", cut);
    if (cut) out.push({ kind: "more", key: "more:recent", hidden: work.recent.length - shown.length });
  }

  // What is done, one line each.
  if (work.paidOut.length) {
    out.push({
      kind: "fold",
      key: "fold:paid",
      fold: "paid",
      count: work.paidOut.length,
      summary: `${formatMinor(summary.money.settled_net_minor)} after ${formatMinor(summary.money.settled_fee_minor)} in fees`,
      open: open.paid,
    });
    if (open.paid) {
      settlements(work.paidOut, "paid");
      if (payouts && !work.onTheWay.length) out.push({ kind: "payoutNote", key: "payoutNote:paid" });
    }
  }
  const spent = expenses.reduce((total, expense) => total + expense.amount_minor, 0);
  out.push({
    kind: "fold",
    key: "fold:expenses",
    fold: "expenses",
    count: expenses.length,
    summary: expenses.length ? `${formatMinor(spent)} recorded` : "Nothing recorded yet",
    open: open.expenses,
  });
  if (open.expenses) {
    if (expenses.length) expenses.forEach((expense, index) => out.push({ kind: "expense", key: `expense:${expense.id}`, expense, first: index === 0, last: index === expenses.length - 1 }));
    else out.push({ kind: "noExpenses", key: "noExpenses" });
    out.push({ kind: "recordExpense", key: "recordExpense" });
  }
  return out;
}

/**
 * This month's rent as one bar: received against what is still outstanding for
 * charges due this month. Outstanding is today's balance, so it is said as
 * "still outstanding" — never as what was owed at some earlier point.
 */
function MonthCard({ month }: { month: NonNullable<ReturnType<typeof thisMonth>> }) {
  const total = month.collected + month.outstanding;
  return (
    <View accessible accessibilityLabel={`${month.label} rent: ${formatMinor(month.collected)} received${month.outstanding ? `, ${formatMinor(month.outstanding)} still outstanding` : ""}.`} style={styles.month}>
      <Type variant="label" style={styles.monthEyebrow}>{`${month.label.toUpperCase()} RENT`}</Type>
      <View style={styles.monthFigures}>
        <Type variant="display2" numberOfLines={1} style={styles.monthFigure}>{formatMinor(month.collected).replace(/\.00$/, "")}</Type>
        <Type variant="caption" style={styles.monthOf}>{total ? `received of ${formatMinor(total).replace(/\.00$/, "")}` : "received"}</Type>
      </View>
      <Bar value={total ? month.share : 0} tone={KOLA} track={theme.color.harmattan["100"]} />
      <View style={styles.monthLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: KOLA }]} />
          <Type variant="caption" style={styles.legendText}>{total ? `${Math.round(month.share * 100)}% in` : "Nothing due yet"}</Type>
        </View>
        {month.outstanding ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: HARMATTAN }]} />
            <Type variant="caption" style={styles.legendText}>{`${formatMinor(month.outstanding).replace(/\.00$/, "")} still outstanding`}</Type>
          </View>
        ) : total ? (
          <Type variant="caption" style={[styles.legendText, { color: KOLA_DEEP }]}>{`All of ${month.label}’s rent is in`}</Type>
        ) : null}
      </View>
    </View>
  );
}

/** One balance: who, the amount, where, and how it stands — overdue in laterite, coming due in harmattan. */
function TenantRow({ tenant, onPress }: { tenant: Tenant; onPress: () => void }) {
  const overdue = tenant.rent.status === "overdue";
  const tone = overdue ? LATERITE : HARMATTAN;
  const amount = formatMinor(overdue ? tenant.rent.overdue_minor : tenant.rent.outstanding_minor, tenant.lease_rent_currency ?? "GHS");
  const due = tenant.rent.next_due_on;
  const line = overdue ? (due ? `Overdue · was due ${shortDate(due)}` : "Overdue") : due ? `Due ${shortDate(due)}` : "Payment due";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tenant.name}. ${tenant.property_title}, ${tenant.unit_label}. ${line}. ${amount}. Open rent account.`}
      disabled={!tenant.lease_id}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, styles.row, tenant.lease_id ? null : { opacity: 0.55 }, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Face name={tenant.name} ink={tone} wash={overdue ? theme.color.laterite["100"] : theme.color.harmattan["100"]} />
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{tenant.name}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={[rowStyles.rowAmount, overdue ? { color: LATERITE } : null]}>{amount}</Type>}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{[tenant.property_title, tenant.unit_label, tenant.bed_label].filter(Boolean).join(" · ")}</Type>
        <Type variant="caption" numberOfLines={1} style={[styles.line, { color: tone }]}>{line}</Type>
      </View>
    </Pressable>
  );
}

function PaymentsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading payments" style={styles.skeleton}>
      <Bone height={128} round={20} />
      <Bone width="56%" height={22} />
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={38} height={38} round={19} />
            <View style={styles.skeletonLines}>
              <Bone width="46%" height={14} />
              <Bone width="70%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function PaymentRow({ payment, onPress }: { payment: Payment; onPress: () => void }) {
  const external = payment.source === "EXTERNAL";
  const amount = formatMinor(payment.amount_minor, payment.currency);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${payment.tenant_name}. ${amount}. ${paymentStatus(payment)}. ${payment.method_display}, ${shortDate(payment.paid_on)}. ${external ? "External, recorded through Danpa HQ" : "Processed through Danpa HQ"}. Open rent account.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
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
        <Ionicons name={attention ? "warning-outline" : "arrow-down-circle-outline"} size={15} color={tone} />
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

function ExpenseModal({ visible, organizationId, properties, onClose, onDone }: { visible: boolean; organizationId: string; properties: ManagedProperty[]; onClose: () => void; onDone: () => Promise<void> }) { return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><ModalSafeArea><SafeBottom render={(bottom) => <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[8] + bottom, gap: space[4] }}><View style={{ gap: space[1] }}><Type variant="label">INTERNAL RECORD</Type><Type variant="title1" accessibilityRole="header">Record Property expense</Type><Type variant="caption">This records an expense. It does not move money.</Type></View><ExpenseForm organizationId={organizationId} properties={properties} onDone={onDone} /><Button label="Cancel" variant="quiet" onPress={onClose} /></ScrollView>} /></ModalSafeArea></Modal>; }
const EXPENSE_CATEGORIES = [["maintenance", "Maintenance"], ["utilities", "Utilities"], ["staff", "Staff"], ["tax", "Tax or levy"], ["supplies", "Supplies"], ["other", "Other"]] as const;
function ExpenseForm({ organizationId, properties, onDone }: { organizationId: string; properties: ManagedProperty[]; onDone: () => Promise<void> }) { const [propertyId, setPropertyId] = useState(properties[0]?.id ?? ""); const [category, setCategory] = useState("maintenance"); const [amount, setAmount] = useState(""); const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); return <View style={{ gap: space[3] }}><Type variant="label">PROPERTY</Type>{properties.map((property) => <Button key={property.id} label={property.title} variant="secondary" selected={propertyId === property.id} onPress={() => setPropertyId(property.id)} />)}<Type variant="label">CATEGORY</Type><View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{EXPENSE_CATEGORIES.map(([value, label]) => <Button key={value} label={label} variant="quiet" selected={category === value} onPress={() => setCategory(value)} />)}</View><Field label="Amount (GH₵)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><Field label="Date (YYYY-MM-DD)" value={incurredOn} onChangeText={setIncurredOn} /><Field label="Note (optional)" value={note} onChangeText={setNote} />{error ? <Notice tone="error" title={error} /> : null}<Button label="Save expense record" busy={busy} disabled={!propertyId || !amount.trim()} onPress={async () => { const amountMinor = Math.round(Number(amount) * 100); if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter a valid amount."); setBusy(true); setError(""); try { await recordPropertyExpense(organizationId, { property_id: propertyId, amount_minor: amountMinor, category, incurred_on: incurredOn, note }); await onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the expense."); } finally { setBusy(false); } }} /></View>; }
const styles = StyleSheet.create({
  header: { gap: space[4], marginBottom: space[5] },
  label: { paddingBottom: space[2] },
  labelGap: { marginTop: space[5] },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: 64, backgroundColor: RULE },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  row: { paddingVertical: 14 },
  line: { fontSize: 12.5, lineHeight: 17, fontWeight: "500", marginTop: 2 },
  note: { gap: space[3], marginTop: space[3] },
  record: { marginTop: space[3], alignItems: "flex-start" },
  // This month: the one figure that says how the rent is coming in.
  month: { gap: space[3], padding: space[4], borderRadius: 20, backgroundColor: theme.color.field["0"], borderWidth: StyleSheet.hairlineWidth, borderColor: RULE },
  monthEyebrow: { color: MUTED, letterSpacing: 0.6 },
  monthFigures: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space[2] },
  monthFigure: { fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: INK, fontVariant: ["tabular-nums"] },
  monthOf: { fontSize: 13.5, lineHeight: 19, color: MUTED },
  monthLegend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[4], rowGap: space[1] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12.5, lineHeight: 17, color: MUTED },
  skeleton: { gap: space[3] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
  checkpoints: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  checkpoint: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
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
});

/** On iOS the tab sits in the native bar, which draws no header; see `ProviderTabFrame`. */
export default function ProviderPaymentsTab() {
  return (
    <ProviderTabFrame tab="payments">
      <ProviderPaymentsScreen />
    </ProviderTabFrame>
  );
}
