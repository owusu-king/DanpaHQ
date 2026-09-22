import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Linking, StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  ActionBar,
  EDGE,
  Fact,
  Footnote,
  GroupLabel,
  INK,
  Lead,
  LinkRow,
  MUTED,
  Pill,
  Quote,
  QuietAct,
  RecordPanel,
  StandingLine,
  TONE,
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Field, Notice, Type, space } from "@/components/ui";
import {
  adjustRentCharge,
  getLeaseLedger,
  getPaymentEvidenceDownload,
  rentPaymentAction,
  type LeaseLedger,
  type RentCharge,
  type RentPayment,
} from "@/leases";
import { formatMinor } from "@/listings";
import { useSafeBottom } from "@/platform";

/** How many payments the page shows before the rest open in the sheet. */
const HISTORY_SHOWN = 3;

type Sheet =
  | { kind: "review"; payment: RentPayment }
  | { kind: "payment"; payment: RentPayment }
  | { kind: "payments" }
  | { kind: "adjust"; charge: RentCharge; how: "waive" | "write-off" };

/**
 * One rent account, read by whichever party opened it.
 *
 * The money is the page: what is outstanding, what of it is late, what is
 * waiting on this reader, and what has already been paid. Everything else —
 * a receipt, a piece of evidence, the reason something was written off — is
 * one tap from the row it belongs to.
 *
 * Refined on review (2026-09-21) onto the record surfaces. It was a column of
 * bordered sections in which every charge carried up to four stacked buttons
 * and every payment two more; the adjustments and the confirm/dispute decision
 * now open on the row they concern, so the account stays readable as an account.
 */
export default function RentAccountScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ leaseId?: string; tenantName?: string; propertyTitle?: string; unitLabel?: string; bedLabel?: string; tenancyId?: string; canRecord?: string; mode?: string }>();
  const leaseId = params.leaseId ?? "";
  const tenantMode = params.mode === "tenant";
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const pageBottom = useSafeBottom(space[8]);

  const load = useCallback(async () => {
    if (!leaseId) { setError("This rent account could not be found."); return; }
    try {
      setLedger(await getLeaseLedger(leaseId));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load this rent account.");
    }
  }, [leaseId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const outstanding = useMemo(
    () => ledger
      ? (ledger.financial_summary.is_post_tenancy
        ? ledger.financial_summary.outstanding_balance_minor
        : ledger.charges.reduce((total, charge) => total + charge.outstanding_minor, 0))
      : 0,
    [ledger],
  );
  const overdue = useMemo(
    () => ledger?.charges.filter((charge) => charge.is_overdue).reduce((total, charge) => total + charge.outstanding_minor, 0) ?? 0,
    [ledger],
  );

  /** A sheet row must put the sheet away before anything replaces the page. */
  const done = useCallback(async () => { setSheet(null); await load(); }, [load]);

  if (!ledger) {
    return (
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} /> : <LedgerSkeleton />}
      </View>
    );
  }

  const summary = ledger.financial_summary;
  const currency = summary.currency || "GHS";
  const awaiting = ledger.payments.filter((payment) => payment.awaiting_you);
  const canWaive = ledger.financial_summary.is_post_tenancy && ledger.permissions.waive;
  const canWriteOff = ledger.financial_summary.is_post_tenancy && ledger.permissions.write_off;
  const canRecord = ledger.permissions.record_payment;
  const who = tenantMode
    ? (params.propertyTitle || ledger.context.property_title)
    : (params.tenantName || ledger.context.tenant_name);
  const where = [
    tenantMode ? null : params.propertyTitle || ledger.context.property_title,
    params.unitLabel || ledger.context.unit_label,
    params.bedLabel || null,
  ].filter(Boolean).join(" · ");
  const tone: RecordTone = overdue > 0 ? "alert" : outstanding > 0 ? "waiting" : "good";
  const history = ledger.payments;
  const shown = history.slice(0, HISTORY_SHOWN);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: canRecord ? space[6] : pageBottom }]}>
        <View style={styles.identity}>
          <Type variant="title2" accessibilityRole="header" numberOfLines={2} style={styles.who}>{who}</Type>
          <Type variant="caption" numberOfLines={2} style={styles.where}>{where}</Type>
          {summary.is_post_tenancy ? (
            <StandingLine
              tone="quiet"
              line={summary.tenancy_ended_on ? `Tenancy ended ${formatDate(summary.tenancy_ended_on)}` : "Tenancy ended"}
            />
          ) : null}
        </View>

        {error ? <Notice tone="error" title={error} /> : null}

        <RecordPanel>
          <Lead
            label="Outstanding"
            value={formatMinor(outstanding, currency)}
            note={overdue > 0 ? `${formatMinor(overdue, currency)} of it is overdue` : outstanding > 0 ? "Nothing overdue" : "Nothing owed"}
            tone={tone}
          />
          {summary.credit_balance_minor > 0 ? (
            <>
              <View style={styles.rule} />
              <Fact first label="Credit owed to tenant" value={formatMinor(summary.credit_balance_minor, currency)} tone="good" />
            </>
          ) : null}
        </RecordPanel>

        {/* What is waiting on whoever opened this, before anything they merely
            want to look at. */}
        {awaiting.length ? (
          <View style={styles.section}>
            <GroupLabel>Needs your review</GroupLabel>
            <RecordPanel>
              {awaiting.map((payment, index) => (
                <LinkRow
                  key={payment.id}
                  first={index === 0}
                  icon="help-circle-outline"
                  tone="alert"
                  // The amount alone on the strong line: it is what the answer
                  // turns on, and on a 320pt handset anything joined to it is
                  // cut off. Who claims it leads the detail, which may wrap.
                  label={amountOf(payment)}
                  detail={`${payment.recorded_by_name} · ${payment.obligation_label} · ${payment.method_display} · ${formatDate(payment.paid_on)}`}
                  onPress={() => setSheet({ kind: "review", payment })}
                />
              ))}
            </RecordPanel>
            <Footnote>
              Confirm only after checking that the money arrived. A claim does not change the balance
              until both sides agree.
            </Footnote>
          </View>
        ) : null}

        {summary.is_post_tenancy ? <ClosingSummary summary={summary} /> : null}

        <View style={styles.section}>
          <GroupLabel>What is due</GroupLabel>
          {ledger.charges.length ? (
            <RecordPanel>
              {ledger.charges.map((charge, index) => (
                <ChargeRow
                  key={charge.id}
                  charge={charge}
                  first={index === 0}
                  currency={currency}
                  pay={tenantMode && charge.outstanding_minor > 0
                    ? () => router.push({ pathname: "/(app)/payment-checkout", params: { leaseId, obligationId: charge.id } } as never)
                    : undefined}
                  waive={canWaive && charge.outstanding_minor > 0 ? () => setSheet({ kind: "adjust", charge, how: "waive" }) : undefined}
                  writeOff={canWriteOff && charge.outstanding_minor > 0 ? () => setSheet({ kind: "adjust", charge, how: "write-off" }) : undefined}
                />
              ))}
            </RecordPanel>
          ) : (
            <RecordPanel>
              <Fact wide first label="Nothing scheduled" value="Charges appear here as they are raised against this agreement." />
            </RecordPanel>
          )}
          {tenantMode && !ledger.digital_payment.available ? (
            <Footnote>
              {ledger.digital_payment.reason || "Paying in the app is not available on this account yet."}
            </Footnote>
          ) : null}
          {!tenantMode && !ledger.permissions.record_payment ? (
            <Footnote>
              Recording money received needs current identity and approved Property authority.
              Paystack setup is not required.
            </Footnote>
          ) : null}
        </View>

        <View style={styles.section}>
          <GroupLabel>Payments</GroupLabel>
          {history.length ? (
            <RecordPanel>
              {shown.map((payment, index) => (
                <PaymentRow
                  key={payment.id}
                  payment={payment}
                  first={index === 0}
                  onPress={() => setSheet({ kind: "payment", payment })}
                />
              ))}
              {history.length > HISTORY_SHOWN ? (
                <LinkRow
                  icon="time-outline"
                  label={`View all ${history.length} payments`}
                  onPress={() => setSheet({ kind: "payments" })}
                />
              ) : null}
            </RecordPanel>
          ) : (
            <RecordPanel>
              <Fact wide first label="No payments yet" value="Every payment, however it was made, is recorded here." />
            </RecordPanel>
          )}
        </View>
      </ScrollView>

      {canRecord ? (
        <ActionBar>
          <Pill
            grow
            icon="receipt-outline"
            label="Record a payment"
            onPress={() => router.push({ pathname: "/(app)/provider-payment-record", params: { leaseId } } as never)}
          />
        </ActionBar>
      ) : null}

      <BottomSheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheetTitle(sheet)}
        closeLabel="Close"
      >
        {sheet?.kind === "review" ? (
          <ReviewPayment payment={sheet.payment} onDone={done} />
        ) : sheet?.kind === "adjust" ? (
          <AdjustCharge charge={sheet.charge} how={sheet.how} currency={currency} onDone={done} />
        ) : sheet?.kind === "payment" ? (
          <PaymentDetail payment={sheet.payment} onReceipt={(receiptId) => { setSheet(null); router.push({ pathname: "/(app)/payment-receipt", params: { receiptId } } as never); }} />
        ) : sheet?.kind === "payments" ? (
          <View style={styles.sheetBody}>
            <RecordPanel>
              {history.map((payment, index) => (
                <PaymentRow
                  key={payment.id}
                  payment={payment}
                  first={index === 0}
                  onPress={() => setSheet({ kind: "payment", payment })}
                />
              ))}
            </RecordPanel>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function sheetTitle(sheet: Sheet | null) {
  if (sheet?.kind === "review") return "Is this right?";
  if (sheet?.kind === "adjust") return sheet.how === "waive" ? "Waive this amount?" : "Write this amount off?";
  if (sheet?.kind === "payments") return "Payments";
  if (sheet?.kind === "payment") return "Payment";
  return "";
}

/** One charge: what it is, when it was due, and what is left on it. */
function ChargeRow({
  charge,
  first,
  currency,
  pay,
  waive,
  writeOff,
}: {
  charge: RentCharge;
  first: boolean;
  currency: string;
  pay?: () => void;
  waive?: () => void;
  writeOff?: () => void;
}) {
  const tone: RecordTone = charge.is_overdue ? "alert" : charge.outstanding_minor > 0 ? "waiting" : "good";
  const acts = [pay, waive, writeOff].filter(Boolean).length;
  return (
    <View style={[styles.charge, first ? null : styles.ruled]}>
      <View style={styles.chargeLine}>
        <View style={styles.chargeBody}>
          <Type variant="bodyStrong" numberOfLines={1} style={styles.chargeTitle}>{charge.kind_display}</Type>
          <Type variant="caption" numberOfLines={2} style={[styles.chargeMeta, { color: TONE[tone].ink }]}>
            {charge.is_overdue ? `${charge.days_overdue} days overdue` : `Due ${formatDate(charge.due_on)}`}
            {charge.status_display ? ` · ${charge.status_display}` : ""}
          </Type>
        </View>
        <Type variant="bodyStrong" numberOfLines={1} style={styles.chargeAmount}>
          {charge.outstanding_formatted ?? formatMinor(charge.outstanding_minor, currency)}
        </Type>
      </View>
      {acts ? (
        <View style={styles.chargeActs}>
          {pay ? <Pill label="Pay" icon="card-outline" onPress={pay} /> : null}
          {waive ? <QuietAct label="Waive" onPress={waive} /> : null}
          {writeOff ? <QuietAct label="Write off" onPress={writeOff} /> : null}
        </View>
      ) : null}
      {charge.adjustments.length ? (
        <View style={styles.adjustments}>
          {charge.adjustments.map((adjustment) => (
            <Type key={adjustment.id} variant="caption" style={styles.adjustment}>
              {`${adjustment.kind_display} · ${adjustment.amount_formatted} · ${formatDate(adjustment.effective_at)}`}
            </Type>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One payment: how much, how, when, and where it stands. */
function PaymentRow({ payment, first, onPress }: { payment: RentPayment; first: boolean; onPress: () => void }) {
  const tone: RecordTone = payment.awaiting_you ? "alert" : payment.status === "disputed" ? "alert" : payment.status === "confirmed" ? "good" : "waiting";
  return (
    <LinkRow
      first={first}
      icon={payment.source === "EXTERNAL" ? "cash-outline" : "card-outline"}
      tone={tone}
      // The standing is already in the row's colour and its icon, so it leads
      // the detail rather than competing with the amount for one narrow line.
      label={amountOf(payment)}
      detail={`${paymentStatus(payment)} · ${payment.method_display} · ${formatDate(payment.paid_on)}`}
      onPress={onPress}
    />
  );
}

/** A payment, opened: what it was against, how it was evidenced, and its receipt. */
function PaymentDetail({ payment, onReceipt }: { payment: RentPayment; onReceipt: (receiptId: string) => void }) {
  const [error, setError] = useState("");
  return (
    <View style={styles.sheetBody}>
      <RecordPanel>
        <Fact first label="Amount" value={amountOf(payment)} />
        <Fact label="Method" value={payment.method_display} />
        <Fact label="Paid on" value={formatDate(payment.paid_on)} />
        <Fact label="Against" value={payment.obligation_label} />
        <Fact label="Standing" value={paymentStatus(payment)} />
        {payment.reference ? <Fact label="Reference" value={payment.reference} /> : null}
      </RecordPanel>
      <Footnote>
        {payment.source === "EXTERNAL"
          ? "Paid externally · recorded through Rooomly"
          : "Processed through Rooomly"}
      </Footnote>
      {payment.dispute_reason ? <Quote>{payment.dispute_reason}</Quote> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      <View style={styles.sheetActs}>
        {payment.evidence_file ? (
          <QuietAct
            icon="image-outline"
            label="View evidence"
            onPress={async () => {
              try {
                const download = await getPaymentEvidenceDownload(payment.evidence_file!.id);
                await Linking.openURL(download.url);
              } catch {
                setError("That evidence could not be opened.");
              }
            }}
          />
        ) : null}
        {payment.receipt_id ? (
          <QuietAct icon="document-outline" label="View receipt" onPress={() => onReceipt(payment.receipt_id!)} />
        ) : null}
      </View>
    </View>
  );
}

/**
 * Confirming or contesting a payment somebody else recorded.
 *
 * A claim does not move the balance until both sides agree, so neither answer
 * is drawn as the expected one.
 */
function ReviewPayment({ payment, onDone }: { payment: RentPayment; onDone: () => Promise<void> }) {
  const [step, setStep] = useState<"choose" | "confirm" | "dispute">("choose");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "confirm" | "dispute") {
    setBusy(true);
    setError("");
    try {
      await rentPaymentAction(payment.id, action, reason.trim());
      await onDone();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.sheetBody}>
      <RecordPanel>
        <Fact first label="Recorded by" value={payment.recorded_by_name} />
        <Fact label="Amount" value={amountOf(payment)} />
        <Fact label="Method" value={payment.method_display} />
        <Fact label="Against" value={payment.obligation_label} />
        <Fact label="Paid on" value={formatDate(payment.paid_on)} />
      </RecordPanel>

      {error ? <Notice tone="error" title={error} /> : null}

      {step === "choose" ? (
        <View style={styles.sheetActs}>
          <Pill
            grow
            tone="quiet"
            label={payment.recorded_by_tenant ? "Confirm received" : "Confirm payment"}
            onPress={() => setStep("confirm")}
          />
          <Pill
            grow
            tone="quiet"
            label={payment.recorded_by_tenant ? "Dispute" : "I didn’t make this payment"}
            onPress={() => setStep("dispute")}
          />
        </View>
      ) : step === "confirm" ? (
        <>
          <Type variant="caption" style={styles.note}>
            This applies the payment to {payment.obligation_label}. Rooomly did not process the
            transfer — it is recording that you agree the money arrived.
          </Type>
          <Pill
            grow
            label={payment.recorded_by_tenant ? "Yes, confirm received" : "Yes, confirm payment"}
            busy={busy}
            busyLabel="Confirming…"
            onPress={() => void act("confirm")}
          />
          <QuietAct label="Go back" disabled={busy} onPress={() => setStep("choose")} />
        </>
      ) : (
        <>
          <Type variant="caption" style={styles.note}>
            The record stays in history as disputed, and will not settle the balance. Say what is
            wrong with it.
          </Type>
          <Field label="Reason" value={reason} onChangeText={setReason} maxLength={300} multiline />
          <Pill
            grow
            tone="danger"
            label="Submit dispute"
            busy={busy}
            disabled={!reason.trim()}
            busyLabel="Sending…"
            onPress={() => void act("dispute")}
          />
          <QuietAct label="Go back" disabled={busy} onPress={() => setStep("choose")} />
        </>
      )}
    </View>
  );
}

/** Forgiving a debt, or giving up on collecting it — never the same thing. */
function AdjustCharge({
  charge,
  how,
  currency,
  onDone,
}: {
  charge: RentCharge;
  how: "waive" | "write-off";
  currency: string;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(charge.outstanding_minor / 100));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <View style={styles.sheetBody}>
      <Type variant="caption" style={styles.note}>
        {how === "waive"
          ? "The tenant is released from this amount. It stays recorded as waived, never as paid."
          : "Collection is no longer expected. The debt stays in history and will never appear as paid."}
      </Type>
      <RecordPanel>
        <Fact first label={charge.kind_display} value={charge.outstanding_formatted ?? formatMinor(charge.outstanding_minor, currency)} />
      </RecordPanel>
      <Field label="Amount (GH₵)" value={amount} onChangeText={(value) => setAmount(value.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" />
      <Field label={how === "waive" ? "Reason for waiver" : "Reason for write-off"} value={reason} onChangeText={setReason} maxLength={300} multiline />
      {error ? <Notice tone="error" title={error} /> : null}
      <Pill
        grow
        tone="danger"
        label={how === "waive" ? "Confirm waiver" : "Confirm write-off"}
        busy={busy}
        disabled={!reason.trim()}
        busyLabel="Recording…"
        onPress={async () => {
          const amountMinor = Math.round(Number(amount) * 100);
          if (!Number.isFinite(amountMinor) || amountMinor <= 0 || amountMinor > charge.outstanding_minor) {
            setError("Enter an amount no greater than the outstanding balance.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await adjustRentCharge(charge.id, how, amountMinor, reason.trim());
            await onDone();
          } catch (cause) {
            setError(cause instanceof ApiFailure ? cause.error.message : "Could not record this adjustment.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

/** What a closed tenancy still owes, or is still owed. */
function ClosingSummary({ summary }: { summary: LeaseLedger["financial_summary"] }) {
  const rows = [
    ["Unpaid rent", summary.unpaid_rent_minor],
    ["Other charges", summary.other_charges_minor],
    ["Credits", -summary.credits_minor],
    ["Waived", -summary.waived_minor],
    ["Written off", -summary.written_off_minor],
  ] as const;
  const kept = rows.filter(([, value]) => value !== 0);
  return (
    <View style={styles.section}>
      <GroupLabel>Closing financial summary</GroupLabel>
      <RecordPanel>
        {kept.map(([label, value], index) => (
          <Fact key={label} first={index === 0} label={label} value={formatMinor(value, summary.currency)} />
        ))}
        <Fact
          first={kept.length === 0}
          label="Outstanding balance"
          value={formatMinor(summary.outstanding_balance_minor, summary.currency)}
          tone={summary.outstanding_balance_minor > 0 ? "alert" : "good"}
        />
      </RecordPanel>
      <Footnote>
        Historical obligations and credits stay open until they are resolved, however the tenancy ended.
      </Footnote>
    </View>
  );
}

/** Shaped like the account it becomes, so nothing jumps when the ledger arrives. */
function LedgerSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this rent account" style={{ gap: space[4] }}>
      <Bone width="52%" height={20} />
      <Bone width="38%" />
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="34%" height={12} />
        <Bone width="56%" height={30} />
        <Bone width="44%" />
      </RecordPanel>
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="40%" height={12} />
        <Bone height={44} />
      </RecordPanel>
    </View>
  );
}

/** The amount as the server formatted it, or formatted here when it did not. */
function amountOf(row: RentPayment) {
  return row.amount_formatted ?? formatMinor(row.amount_minor, row.amount_currency);
}

function paymentStatus(payment: RentPayment) {
  return payment.evidence === "PSP_CONFIRMED"
    ? "Processor confirmed"
    : payment.awaiting_you
      ? "Review needed"
      : payment.status === "confirmed"
        ? "Confirmed by both"
        : payment.status === "disputed"
          ? "Disputed"
          : payment.recorded_by_tenant
            ? "Waiting for provider"
            : "Waiting for tenant";
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    gap: space[4],
  },
  identity: {
    gap: space[2],
    paddingHorizontal: 2,
  },
  who: {
    fontSize: 19,
    lineHeight: 25,
  },
  where: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  section: {
    gap: space[2],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[4],
    backgroundColor: EDGE,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  charge: {
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  chargeLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[3],
  },
  chargeBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  chargeTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  chargeMeta: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  chargeAmount: {
    flexShrink: 0,
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  chargeActs: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[3],
  },
  adjustments: {
    gap: 2,
    paddingLeft: space[3],
    borderLeftWidth: 2,
    borderLeftColor: EDGE,
  },
  adjustment: {
    fontSize: 12,
    lineHeight: 17,
    color: MUTED,
  },
  sheetBody: {
    gap: space[3],
  },
  sheetActs: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[3],
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
});
