import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { AuthPrompt } from "@/components/AuthPrompt";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
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
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Act, Acts, Calm, Empty, Fold, MoreRow } from "@/components/work/WorkParts";
import { Notice, Type, radius, space } from "@/components/ui";
import { getLeaseLedger, type LeaseLedger, type RentCharge, type RentPayment } from "@/leases";
import { formatMinor } from "@/listings";
import { listPaymentIntents, paymentMethodLabel, type PaymentIntent } from "@/payments";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { listMyTenancies, tenancyLabel, type Tenancy } from "@/tenancy";
import { theme } from "@/theme";

type Account = { tenancy: Tenancy; ledger: LeaseLedger };
type DueRow = { account: Account; charge: RentCharge; intent: PaymentIntent | null };
type HistoryRow = { account: Account; payment: RentPayment; receiptId: string | null };

const OPEN_INTENT = new Set(["created", "pending", "processing"]);
const FAILED_INTENT = new Set(["failed", "expired", "cancelled"]);
/** How many payments show before the rest are one tap away. */
const HISTORY_SHOWN = 5;
const WHITE = theme.color.field["0"];

const KIND_ICON: Record<RentCharge["kind"], IconName> = {
  rent: "home-outline",
  advance: "calendar-outline",
  deposit: "shield-checkmark-outline",
  agency_fee: "briefcase-outline",
};

/**
 * The tenant's money, across every home — read as what to pay next (owner,
 * 2026-10-06).
 *
 * The next thing owed leads on its own card: how much, for which home, when it
 * is due or how late it is, and the one button that pays it. Anything else due
 * follows with its own step; then any payment the tenant is asked to confirm;
 * then what they have paid, newest first, each with its receipt. Attempts that
 * did not go through fold into one line. The summary panel and the three sheets
 * are gone.
 */
export default function TenantPaymentsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [open, setOpen] = useState({ history: false, attempts: false });
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

  // Late first, then soonest: the first of these is the one to pay.
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

  const [lead, ...restDue] = dueRows;
  const outstanding = dueRows.reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const unavailable = dueRows.some((row) => !row.account.ledger.digital_payment.available && !row.intent);
  // Paid means it counts: a claim still waiting for confirmation is not the last payment.
  const latest = history.find((row) => row.payment.is_confirmed || row.payment.evidence === "PSP_CONFIRMED");

  const openDue = (row: DueRow) => {
    if (row.intent) {
      router.push({ pathname: "/(app)/payment-status", params: { intentId: row.intent.id } } as never);
    } else {
      router.push({ pathname: "/(app)/payment-checkout", params: { leaseId: row.account.tenancy.lease!.id, obligationId: row.charge.id } } as never);
    }
  };
  const openPayment = ({ account, receiptId }: HistoryRow) => {
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

  const shownHistory = open.history ? history : history.slice(0, HISTORY_SHOWN);

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: space[5] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
      >
        {error ? <Notice tone="error" title={error} /> : null}
        {accounts === null ? <PaymentsSkeleton /> : null}
        {accounts?.length === 0 && !error ? (
          <Empty
            icon="wallet-outline"
            title="No rent account yet"
            hint="Payments appear here once an agreement sets a rent schedule."
            action={<QuietAction icon="document-text-outline" label="Your agreements" onPress={() => router.push("/(app)/leases" as never)} />}
          />
        ) : null}

        {accounts?.length ? (
          <>
            {lead ? (
              <NextDue row={lead} more={restDue.length} total={outstanding} onPay={() => openDue(lead)} />
            ) : (
              <Calm text={latest ? `All paid up. Your last payment was ${paidAmount(latest.payment)} on ${shortDate(latest.payment.paid_on)}.` : "All paid up. Nothing is due on any of your homes."} />
            )}
            {unavailable ? <Footnote>Pay rent explains anything a home still needs before it can be paid online.</Footnote> : null}

            {confirmationRows.length ? (
              <View style={styles.section}>
                <GroupLabel count={confirmationRows.length} tone={HARMATTAN}>To confirm</GroupLabel>
                <Panel>
                  {confirmationRows.map(({ account, payment }, index) => (
                    <ConfirmItem key={payment.id} account={account} payment={payment} first={index === 0} onPress={() => openAccount(router, account.tenancy)} />
                  ))}
                </Panel>
              </View>
            ) : null}

            {restDue.length ? (
              <View style={styles.section}>
                <GroupLabel count={restDue.length}>Also due</GroupLabel>
                <Panel>
                  {restDue.map((row, index) => <DueItem key={row.charge.id} row={row} first={index === 0} onPress={() => openDue(row)} />)}
                </Panel>
              </View>
            ) : null}

            <View style={styles.section}>
              <GroupLabel count={history.length || undefined}>Paid</GroupLabel>
              {history.length ? (
                <Panel>
                  {shownHistory.map((row, index) => (
                    <PaymentItem key={row.payment.id} row={row} first={index === 0} onPress={() => openPayment(row)} />
                  ))}
                  {!open.history && history.length > HISTORY_SHOWN + 1 ? (
                    <View style={styles.ruled}>
                      <MoreRow label={`Show ${history.length - HISTORY_SHOWN} more`} onPress={() => setOpen((current) => ({ ...current, history: true }))} />
                    </View>
                  ) : null}
                </Panel>
              ) : (
                <Empty compact icon="receipt-outline" title="No payments yet" hint="Each payment you make shows here with its receipt." />
              )}
            </View>

            {unsuccessful.length ? (
              <View>
                <Fold
                  title="Unsuccessful attempts"
                  icon="close-circle-outline"
                  summary="These did not mark rent as paid"
                  count={unsuccessful.length}
                  open={open.attempts}
                  onToggle={() => setOpen((current) => ({ ...current, attempts: !current.attempts }))}
                />
                {open.attempts ? (
                  <View style={styles.foldBody}>
                    <Panel>
                      {unsuccessful.map((intent, index) => <AttemptItem key={intent.id} intent={intent} first={index === 0} />)}
                    </Panel>
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </IndexGround>
  );
}

/**
 * The next thing owed, on its own card: whether it is late, how much, for which
 * home, and the button that pays it — or, while a payment is confirming, the way
 * to its status.
 */
function NextDue({ row, more, total, onPay }: { row: DueRow; more: number; total: number; onPay: () => void }) {
  const { account, charge, intent } = row;
  const amount = charge.outstanding_formatted ?? formatMinor(charge.outstanding_minor, charge.amount_currency);
  const late = charge.is_overdue;
  const days = daysUntil(charge.due_on);
  const eyebrow = intent
    ? "CONFIRMING YOUR PAYMENT"
    : late
      ? `OVERDUE · ${charge.days_overdue} ${charge.days_overdue === 1 ? "DAY" : "DAYS"} LATE`
      : days <= 0 ? "DUE TODAY" : `DUE IN ${days} ${days === 1 ? "DAY" : "DAYS"}`;
  const action = intent ? "Check status" : charge.kind === "rent" ? "Pay rent" : `Pay ${charge.kind_display.toLowerCase()}`;
  return (
    <View style={[styles.next, late ? styles.nextLate : null]} accessible={false}>
      <View style={styles.nextTop}>
        <View style={[styles.nextChip, late ? styles.nextChipLate : null]}>
          <Ionicons name={intent ? "hourglass-outline" : late ? "alert-circle" : "calendar-outline"} size={12} color={late ? LATERITE : WHITE} />
          <Type variant="label" style={[styles.nextChipText, late ? { color: LATERITE } : null]}>{eyebrow}</Type>
        </View>
      </View>
      <Type variant="display2" numberOfLines={1} style={styles.nextAmount}>{amount}</Type>
      <Type variant="caption" numberOfLines={2} style={styles.nextWhat}>
        {`${charge.kind_display}${charge.status === "part_paid" ? " · part paid" : ""} · ${placeOf(account.tenancy)}`}
      </Type>
      <Type variant="caption" style={styles.nextWhen}>{`Due ${dayMonth(charge.due_on)}`}</Type>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action}. ${charge.kind_display}, ${amount}, ${placeOf(account.tenancy)}.`}
        onPress={onPay}
        {...pressableFeedback(theme.color.kola["50"])}
        style={({ pressed }) => [styles.nextAct, pressed ? { backgroundColor: theme.color.kola["50"] } : null]}
      >
        <Ionicons name={intent ? "hourglass-outline" : "card-outline"} size={17} color={KOLA_DEEP} />
        <Type variant="bodyStrong" style={{ color: KOLA_DEEP }}>{action}</Type>
      </Pressable>
      {more ? (
        <Type variant="caption" style={styles.nextMore}>{`${more} more due · ${formatMinor(total).replace(/\.00$/, "")} in all`}</Type>
      ) : null}
    </View>
  );
}

/** Anything else owed: what, how much, which home, how it stands, and its step. */
function DueItem({ row, first, onPress }: { row: DueRow; first: boolean; onPress: () => void }) {
  const { account, charge, intent } = row;
  const look = dueLook(charge, intent);
  const action = intent ? "Check status" : charge.kind === "rent" ? "Pay rent" : `Pay ${charge.kind_display.toLowerCase()}`;
  const amount = charge.outstanding_formatted ?? formatMinor(charge.outstanding_minor, charge.amount_currency);
  const place = placeOf(account.tenancy);
  return (
    <Pressable
      accessibilityRole="link"
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
        <Type variant="captionStrong" style={[styles.line, { color: look.text }]}>{look.status}</Type>
        <Acts>
          <Act label={action} icon={intent ? "hourglass-outline" : "card-outline"} primary={!intent} onPress={onPress} />
        </Acts>
      </View>
    </Pressable>
  );
}

/** A payment the landlord recorded that the tenant is asked to confirm or dispute. */
function ConfirmItem({ account, payment, first, onPress }: { account: Account; payment: RentPayment; first: boolean; onPress: () => void }) {
  const amount = paidAmount(payment);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${payment.recorded_by_name} recorded ${amount}. ${[payment.method_display, payment.obligation_label, account.tenancy.property.title].filter(Boolean).join(", ")}. Review.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[rowStyles.well, { backgroundColor: theme.color.harmattan["100"] }]}>
        <Ionicons name="checkmark-done-outline" size={16} color={HARMATTAN} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{`${payment.recorded_by_name} recorded a payment`}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{amount}</Type>}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{[payment.method_display, payment.obligation_label, account.tenancy.property.title].filter(Boolean).join(" · ")}</Type>
        <Acts>
          <Act label="Confirm or dispute" icon="checkmark-done-outline" primary onPress={onPress} />
        </Acts>
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

/** Shaped like the next-due card and the first panel, so nothing jumps when they arrive. */
function PaymentsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your payments" style={styles.skeleton}>
      <Bone height={190} round={22} />
      <Bone width="24%" height={11} />
      <Panel style={styles.skeletonPanel}>
        <Bone height={44} />
        <Bone height={44} />
      </Panel>
    </View>
  );
}

function openAccount(router: ReturnType<typeof useRouter>, tenancy: Tenancy) {
  router.push({ pathname: "/(app)/rent-account", params: { leaseId: tenancy.lease?.id ?? "", propertyTitle: tenancy.property.title, unitLabel: tenancy.space.unit_label, bedLabel: tenancy.space.bed_label ?? "", tenancyId: tenancy.id, mode: "tenant" } } as never);
}
/** A space that a short label is held to, so "Bed A" never breaks across lines. */
const NBSP = String.fromCharCode(160);
/** The home, with a short label held to the word before it. */
function placeOf(tenancy: Tenancy) { return [tenancy.property.title, tenancyLabel(tenancy)].filter(Boolean).join(" · ").replace(/ (?=\S{1,2}(?:\s|$))/g, NBSP); }
function paidAmount(payment: RentPayment) { return payment.amount_formatted ?? formatMinor(payment.amount_minor, payment.amount_currency); }
function paymentStatus(payment: RentPayment) { return payment.evidence === "PSP_CONFIRMED" ? "Processor confirmed" : payment.awaiting_you ? "Review needed" : payment.status === "confirmed" ? "Confirmed by both" : payment.status === "disputed" ? "Disputed" : payment.recorded_by_tenant ? "Waiting for provider" : "Waiting for you"; }
function sentenceCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " "); }
function dayMonth(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", { day: "numeric", month: "short" }); }
/** Whole days from today until a calendar date; negative once it has passed. */
function daysUntil(value: string) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((new Date(`${value.slice(0, 10)}T00:00:00`).getTime() - start) / 86_400_000);
}
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
  foldBody: {
    marginTop: space[3],
  },
  // The next thing owed: the one dark surface on the page, laterite-edged once it is late.
  next: {
    gap: 4,
    padding: space[5],
    borderRadius: 22,
    backgroundColor: theme.color.kola["800"],
  },
  nextLate: {
    borderWidth: 2,
    borderColor: theme.color.laterite["600"],
  },
  nextTop: {
    flexDirection: "row",
    marginBottom: space[2],
  },
  nextChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: alpha(WHITE, 0.14),
  },
  nextChipLate: {
    backgroundColor: theme.color.laterite["100"],
  },
  nextChipText: {
    color: WHITE,
    letterSpacing: 0.5,
  },
  nextAmount: {
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.6,
    color: WHITE,
    fontVariant: ["tabular-nums"],
  },
  nextWhat: {
    fontSize: 14,
    lineHeight: 19,
    color: alpha(WHITE, 0.82),
  },
  nextWhen: {
    fontSize: 13,
    lineHeight: 18,
    color: alpha(WHITE, 0.66),
  },
  nextAct: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    marginTop: space[4],
    borderRadius: radius.pill,
    backgroundColor: WHITE,
  },
  nextMore: {
    marginTop: space[2],
    textAlign: "center",
    fontSize: 12.5,
    lineHeight: 17,
    color: alpha(WHITE, 0.72),
  },
  line: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 17,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
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
  skeleton: {
    gap: space[4],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
});
