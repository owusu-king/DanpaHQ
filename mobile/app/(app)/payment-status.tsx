import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { PaystackCheckoutModal } from "@/components/payments/PaystackCheckoutModal";
import { Button, Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import {
  getPaymentIntent,
  refreshPaymentIntent,
  retryPaymentIntent,
  safeCheckoutUrl,
  type PaymentIntent,
} from "@/payments";
import { theme } from "@/theme";

export default function PaymentStatusScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const router = useRouter();
  const params = useLocalSearchParams<{ intentId?: string; openCheckout?: string }>();
  const intentId = params.intentId ?? "";
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [checkoutIntent, setCheckoutIntent] = useState<PaymentIntent | null>(null);
  const opened = useRef(false);

  const check = useCallback(async () => {
    if (!intentId) {
      setError("This payment could not be identified.");
      setLoading(false);
      return;
    }
    setChecking(true);
    try {
      const current = await getPaymentIntent(intentId);
      const next = ["succeeded", "cancelled"].includes(current.status) ? current : await refreshPaymentIntent(current.id);
      setIntent(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not confirm this payment yet.");
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }, [intentId]);
  useFocusEffect(useCallback(() => { void check(); }, [check]));

  const checkoutUrl = intent ? safeCheckoutUrl(intent) : null;
  useEffect(() => {
    if (params.openCheckout !== "1" || !checkoutUrl || opened.current) return;
    opened.current = true;
    setCheckoutIntent(intent);
  }, [checkoutUrl, intent, params.openCheckout]);

  async function retry() {
    if (!intent) return;
    setChecking(true);
    setError("");
    try {
      const next = await retryPaymentIntent(intent.id);
      setIntent(next);
      const url = safeCheckoutUrl(next);
      if (url) setCheckoutIntent(next);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "A new payment attempt could not be started.");
    } finally {
      setChecking(false);
    }
  }

  const pending = intent && ["created", "pending", "processing"].includes(intent.status);
  const unsuccessful = intent && ["failed", "expired"].includes(intent.status);
  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[5] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="label">SECURE PAYMENT</Type>
        <Type variant="display2" accessibilityRole="header">{intent?.status === "succeeded" ? "Payment confirmed" : "Payment status"}</Type>
        {intent ? <Type variant="body">{intent.property_title} · {intent.unit_label}</Type> : null}
      </View>
      {loading ? <Type variant="caption">Confirming with the payment processor…</Type> : null}
      {error ? <Notice tone="error" title={error} /> : null}
      {intent?.status === "succeeded" ? (
        <>
          <View accessibilityElementsHidden style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: theme.color.kola["600"], alignItems: "center", justifyContent: "center" }}><Type variant="title1" style={{ color: theme.color.kola["600"] }}>✓</Type></View>
          <Type variant="display2">{intent.amount_formatted}</Type>
          <Type variant="caption">Your rent account has been updated. Provider settlement is tracked separately.</Type>
          {intent.receipt_id ? <Button label="View receipt" onPress={() => router.push({ pathname: "/(app)/payment-receipt", params: { receiptId: intent.receipt_id } } as never)} /> : null}
          <Button label="Rent account" variant="secondary" onPress={() => router.replace({ pathname: "/(app)/rent-account", params: { leaseId: intent.lease_id, mode: "tenant" } } as never)} />
        </>
      ) : pending ? (
        <>
          <Notice tone="info" title="Still confirming" body="This can take a moment. Do not start another payment for the same charge." />
          <Type variant="display2">{intent.amount_formatted}</Type>
          <Button label="Check again" busy={checking} onPress={() => void check()} />
          {checkoutUrl ? <Button label="Continue secure checkout" variant="secondary" onPress={() => setCheckoutIntent(intent)} /> : null}
          <Type variant="caption">Secure checkout opens inside Danpa HQ. This screen asks the processor for the result before updating your rent.</Type>
        </>
      ) : unsuccessful ? (
        <>
          <Notice tone="warning" title={intent.status === "expired" ? "Payment attempt expired" : "Payment was not completed"} body={intent.failure_message || "No rent was marked paid. You can safely try again."} />
          <Button label="Try again" busy={checking} onPress={() => void retry()} />
        </>
      ) : intent?.status === "cancelled" ? <Notice tone="info" title="Payment was cancelled" body="No rent was marked paid." /> : null}
      <PaystackCheckoutModal
        intent={checkoutIntent}
        onClose={() => {
          setCheckoutIntent(null);
          void check();
        }}
        onCheckoutReturn={() => {
          setCheckoutIntent(null);
          void check();
        }}
      />
    </ScrollView>
  );
}
