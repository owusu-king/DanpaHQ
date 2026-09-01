import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { getLeaseLedger, recordRentPayment, type LeaseLedger, type RentPayment } from "@/leases";
import { uploadImage } from "@/provider";

const METHODS: [RentPayment["method"], string][] = [
  ["cash", "Cash"],
  ["momo", "Direct mobile money"],
  ["bank", "Direct bank transfer"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];

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
  const [evidence, setEvidence] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  async function save() {
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter a valid amount.");
    setBusy(true);
    setError("");
    try {
      const stored = evidence ? await uploadImage(evidence, "payment_evidence") : null;
      if (stored && !stored.is_usable) throw new Error(stored.status_message || "Evidence is still being checked.");
      await recordRentPayment({ lease_id: leaseId, charge_id: chargeId || null, amount_minor: amountMinor, paid_on: paidOn, method, reference, note, evidence_file_id: stored?.id ?? null });
      router.back();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }} keyboardShouldPersistTaps="handled">
    <View style={{ gap: space[1] }}><Type variant="label">PAYMENT RECEIVED ELSEWHERE</Type><Type variant="display2" accessibilityRole="header">Record external payment</Type><Type variant="body">Create a record the tenant can review and confirm.</Type></View>
    <Notice tone="info" title="This does not collect money" body="Use this only after money reached you outside Rooomly. The tenant must confirm it before the rent balance changes." />
    {error ? <Notice tone="error" title={error} /> : null}
    {!ledger && !error ? <Type variant="caption">Loading rent items…</Type> : null}
    {ledger ? <>
      <View style={{ gap: space[3] }}><Type variant="label">APPLY TO</Type>{openCharges.length ? openCharges.map((charge) => <Button key={charge.id} label={`${charge.kind_display} · ${charge.outstanding_formatted}`} variant="secondary" selected={chargeId === charge.id} onPress={() => { setChargeId(charge.id); setAmount(String(charge.outstanding_minor / 100)); }} />) : <Notice tone="info" title="Nothing outstanding" body="There is no rent item available for this record." />}</View>
      <Field label="Amount (GH₵)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Date received (YYYY-MM-DD)" value={paidOn} onChangeText={setPaidOn} />
      <View style={{ gap: space[3] }}><Type variant="label">METHOD</Type><View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{METHODS.map(([value, label]) => <Button key={value} label={label} variant="quiet" selected={method === value} onPress={() => setMethod(value)} />)}</View></View>
      <Field label="Reference (optional)" value={reference} onChangeText={setReference} maxLength={120} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={300} multiline />
      <View style={{ gap: space[2] }}><Button label={evidence ? "Evidence photo selected" : "Add evidence photo (optional)"} variant="secondary" onPress={async () => { const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!permission.granted) return setError("Allow photo access to attach payment evidence."); const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: .9 }); if (!result.canceled && result.assets[0]) setEvidence(result.assets[0]); }} />{evidence ? <Button label="Remove evidence" variant="quiet" onPress={() => setEvidence(null)} /> : null}<Type variant="caption">A screenshot or photo is private and visible only to the payment parties and authorized support.</Type></View>
      <Button label="Send for tenant confirmation" busy={busy} disabled={!openCharges.length || !chargeId || !amount || !paidOn} onPress={() => void save()} />
    </> : null}
  </ScrollView>;
}
