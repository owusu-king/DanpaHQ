import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  ActionBar,
  EDGE,
  Fact,
  Footnote,
  GroupLabel,
  INK,
  KOLA,
  KOLA_DEEP,
  MUTED,
  Pill,
  QuietAct,
  RecordPanel,
  TONE,
} from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { getLeaseLedger, recordRentPayment, type LeaseLedger, type RentPayment } from "@/leases";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { uploadImage } from "@/provider";
import { theme } from "@/theme";

const METHODS: [RentPayment["method"], string][] = [
  ["momo", "Direct mobile money"],
  ["bank", "Direct bank transfer"],
  ["cash", "Cash"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];

/**
 * Recording money that arrived outside Rooomly.
 *
 * Not a collection screen and not a receipt: it creates a claim the tenant must
 * confirm before the balance moves. That is the whole reason it says so twice —
 * once before anything is filled in, and once on the act itself.
 *
 * Refined on review (2026-09-21): the charge being paid is chosen from rows
 * rather than a stack of buttons, the method is a set of chips, and the two
 * optional fields wait behind a disclosure so the form is four decisions long
 * instead of eight.
 */
export default function ProviderPaymentRecordScreen() {
  const router = useRouter();
  const { leaseId = "" } = useLocalSearchParams<{ leaseId?: string }>();
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [chargeId, setChargeId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<RentPayment["method"]>("momo");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState(false);
  const [evidence, setEvidence] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pageBottom = useSafeBottom(space[8]);

  const load = useCallback(async () => {
    if (!leaseId) return setError("This rent account could not be found.");
    try {
      const next = await getLeaseLedger(leaseId);
      setLedger(next);
      const first = next.charges.find((charge) => charge.outstanding_minor > 0);
      setChargeId((current) => current || first?.id || "");
      setAmount((current) => current || (first ? String(first.outstanding_minor / 100) : ""));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not prepare this payment record.");
    }
  }, [leaseId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openCharges = useMemo(() => ledger?.charges.filter((charge) => charge.outstanding_minor > 0) ?? [], [ledger]);
  const ready = Boolean(openCharges.length && chargeId && amount && paidOn);

  async function save() {
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter a valid amount.");
    setBusy(true);
    setError("");
    try {
      const stored = evidence ? await uploadImage(evidence, "payment_evidence") : null;
      if (stored && !stored.is_usable) throw new Error(stored.status_message || "Evidence is still being checked.");
      await recordRentPayment({
        lease_id: leaseId,
        charge_id: chargeId || null,
        amount_minor: amountMinor,
        paid_on: paidOn,
        method,
        reference,
        note,
        evidence_file_id: stored?.id ?? null,
      });
      router.back();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (!ledger) {
    return (
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} /> : <FormSkeleton />}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: ready ? space[6] : pageBottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.identity}>
          <Type variant="title2" accessibilityRole="header" style={styles.title}>Record external payment</Type>
          <Type variant="caption" numberOfLines={2} style={styles.sub}>
            {`${ledger.context.tenant_name} · ${ledger.context.property_title}${ledger.context.unit_label ? ` · ${ledger.context.unit_label}` : ""}`}
          </Type>
        </View>

        <View style={styles.caution}>
          <Ionicons name="alert-circle-outline" size={17} color={TONE.waiting.ink} />
          <Type variant="caption" style={styles.cautionText}>
            This does not collect money. Use it only after money reached you outside Rooomly — the
            tenant must confirm it before the rent balance changes.
          </Type>
        </View>

        {error ? <Notice tone="error" title={error} /> : null}

        <View style={styles.section}>
          <GroupLabel>Apply it to</GroupLabel>
          {openCharges.length ? (
            <RecordPanel>
              {openCharges.map((charge, index) => (
                <PickRow
                  key={charge.id}
                  first={index === 0}
                  label={charge.kind_display}
                  detail={charge.is_overdue ? `${charge.days_overdue} days overdue` : `Due ${shortDate(charge.due_on)}`}
                  amount={charge.outstanding_formatted ?? ""}
                  selected={chargeId === charge.id}
                  onPress={() => {
                    setChargeId(charge.id);
                    setAmount(String(charge.outstanding_minor / 100));
                  }}
                />
              ))}
            </RecordPanel>
          ) : (
            <RecordPanel>
              <Fact wide first label="Nothing outstanding" value="There is no rent item on this account for a payment to settle." />
            </RecordPanel>
          )}
        </View>

        <View style={styles.section}>
          <GroupLabel>How much, and when</GroupLabel>
          <RecordPanel style={styles.formPanel}>
            <View style={styles.pair}>
              <View style={styles.pairField}>
                <Field label="Amount (GH₵)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
              </View>
              <View style={styles.pairField}>
                <Field label="Date received" hint="YYYY-MM-DD" value={paidOn} onChangeText={setPaidOn} />
              </View>
            </View>
          </RecordPanel>
        </View>

        <View style={styles.section}>
          <GroupLabel>How it arrived</GroupLabel>
          <View style={styles.chips}>
            {METHODS.map(([value, label]) => (
              <Chip key={value} label={label} selected={method === value} onPress={() => setMethod(value)} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <GroupLabel>Evidence</GroupLabel>
          <RecordPanel style={styles.formPanel}>
            <View style={styles.sheetActs}>
              <QuietAct
                icon={evidence ? "checkmark-circle-outline" : "camera-outline"}
                label={evidence ? "Photo attached" : "Attach a photo"}
                onPress={async () => {
                  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
                  if (!permission.granted) return setError("Allow photo access to attach payment evidence.");
                  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: .9 });
                  if (!result.canceled && result.assets[0]) setEvidence(result.assets[0]);
                }}
              />
              {evidence ? <QuietAct icon="close-outline" label="Remove" onPress={() => setEvidence(null)} /> : null}
            </View>
            <Footnote>A screenshot or photo stays private to the two parties and authorized support.</Footnote>
          </RecordPanel>
        </View>

        <RecordPanel>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a reference or note"
            aria-expanded={extras}
            onPress={() => setExtras((value) => !value)}
            {...pressableFeedback(theme.color.field["100"])}
            style={({ pressed }) => [styles.disclosure, pressed ? { backgroundColor: theme.color.field["100"] } : null]}
          >
            <Type variant="bodyStrong" style={styles.disclosureLabel}>Add a reference or note</Type>
            <Ionicons name={extras ? "chevron-up" : "chevron-down"} size={16} color={KOLA_DEEP} />
          </Pressable>
          {extras ? (
            <View style={styles.extras}>
              <Field label="Reference (optional)" value={reference} onChangeText={setReference} maxLength={120} />
              <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} multiline />
            </View>
          ) : null}
        </RecordPanel>
      </ScrollView>

      {ready ? (
        <ActionBar note="The tenant sees this and confirms or disputes it. Nothing moves until they do.">
          <Pill
            grow
            icon="send-outline"
            label="Send for tenant confirmation"
            busy={busy}
            busyLabel="Sending…"
            onPress={() => void save()}
          />
        </ActionBar>
      ) : null}
    </View>
  );
}

/** A charge this payment could settle, chosen rather than pressed. */
function PickRow({
  first,
  label,
  detail,
  amount,
  selected,
  onPress,
}: {
  first: boolean;
  label: string;
  detail: string;
  amount: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-selected={selected}
      accessibilityLabel={`${label}, ${amount}, ${detail}`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["100"])}
      style={({ pressed }) => [
        styles.pick,
        first ? null : styles.ruled,
        selected ? styles.pickOn : null,
        pressed ? { backgroundColor: theme.color.field["100"] } : null,
      ]}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={18}
        color={selected ? KOLA : theme.color.ink["300"]}
      />
      <View style={styles.pickBody}>
        <Type variant="bodyStrong" numberOfLines={1} style={styles.pickLabel}>{label}</Type>
        <Type variant="caption" numberOfLines={1} style={styles.pickDetail}>{detail}</Type>
      </View>
      <Type variant="bodyStrong" numberOfLines={1} style={styles.pickAmount}>{amount}</Type>
    </Pressable>
  );
}

/** One way money arrived. */
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-selected={selected}
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.chip, selected ? styles.chipOn : null, pressed ? { opacity: 0.85 } : null]}
    >
      <Type variant="captionStrong" style={[styles.chipText, selected ? { color: KOLA_DEEP } : null]}>{label}</Type>
    </Pressable>
  );
}

/** Shaped like the form it becomes, so nothing jumps when the account arrives. */
function FormSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading rent items" style={{ gap: space[4] }}>
      <Bone width="62%" height={20} />
      <Bone width="44%" />
      <RecordPanel style={styles.formPanel}>
        <Bone width="40%" height={12} />
        <Bone height={44} />
        <Bone height={44} />
      </RecordPanel>
    </View>
  );
}

function shortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
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
    gap: 2,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 19,
    lineHeight: 25,
  },
  sub: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  caution: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[3],
    borderRadius: 12,
    backgroundColor: TONE.waiting.wash,
  },
  cautionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: theme.color.ink["700"],
  },
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  pick: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  pickOn: {
    backgroundColor: theme.color.kola["50"],
  },
  pickBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pickLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  pickDetail: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  pickAmount: {
    flexShrink: 0,
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  formPanel: {
    gap: space[3],
    padding: space[4],
  },
  pair: {
    flexDirection: "row",
    gap: space[3],
  },
  pairField: {
    flex: 1,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  chipOn: {
    borderWidth: 2,
    borderColor: KOLA,
    backgroundColor: theme.color.kola["50"],
  },
  chipText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: INK,
  },
  sheetActs: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[4],
  },
  disclosure: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: 14,
  },
  disclosureLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: KOLA_DEEP,
  },
  extras: {
    gap: space[3],
    padding: space[4],
    paddingTop: 0,
  },
});
