import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { PaystackCheckoutModal } from "@/components/payments/PaystackCheckoutModal";
import { getLeaseLedger, type LeaseLedger } from "@/leases";
import {
  createPaymentIntent,
  listPaymentIntents,
  paymentMethodLabel,
  safeCheckoutUrl,
  type DigitalPaymentMethod,
  type PaymentIntent,
} from "@/payments";
import { theme } from "@/theme";

export default function PaymentCheckoutScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const router = useRouter();
  const params = useLocalSearchParams<{ leaseId?: string; obligationId?: string }>();
  const leaseId = params.leaseId ?? "";
  const obligationId = params.obligationId ?? "";
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [existing, setExisting] = useState<PaymentIntent | null>(null);
  const [method, setMethod] = useState<DigitalPaymentMethod>("mobile_money");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutIntent, setCheckoutIntent] = useState<PaymentIntent | null>(null);

  const load = useCallback(async () => {
    if (!leaseId || !obligationId) {
      setError("This payment link is incomplete.");
      setLoading(false);
      return;
    }
    try {
      const [nextLedger, intents] = await Promise.all([getLeaseLedger(leaseId), listPaymentIntents()]);
      setLedger(nextLedger);
      setExisting(intents.find((row) => row.obligation_id === obligationId && ["created", "pending", "processing"].includes(row.status)) ?? null);
      setMethod(nextLedger.digital_payment.methods[0] ?? "mobile_money");
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not prepare checkout.");
    } finally {
      setLoading(false);
    }
  }, [leaseId, obligationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const charge = useMemo(() => ledger?.charges.find((row) => row.id === obligationId) ?? null, [ledger, obligationId]);

  function openStatus(intent: PaymentIntent) {
    router.replace({
      pathname: "/(app)/payment-status",
      params: { intentId: intent.id },
    } as never);
  }

  function openCheckout(intent: PaymentIntent) {
    if (safeCheckoutUrl(intent)) {
      setCheckoutIntent(intent);
      return;
    }
    openStatus(intent);
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      openCheckout(await createPaymentIntent(obligationId, method));
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Checkout could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[5] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="label">SECURE PAYMENT</Type>
        <Type variant="display2" accessibilityRole="header">Review payment</Type>
        <Type variant="body">Confirm the obligation and choose how to pay.</Type>
      </View>
      {loading ? <Type variant="caption">Preparing checkout…</Type> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {!loading && charge && ledger ? (
        <>
          <View style={{ paddingVertical: space[5], borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.field["200"], flexDirection: "row", gap: space[4], alignItems: "center" }}>
            <View style={{ flex: 1, gap: space[1] }}>
              <Type variant="caption">You are paying</Type>
              <Type variant="bodyStrong">{charge.kind_display}</Type>
              <Type variant="caption">Due {formatDate(charge.due_on)}</Type>
            </View>
            <Type variant="title1">{charge.outstanding_formatted}</Type>
          </View>

          {existing ? (
            <Notice tone="info" title="A payment is already in progress" body="Continue it so the same rent obligation is never charged twice." />
          ) : ledger.digital_payment.available ? (
            <View style={{ gap: space[3] }}>
              <Type variant="title2">Payment method</Type>
              {ledger.digital_payment.methods.map((value) => (
                <Button key={value} label={paymentMethodLabel(value)} variant="secondary" selected={method === value} onPress={() => setMethod(value)} />
              ))}
            </View>
          ) : (
            <Notice tone="info" title="Online payment is not available" body={ledger.digital_payment.reason || "Use the payment arrangement agreed with your provider."} />
          )}

          <Surface style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <Type variant="bodyStrong" style={{ flex: 1 }}>Total you pay</Type>
              <Type variant="title1">{charge.outstanding_formatted}</Type>
            </View>
            <Type variant="caption">Any payment processing fee is paid by the property owner.</Type>
          </Surface>
          {existing ? <Button label="Continue payment" onPress={() => openCheckout(existing)} /> : ledger.digital_payment.available ? <Button label="Continue securely" busy={busy} busyLabel="Starting checkout…" onPress={() => void start()} /> : null}
          <Type variant="caption">Danpa HQ confirms payment with the processor. Returning to the app alone never marks rent as paid.</Type>
        </>
      ) : null}
      {!loading && ledger && !charge ? <Notice tone="error" title="This charge is no longer available." /> : null}
      <PaystackCheckoutModal
        intent={checkoutIntent}
        onClose={() => {
          const current = checkoutIntent;
          setCheckoutIntent(null);
          if (current) openStatus(current);
        }}
        onCheckoutReturn={() => {
          const current = checkoutIntent;
          setCheckoutIntent(null);
          if (current) openStatus(current);
        }}
      />
    </ScrollView>
  );
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
