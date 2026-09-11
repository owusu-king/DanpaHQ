import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  cancelSubscriptionCheckout,
  getSubscriptionCheckout,
  refreshSubscriptionCheckout,
  retrySubscriptionCheckout,
  type SubscriptionCheckout,
} from "@/billing";
import { formatAmount, formatDate, type Tone } from "@/billingPresentation";
import { ResultMark } from "@/components/billing/BillingParts";
import { PaystackCheckoutModal } from "@/components/payments/PaystackCheckoutModal";
import { Button, Notice, Type, space } from "@/components/ui";
import { safeCheckoutUrl } from "@/payments";
import { theme } from "@/theme";

const PENDING: SubscriptionCheckout["status"][] = ["created", "pending", "processing"];

/**
 * One subscription payment, followed to its end.
 *
 * The provider's secure checkout opens over this screen. Closing it, or the
 * checkout returning to Rooomly, only prompts a server check: this screen never
 * decides that a payment succeeded. It asks Rooomly every few seconds and the
 * provider itself less often, and the plan changes when the server says so.
 */
export default function BillingPaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ organizationId?: string; checkoutId?: string; open?: string }>();
  const organizationId = params.organizationId ?? "";
  const checkoutId = params.checkoutId ?? "";
  const [checkout, setCheckout] = useState<SubscriptionCheckout | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<null | "check" | "cancel" | "retry">(null);
  const [sheet, setSheet] = useState<SubscriptionCheckout | null>(null);
  const [closed, setClosed] = useState(false);
  const [slow, setSlow] = useState(false);
  const opened = useRef(false);
  const known = useRef(false);

  const check = useCallback(
    async (askProvider: boolean, manual = false) => {
      if (!organizationId || !checkoutId) {
        setError("This payment could not be identified.");
        return null;
      }
      try {
        const next = askProvider
          ? await refreshSubscriptionCheckout(organizationId, checkoutId)
          : await getSubscriptionCheckout(organizationId, checkoutId);
        known.current = true;
        setCheckout(next);
        setError("");
        return next;
      } catch (cause) {
        // A missed poll is not news: the next one tries again. A check somebody
        // asked for, or a first read with nothing else to show, is.
        if (manual || !known.current) {
          setError(cause instanceof ApiFailure ? cause.error.message : "We could not reach Rooomly. Check your connection and try again.");
        }
        return null;
      }
    },
    [organizationId, checkoutId],
  );

  useFocusEffect(
    useCallback(() => {
      void check(true, true);
    }, [check]),
  );

  const pendingId = checkout && PENDING.includes(checkout.status) ? checkout.id : null;
  useEffect(() => {
    if (!pendingId) return;
    setSlow(false);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      // Rooomly's own record every few seconds; the provider itself less often.
      void check(ticks % 5 === 0);
      if (ticks === 30) setSlow(true);
      if (ticks >= 120) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [pendingId, check]);

  // Straight from the review, the secure checkout opens by itself — once.
  useEffect(() => {
    if (params.open !== "1" || opened.current || !checkout || !PENDING.includes(checkout.status)) return;
    if (!safeCheckoutUrl(checkout)) return;
    opened.current = true;
    setSheet(checkout);
  }, [checkout, params.open]);

  function returned() {
    setSheet(null);
    setClosed(true);
    // Not proof of payment — only a reason to ask now instead of at the next poll.
    void check(true, true);
  }

  async function checkNow() {
    setBusy("check");
    await check(true, true);
    setBusy(null);
  }

  async function cancel(current: SubscriptionCheckout) {
    setBusy("cancel");
    setError("");
    try {
      // Refused by the server unless the provider agrees nothing was taken.
      setCheckout(await cancelSubscriptionCheckout(organizationId, current.id));
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The payment could not be cancelled. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  function reprice(current: SubscriptionCheckout) {
    router.replace({
      pathname: "/(app)/billing-review",
      params: { organizationId, plan: current.invoice.plan.code, interval: current.invoice.billing_interval },
    } as never);
  }

  async function retry(current: SubscriptionCheckout) {
    // An expired or cancelled checkout is priced again from scratch.
    if (current.status !== "failed") {
      reprice(current);
      return;
    }
    setBusy("retry");
    setError("");
    try {
      const next = await retrySubscriptionCheckout(organizationId, current.id);
      setCheckout(next);
      setClosed(false);
      if (safeCheckoutUrl(next)) setSheet(next);
    } catch (cause) {
      const reason = cause instanceof ApiFailure ? cause.error.details.reason : undefined;
      if (cause instanceof ApiFailure && (reason === "payment_confirming" || reason === "paid_needs_review")) {
        // The provider has, or may have, the money. Pricing the change again
        // would invite a second payment, so this stays put and says why.
        setError(cause.error.message);
        return;
      }
      reprice(current);
    } finally {
      setBusy(null);
    }
  }

  const planName = checkout?.invoice.plan.name ?? "";

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }}>
      {!checkout ? (
        error ? (
          <View style={{ gap: space[3] }}>
            <Notice tone="error" title={error} />
            <Button label="Try again" variant="secondary" onPress={() => void check(true, true)} />
          </View>
        ) : (
          <View style={{ alignItems: "center", gap: space[3], paddingTop: space[10] }}>
            <ActivityIndicator color={theme.color.kola["600"]} />
            <Type variant="caption">Confirming with the payment provider…</Type>
          </View>
        )
      ) : checkout.status === "succeeded" ? (
        <Result
          tone="positive"
          icon="checkmark"
          title={checkout.invoice.kind === "renewal" ? `${planName} renewed` : `You're on ${planName}`}
          body={[
            `${formatAmount(checkout.amount_minor, checkout.currency)} paid.`,
            checkout.invoice.period_end ? `Paid until ${formatDate(checkout.invoice.period_end)}.` : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <Button label="Done" onPress={() => router.dismissTo("/(app)/billing" as never)} />
        </Result>
      ) : PENDING.includes(checkout.status) ? (
        <View style={{ gap: space[5] }}>
          <View style={{ alignItems: "center", gap: space[3], paddingTop: space[8] }}>
            <ActivityIndicator size="large" color={theme.color.ink["900"]} />
            <Type variant="title2" accessibilityRole="header" style={{ textAlign: "center" }}>
              {closed ? "The checkout window was closed" : "Waiting for the payment to be confirmed"}
            </Type>
            <Type variant="body" accessibilityLiveRegion="polite" style={{ textAlign: "center", color: theme.color.ink["700"] }}>
              {closed
                ? "If you approved the payment, it will be confirmed here shortly. Your plan has not changed yet."
                : slow
                  ? "This is taking longer than usual. You can leave this screen — your plan changes as soon as the payment is confirmed."
                  : "Finish paying in the secure checkout. This updates on its own."}
            </Type>
            <Type variant="caption" style={{ textAlign: "center", fontVariant: ["tabular-nums"] }}>
              {`${planName} · ${formatAmount(checkout.amount_minor, checkout.currency)}`}
            </Type>
          </View>
          {error ? <Notice tone="error" title={error} /> : null}
          <View style={{ gap: space[3] }}>
            {safeCheckoutUrl(checkout) ? (
              <Button
                label="Continue payment"
                variant={closed ? "primary" : "secondary"}
                disabled={busy !== null}
                onPress={() => {
                  setClosed(false);
                  setSheet(checkout);
                }}
              />
            ) : null}
            <Button
              label="Check again"
              variant="secondary"
              busy={busy === "check"}
              busyLabel="Checking…"
              disabled={busy !== null && busy !== "check"}
              onPress={() => void checkNow()}
            />
            <Button
              label="Cancel payment"
              variant="quiet"
              busy={busy === "cancel"}
              busyLabel="Cancelling…"
              disabled={busy !== null && busy !== "cancel"}
              onPress={() => void cancel(checkout)}
            />
          </View>
        </View>
      ) : (
        <Result
          tone="critical"
          icon="close"
          title={
            checkout.status === "expired"
              ? "Checkout expired"
              : checkout.status === "cancelled"
                ? "Payment cancelled"
                : "Payment not completed"
          }
          body={
            checkout.status === "expired"
              ? "The payment window closed before a payment was confirmed. Start again to see the current price."
              : checkout.status === "cancelled"
                ? "Nothing was charged, and your plan has not changed."
                : checkout.failure_message || "The payment was not completed, so nothing changed."
          }
        >
          {error ? <Notice tone="error" title={error} /> : null}
          <Button label="Try again" busy={busy === "retry"} busyLabel="Starting…" onPress={() => void retry(checkout)} />
          <Button
            label="Choose another plan"
            variant="secondary"
            disabled={busy !== null}
            onPress={() => router.dismissTo({ pathname: "/(app)/billing-plans", params: { organizationId } } as never)}
          />
        </Result>
      )}

      <PaystackCheckoutModal intent={sheet} settles="your plan" onClose={returned} onCheckoutReturn={returned} />
    </ScrollView>
  );
}

function Result({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: Tone;
  icon: "checkmark" | "close";
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space[6] }}>
      <View style={{ alignItems: "center", gap: space[3], paddingTop: space[8] }}>
        <ResultMark tone={tone} icon={icon} />
        <Type variant="title1" accessibilityRole="header" style={{ textAlign: "center" }}>
          {title}
        </Type>
        <Type variant="body" accessibilityLiveRegion="polite" style={{ textAlign: "center", color: theme.color.ink["700"] }}>
          {body}
        </Type>
      </View>
      <View style={{ gap: space[3] }}>{children}</View>
    </View>
  );
}
