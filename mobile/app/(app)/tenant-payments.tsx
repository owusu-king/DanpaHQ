import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { AuthPrompt } from "@/components/AuthPrompt";
import { Bone } from "@/components/billing/BillingParts";
import { Panel, SheetList, ViewAll } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  EmptyState,
  FAINT,
  Footnote,
  GroupLabel,
  HARMATTAN,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  RowLine,
  SignalPanel,
  SummaryPanel,
  WHITE,
  rowStyles,
  type IconName,
  type SummaryNote,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, radius, space } from "@/components/ui";
import { getLeaseLedger, type LeaseLedger, type RentCharge, type RentPayment } from "@/leases";
import { formatMinor } from "@/listings";
import { listPaymentIntents, paymentMethodLabel, type PaymentIntent } from "@/payments";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { listMyTenancies, tenancyLabel, type Tenancy } from "@/tenancy";
import { theme } from "@/theme";

type Account = { tenancy: Tenancy; ledger: LeaseLedger };
type DueRow = { account: Account; charge: RentCharge; intent: PaymentIntent | null };
type HistoryRow = { account: Account; payment: RentPayment; receiptId: string | null };
type Sheet = "due" | "history" | "attempts";

const OPEN_INTENT = new Set(["created", "pending", "processing"]);
const FAILED_INTENT = new Set(["failed", "expired", "cancelled"]);
/** How many rows a panel shows before the rest wait in its sheet. */
const SHOWN = 3;

const KIND_ICON: Record<RentCharge["kind"], IconName> = {
  rent: "home-outline",
  advance: "calendar-outline",
  deposit: "shield-checkmark-outline",
  agency_fee: "briefcase-outline",
};

/**
 * The tenant's money, across every home.
 *
 * Refined on review (2026-09-15) into one reading order instead of two tabs: how
 * much is outstanding and whether any of it is late, anything the tenant is asked
 * to confirm, what is due with the one thing to do about each, and the latest
 * payments with their receipts. Nothing long is laid out at once — each panel
 * shows its first few rows, and the rest open in the shared sheet.
 */
export default function TenantPaymentsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

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
  const confirmationRows = useMemo(() => (accounts ?? []).flatMap((account) => account.ledger.payments
    .filter((payment) => payment.awaiting_you).map((payment) => ({ account, payment }))), [accounts]);

  const outstanding = dueRows.reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const overdue = dueRows.filter((row) => row.charge.is_overdue)
    .reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const inProgress = dueRows.filter((row) => row.intent).length;
  const unavailable = dueRows.some((row) => !row.account.ledger.digital_payment.available && !row.intent);

  // Late money leads; a payment still confirming is the next thing worth saying.
  const note: SummaryNote = overdue > 0
    ? { text: `${formatMinor(overdue)} overdue`, tone: "alert" }
    : inProgress > 0
      ? { text: `${inProgress} ${inProgress === 1 ? "payment" : "payments"} confirming`, tone: "calm" }
      : { text: outstanding > 0 ? "Nothing overdue" : "All paid up", tone: "calm" };
  const next = dueRows.filter((row) => !row.charge.is_overdue)
    .sort((a, b) => a.charge.due_on.localeCompare(b.charge.due_on))[0];
  // Paid means it counts: a claim still waiting for confirmation is not the last payment.
  const latest = history.find((row) => row.payment.is_confirmed || row.payment.evidence === "PSP_CONFIRMED");
  const facts = [
    next ? { label: "Next due", value: dayMonth(next.charge.due_on) } : null,
    latest ? { label: "Last paid", value: paidAmount(latest.payment) } : null,
    { label: "Rent accounts", value: String(accounts?.length ?? 0) },
  ].filter((fact): fact is { label: string; value: string } => fact !== null).slice(0, 2);

  // A row in a sheet closes it first: the sheet is a modal, and would sit over the next screen.
  const openDue = (row: DueRow) => {
    setSheet(null);
    if (row.intent) {
      router.push({ pathname: "/(app)/payment-status", params: { intentId: row.intent.id } } as never);
    } else {
      router.push({ pathname: "/(app)/payment-checkout", params: { leaseId: row.account.tenancy.lease!.id, obligationId: row.charge.id } } as never);
    }
  };
  const openPayment = ({ account, receiptId }: HistoryRow) => {
    setSheet(null);
    if (receiptId) {
      router.push({ pathname: "/(app)/payment-receipt", params: { receiptId } } as never);
    } else {
      openAccount(router, account.tenancy);
    }
  };

  if (!signedIn) {
    return (
      <AuthPrompt
        icon="wallet"
        tone="kola"
        title="Your payments"
        body="Rent due, what you have paid, and a receipt for each — for every home you rent."
        next="/(app)/(tabs)/payments"
        points={[
          { icon: "calendar-outline", label: "See what is due before it is late" },
          { icon: "card-outline", label: "Pay rent from the app" },
          { icon: "document-text-outline", label: "Keep a receipt for every payment" },
        ]}
      />
    );
  }

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: density.sectionGap + space[2] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        {accounts === null ? <PaymentsSkeleton /> : null}
        {accounts?.length === 0 && !error ? (
          <EmptyState
            icon="wallet-outline"
            hero
            title="No rent account yet"
            hint="Payments appear here once an agreement sets a rent schedule."
            action={<View style={styles.emptyAction}><QuietAction icon="document-text-outline" label="Your agreements" onPress={() => router.push("/(app)/leases" as never)} /></View>}
          />
        ) : null}

        {accounts?.length ? (
          <>
            <SummaryPanel label="Outstanding" value={formatMinor(outstanding)} note={note} facts={facts} />

            <SignalPanel
              title="Confirm an external payment"
              signals={confirmationRows.map(({ account, payment }) => ({
                key: payment.id,
                icon: "checkmark-done-outline",
                tone: HARMATTAN,
                wash: theme.color.harmattan["100"],
                title: `${payment.recorded_by_name} recorded ${paidAmount(payment)}`,
                detail: [payment.method_display, payment.obligation_label, account.tenancy.property.title].filter(Boolean).join(" · "),
                hint: "Opens the rent account to confirm it",
                onPress: () => openAccount(router, account.tenancy),
              }))}
            />

            <View style={styles.section}>
              <GroupLabel count={dueRows.length || undefined}>Due now</GroupLabel>
              <Panel>
                {dueRows.length ? dueRows.slice(0, SHOWN).map((row, index) => (
                  <DueItem key={row.charge.id} row={row} first={index === 0} onPress={() => openDue(row)} />
                )) : <QuietRow icon="checkmark-circle-outline" title="Nothing due" />}
                {dueRows.length > SHOWN ? <ViewAll count={dueRows.length} noun="due items" onPress={() => setSheet("due")} /> : null}
              </Panel>
              {unavailable ? <Footnote>Pay rent explains anything a home still needs before it can be paid online.</Footnote> : null}
            </View>

            <View style={styles.section}>
              <GroupLabel count={history.length || undefined}>Payments</GroupLabel>
              <Panel>
                {history.length ? history.slice(0, SHOWN).map((row, index) => (
                  <PaymentItem key={row.payment.id} row={row} first={index === 0} onPress={() => openPayment(row)} />
                )) : <QuietRow icon="receipt-outline" title="No payments yet" />}
                {history.length > SHOWN ? <ViewAll count={history.length} noun="payments" onPress={() => setSheet("history")} /> : null}
                {unsuccessful.length ? <PanelLink label="Unsuccessful attempts" count={unsuccessful.length} onPress={() => setSheet("attempts")} /> : null}
              </Panel>
            </View>
          </>
        ) : null}
      </ScrollView>

      <BottomSheet visible={sheet === "due"} onClose={() => setSheet(null)} title="Due now" closeLabel="Close due items">
        <SheetList summary={`${dueRows.length} due ${dueRows.length === 1 ? "item" : "items"} · ${formatMinor(outstanding)}`}>
          {dueRows.map((row, index) => <DueItem key={row.charge.id} row={row} first={index === 0} onPress={() => openDue(row)} />)}
        </SheetList>
      </BottomSheet>
      <BottomSheet visible={sheet === "history"} onClose={() => setSheet(null)} title="Payments" closeLabel="Close payments">
        <SheetList summary={`${history.length} ${history.length === 1 ? "payment" : "payments"}, newest first`}>
          {history.map((row, index) => <PaymentItem key={row.payment.id} row={row} first={index === 0} onPress={() => openPayment(row)} />)}
        </SheetList>
      </BottomSheet>
      <BottomSheet visible={sheet === "attempts"} onClose={() => setSheet(null)} title="Unsuccessful attempts" closeLabel="Close unsuccessful attempts">
        <SheetList summary="These attempts did not mark rent as paid.">
          {unsuccessful.map((intent, index) => <AttemptItem key={intent.id} intent={intent} first={index === 0} />)}
        </SheetList>
      </BottomSheet>
    </IndexGround>
  );
}

/**
 * One thing owed, read top to bottom: what it is against how much, which home,
 * then how it stands beside the one thing to do. The row is the button; the pill
 * only says what pressing it does.
 */
function DueItem({ row, first, onPress }: { row: DueRow; first: boolean; onPress: () => void }) {
  const { account, charge, intent } = row;
  const look = dueLook(charge, intent);
  const action = intent ? "Check status" : charge.kind === "rent" ? "Pay rent" : `Pay ${charge.kind_display.toLowerCase()}`;
  const amount = charge.outstanding_formatted ?? formatMinor(charge.outstanding_minor, charge.amount_currency);
  const place = placeOf(account.tenancy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${charge.kind_display}. ${amount}. ${place}. ${look.status}. ${action}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[rowStyles.well, { backgroundColor: look.wash }]}>
        <Ionicons name={look.icon} size={16} color={look.ink} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{charge.kind_display}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{amount}</Type>}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{place}</Type>
        <View style={styles.standing}>
          <View style={styles.standingLine}>
            <View style={[styles.dot, { backgroundColor: look.ink }]} />
            <Type variant="captionStrong" style={[styles.standingText, { color: look.text }]}>{look.status}</Type>
          </View>
          <View style={[styles.act, intent ? styles.actQuiet : null]}>
            <Type variant="captionStrong" style={[styles.actText, intent ? { color: KOLA_DEEP } : null]}>{action}</Type>
            <Ionicons name="arrow-forward" size={13} color={intent ? KOLA_DEEP : WHITE} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Late in laterite, confirming in harmattan, and anything else by what kind of charge it is. */
function dueLook(charge: RentCharge, intent: PaymentIntent | null): { icon: IconName; ink: string; text: string; wash: string; status: string } {
  const part = charge.status === "part_paid" ? " · part paid" : "";
  if (intent) {
    return { icon: "hourglass-outline", ink: HARMATTAN, text: HARMATTAN, wash: theme.color.harmattan["100"], status: "Confirming payment" };
  }
  if (charge.is_overdue) {
    const days = `${charge.days_overdue} ${charge.days_overdue === 1 ? "day" : "days"}`;
    return { icon: "alert-circle-outline", ink: LATERITE, text: LATERITE, wash: theme.color.laterite["100"], status: `${days} overdue${part}` };
  }
  return { icon: KIND_ICON[charge.kind], ink: KOLA, text: MUTED, wash: theme.color.kola["50"], status: `Due ${dayMonth(charge.due_on)}${part}` };
}

/**
 * One payment: what it paid for against how much; how it stands against its
 * receipt; then when, how and for which home, on a line that wraps rather than
 * cutting a date short.
 */
function PaymentItem({ row, first, onPress }: { row: HistoryRow; first: boolean; onPress: () => void }) {
  const { account, payment, receiptId } = row;
  const look = paymentLook(payment);
  const amount = paidAmount(payment);
  const title = payment.obligation_label || "Payment";
  const action = receiptId ? "Receipt" : "Details";
  const place = placeOf(account.tenancy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${amount}. ${look.status}. ${place}. ${action}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.mark, { backgroundColor: look.wash }]}>
        <Ionicons name={look.icon} size={15} color={look.ink} />
      </View>
      <View style={[rowStyles.rowBody, styles.paymentBody]}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{title}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{amount}</Type>}
        />
        <RowLine
          start={(
            <View style={styles.word}>
              <View style={[styles.dot, { backgroundColor: look.ink }]} />
              <Type variant="captionStrong" numberOfLines={1} style={[styles.wordText, { color: look.text }]}>{look.status}</Type>
            </View>
          )}
          end={(
            <View style={styles.word}>
              <Ionicons name={receiptId ? "receipt-outline" : "reader-outline"} size={13} color={KOLA} />
              <Type variant="captionStrong" style={styles.actionText}>{action}</Type>
            </View>
          )}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>{shortDate(payment.paid_on)} · {payment.method_display} · {place}</Type>
      </View>
    </Pressable>
  );
}

function paymentLook(payment: RentPayment): { icon: IconName; ink: string; text: string; wash: string; status: string } {
  const status = paymentStatus(payment);
  if (payment.status === "disputed") return { icon: "close", ink: LATERITE, text: LATERITE, wash: theme.color.laterite["100"], status };
  if (payment.awaiting_you) return { icon: "alert", ink: HARMATTAN, text: HARMATTAN, wash: theme.color.harmattan["100"], status };
  if (payment.evidence === "PSP_CONFIRMED" || payment.status === "confirmed") {
    return { icon: "checkmark", ink: KOLA, text: KOLA_DEEP, wash: theme.color.kola["50"], status };
  }
  return { icon: "time-outline", ink: theme.color.ink["500"], text: MUTED, wash: theme.color.field["100"], status };
}

/** An attempt that did not pay anything: not a record, so not a way in. */
function AttemptItem({ intent, first }: { intent: PaymentIntent; first: boolean }) {
  const status = intent.status === "failed" ? "Not completed" : sentenceCase(intent.status);
  const place = [intent.property_title, intent.unit_label].filter(Boolean).join(" · ");
  return (
    <View accessible accessibilityLabel={`${place}. ${intent.amount_formatted}. ${status}.`} style={[rowStyles.row, first ? null : styles.ruled]}>
      <View style={[styles.mark, { backgroundColor: theme.color.field["100"] }]}>
        <Ionicons name="close" size={15} color={theme.color.ink["500"]} />
      </View>
      <View style={[rowStyles.rowBody, styles.paymentBody]}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{place}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{intent.amount_formatted}</Type>}
        />
        <RowLine
          start={<Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{shortDate(intent.updated_at)} · {paymentMethodLabel(intent.payment_method)}</Type>}
          end={<Type variant="captionStrong" numberOfLines={1} style={[styles.wordText, { color: FAINT }]}>{status}</Type>}
        />
      </View>
    </View>
  );
}

/** A panel with nothing in it yet says so in one line, in the same glass. */
function QuietRow({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={[rowStyles.row, styles.quiet]}>
      <View style={[rowStyles.well, { backgroundColor: theme.color.kola["50"] }]}>
        <Ionicons name={icon} size={16} color={KOLA} />
      </View>
      <Type variant="bodyStrong" style={[rowStyles.rowTitle, styles.quietText]}>{title}</Type>
    </View>
  );
}

/** The way into a sheet that is not "all" of what the panel shows. */
function PanelLink({ label, count, onPress }: { label: string; count: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.link, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Type variant="captionStrong" style={styles.linkText}>{label}</Type>
      <Type variant="caption" style={styles.linkCount}>{count}</Type>
      <Ionicons name="chevron-forward" size={16} color={KOLA} />
    </Pressable>
  );
}

/** Shaped like the summary and the first panel, so nothing jumps when they arrive. */
function PaymentsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your payments" style={styles.skeleton}>
      <Panel style={styles.skeletonPanel}>
        <Bone width="30%" height={11} />
        <Bone width="54%" height={30} />
        <Bone width="40%" />
        <Bone height={34} />
      </Panel>
      <Panel style={styles.skeletonPanel}>
        <Bone width="24%" height={11} />
        <Bone height={44} />
        <Bone height={44} />
      </Panel>
    </View>
  );
}

function openAccount(router: ReturnType<typeof useRouter>, tenancy: Tenancy) {
  router.push({ pathname: "/(app)/rent-account", params: { leaseId: tenancy.lease?.id ?? "", propertyTitle: tenancy.property.title, unitLabel: tenancy.space.unit_label, bedLabel: tenancy.space.bed_label ?? "", tenancyId: tenancy.id, mode: "tenant" } } as never);
}
/** The home, with a short label held to the word before it, so "Bed A" never breaks across lines. */
function placeOf(tenancy: Tenancy) { return [tenancy.property.title, tenancyLabel(tenancy)].filter(Boolean).join(" · ").replace(/ (?=\S{1,2}(?:\s|$))/g, "\u00A0"); }
function paidAmount(payment: RentPayment) { return payment.amount_formatted ?? formatMinor(payment.amount_minor, payment.amount_currency); }
function paymentStatus(payment: RentPayment) { return payment.evidence === "PSP_CONFIRMED" ? "Processor confirmed" : payment.awaiting_you ? "Review needed" : payment.status === "confirmed" ? "Confirmed by both" : payment.status === "disputed" ? "Disputed" : payment.recorded_by_tenant ? "Waiting for provider" : "Waiting for you"; }
function sentenceCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " "); }
function dayMonth(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", { day: "numeric", month: "short" }); }
/** A day and month, with the year only when it is not this one. */
function shortDate(value: string) {
  const at = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return at.toLocaleDateString("en-GH", { day: "numeric", month: "short", ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  // The pill drops under the status when the two do not fit side by side.
  standing: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space[2],
    rowGap: space[2],
    marginTop: space[2],
  },
  standingLine: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 110,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  standingText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 17,
  },
  act: {
    marginLeft: "auto",
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: KOLA,
  },
  actQuiet: {
    backgroundColor: theme.color.kola["50"],
  },
  actText: {
    fontSize: 13,
    lineHeight: 17,
    color: WHITE,
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
    gap: 3,
  },
  word: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  wordText: {
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 17,
  },
  actionText: {
    fontSize: 13,
    lineHeight: 17,
    color: KOLA_DEEP,
  },
  quiet: {
    alignItems: "center",
  },
  quietText: {
    flex: 1,
  },
  link: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: KOLA_DEEP,
  },
  linkCount: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    fontVariant: ["tabular-nums"],
  },
  emptyAction: {
    marginTop: space[2],
  },
  skeleton: {
    gap: space[5],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
});
