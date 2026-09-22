import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  changePlanWithoutPayment,
  getPlanCatalogue,
  getPlanChangeQuote,
  getPortfolioBilling,
  startSubscriptionCheckout,
  type BillingInterval,
  type KeepActive,
  type PlanCatalogue,
  type PlanChangeQuote,
  type PlanCode,
  type PortfolioBilling,
} from "@/billing";
import {
  downgradeRows,
  formatAmount,
  formatDate,
  formatPrice,
  initialKeep,
  intervalLabel,
  isFreePlan,
  keepComplete,
  periodRange,
  periodWord,
  planByCode,
  planOptions,
} from "@/billingPresentation";
import { Attention, Bone, ResultMark, StatusBadge } from "@/components/billing/BillingParts";
import { KeepChooser } from "@/components/billing/KeepChooser";
import { Button, Notice, Type, radius, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { paymentMethodLabel, type DigitalPaymentMethod } from "@/payments";
import { theme } from "@/theme";

type Loaded = { billing: PortfolioBilling; catalogue: PlanCatalogue; quote: PlanChangeQuote };

/**
 * Review a plan change before anything happens.
 *
 * Priced by the server for this Portfolio, now. A paid change shows what is due
 * today and hands over to the provider's secure checkout. A downgrade shows what
 * the cheaper plan includes and — when the Portfolio holds more — asks what stays
 * fully active. Neither activates a plan here: a payment is confirmed on the next
 * screen by the server, and a downgrade is the server's to apply.
 */
export default function BillingReviewScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const router = useRouter();
  const params = useLocalSearchParams<{ organizationId?: string; plan?: string; interval?: string }>();
  const organizationId = params.organizationId ?? "";
  const planCode = (params.plan ?? "") as PlanCode;
  const interval: BillingInterval = params.interval === "annual" ? "annual" : "monthly";

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [method, setMethod] = useState<DigitalPaymentMethod | null>(null);
  const [keep, setKeep] = useState<KeepActive | null>(null);
  const [busy, setBusy] = useState<null | "pay" | "downgrade">(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ title: string; body: string } | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !planCode) {
      setLoadError("This plan change could not be identified.");
      return;
    }
    try {
      const [catalogue, billing, quote] = await Promise.all([
        getPlanCatalogue(),
        getPortfolioBilling(organizationId),
        getPlanChangeQuote(organizationId, planCode, interval),
      ]);
      setLoaded({ billing, catalogue, quote });
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof ApiFailure ? cause.error.message : "This change could not be priced. Try again.");
    }
  }, [organizationId, planCode, interval]);

  useFocusEffect(
    useCallback(() => {
      // Once a downgrade is applied there is nothing left to price.
      if (!done) void load();
    }, [load, done]),
  );

  async function pay(quote: PlanChangeQuote, chosen: DigitalPaymentMethod) {
    setBusy("pay");
    setError("");
    try {
      const checkout = await startSubscriptionCheckout(organizationId, {
        plan_code: quote.plan.code,
        billing_interval: quote.billing_interval,
        payment_method: chosen,
      });
      // The plan does not change here. The next screen follows the payment and
      // waits for the server to confirm it.
      router.replace({
        pathname: "/(app)/billing-payment",
        params: { organizationId, checkoutId: checkout.id, open: "1" },
      } as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Checkout could not start. Nothing has been charged.");
      // A payment already in flight shows up as the review's own answer.
      void load();
    } finally {
      setBusy(null);
    }
  }

  async function downgrade(quote: PlanChangeQuote, keepActive: KeepActive) {
    setBusy("downgrade");
    setError("");
    try {
      // Sent only when the move goes above the plan's allowance. Everything else
      // leaves nothing to choose, and the server's fallback is never overridden
      // by a selection nobody made.
      await changePlanWithoutPayment(
        organizationId,
        quote.plan.code,
        quote.resource_choice?.required ? keepActive : undefined,
      );
      const later = quote.effective === "period_end";
      setDone({
        title: later ? `${quote.plan.name} starts on ${formatDate(quote.effective_at)}` : `You're on ${quote.plan.name}`,
        body: later
          ? `${quote.current_plan.name} stays on until then, and you can keep it any time before that. Your records stay safe.`
          : quote.resource_choice?.required
            ? "Your records stay safe. What you kept is fully active; everything else keeps its records and running tenancies."
            : "Your records stay safe.",
      });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "The plan could not be changed. Nothing has changed.");
    } finally {
      setBusy(null);
    }
  }

  const leave = () => router.dismissTo("/(app)/billing" as never);

  if (done) {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[5] }}>
        <View style={{ alignItems: "center", gap: space[3], paddingTop: space[8] }}>
          <ResultMark tone="neutral" icon="checkmark" />
          <Type variant="title1" accessibilityRole="header" style={{ textAlign: "center" }}>
            {done.title}
          </Type>
          <Type variant="body" accessibilityLiveRegion="polite" style={{ textAlign: "center", color: theme.color.ink["700"] }}>
            {done.body}
          </Type>
        </View>
        <Button label="Done" onPress={leave} />
      </ScrollView>
    );
  }

  const quote = loaded?.quote ?? null;

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[6] }}>
      {!loaded && !loadError ? <ReviewSkeleton /> : null}
      {loadError ? (
        <View style={{ gap: space[3] }}>
          <Notice tone="error" title={loadError} />
          <Button label="Try again" variant="secondary" onPress={() => void load()} />
        </View>
      ) : null}

      {loaded && quote ? (
        quote.blocked ? (
          <View style={{ gap: space[4] }}>
            <Type variant="title1" accessibilityRole="header">
              {planByCode(loaded.catalogue, quote.plan.code)?.name ?? quote.plan.name}
            </Type>
            <Attention tone="warning" title={quote.blocked.message} />
            {quote.blocked.code === "checkout_in_progress" && loaded.billing.checkout.open ? (
              <Button
                label="Check payment"
                onPress={() =>
                  router.replace({
                    pathname: "/(app)/billing-payment",
                    params: { organizationId, checkoutId: loaded.billing.checkout.open?.id ?? "" },
                  } as never)
                }
              />
            ) : null}
            <Button label="Back to plans" variant="secondary" onPress={() => router.back()} />
          </View>
        ) : quote.direction === "downgrade" ? (
          <DowngradeReview
            quote={quote}
            billing={loaded.billing}
            catalogue={loaded.catalogue}
            keep={keep ?? initialKeep(quote.resource_choice)}
            onKeep={setKeep}
            busy={busy === "downgrade"}
            error={error}
            onConfirm={(keepActive) => void downgrade(quote, keepActive)}
            onKeepCurrent={leave}
          />
        ) : (
          <PaidReview
            quote={quote}
            billing={loaded.billing}
            catalogue={loaded.catalogue}
            method={method ?? loaded.billing.checkout.methods[0] ?? "mobile_money"}
            onMethod={setMethod}
            busy={busy === "pay"}
            error={error}
            onPay={(chosen) => void pay(quote, chosen)}
          />
        )
      ) : null}
    </ScrollView>
  );
}

function PaidReview({
  quote,
  billing,
  catalogue,
  method,
  onMethod,
  busy,
  error,
  onPay,
}: {
  quote: PlanChangeQuote;
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  method: DigitalPaymentMethod;
  onMethod: (method: DigitalPaymentMethod) => void;
  busy: boolean;
  error: string;
  onPay: (method: DigitalPaymentMethod) => void;
}) {
  const target = planOptions(catalogue, billing, quote.billing_interval).find((option) => option.plan.code === quote.plan.code);
  return (
    <View style={{ gap: space[6] }}>
      <Type variant="title1" accessibilityRole="header">
        {quote.direction === "renewal" ? `Renew ${quote.plan.name}` : `Upgrade to ${quote.plan.name}`}
      </Type>

      <View style={{ overflow: "hidden", borderWidth: 1, borderColor: theme.color.field["200"], borderRadius: radius.md }}>
        <SummaryRow
          label={`${quote.plan.name} · ${intervalLabel(quote.billing_interval)}`}
          value={formatAmount(quote.list_price_minor, quote.currency)}
        />
        {quote.credit_minor > 0 ? (
          <SummaryRow
            label={`Credit for unused ${quote.current_plan.name} time`}
            value={`−${formatAmount(quote.credit_minor, quote.currency)}`}
            credit
          />
        ) : null}
        <SummaryRow label="Due today" value={formatAmount(quote.amount_minor, quote.currency)} total />
      </View>

      <Type variant="body" style={{ color: theme.color.ink["700"] }}>
        {`Covers ${periodRange(quote.period_start, quote.period_end)}. Renew by ${formatDate(quote.period_end)} to keep ${quote.plan.name}.`}
      </Type>

      {quote.direction === "upgrade" && target ? (
        <View accessibilityLabel={`${quote.plan.name} includes`} style={{ gap: space[2] }}>
          {target.limits.map((limit) => (
            <View key={limit} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Ionicons name="checkmark" size={16} color={theme.color.kola["600"]} />
              <Type variant="body">{limit}</Type>
            </View>
          ))}
        </View>
      ) : null}

      {billing.checkout.available ? (
        <View style={{ gap: space[2] }}>
          <Type variant="bodyStrong">Pay with</Type>
          {billing.checkout.methods.map((value) => (
            <Button
              key={value}
              label={paymentMethodLabel(value)}
              variant="secondary"
              selected={method === value}
              onPress={() => onMethod(value)}
            />
          ))}
        </View>
      ) : (
        <Attention
          tone="warning"
          title="Online payments aren't available right now"
          body="Nothing has been charged. Try again later."
        />
      )}

      {error ? <Notice tone="error" title={error} /> : null}

      {billing.checkout.available ? (
        <Button
          label={`Pay ${formatAmount(quote.amount_minor, quote.currency)}`}
          busy={busy}
          busyLabel="Opening secure checkout…"
          onPress={() => onPay(method)}
        />
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Ionicons name="lock-closed-outline" size={14} color={theme.color.ink["500"]} />
        <Type variant="caption" style={{ flex: 1 }}>
          {"Paid in the provider's secure window. Your plan changes only once the payment is confirmed."}
        </Type>
      </View>
    </View>
  );
}

function DowngradeReview({
  quote,
  billing,
  catalogue,
  keep,
  onKeep,
  busy,
  error,
  onConfirm,
  onKeepCurrent,
}: {
  quote: PlanChangeQuote;
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  keep: KeepActive;
  onKeep: (value: KeepActive) => void;
  busy: boolean;
  error: string;
  onConfirm: (keepActive: KeepActive) => void;
  onKeepCurrent: () => void;
}) {
  const choice = quote.resource_choice;
  const rows = downgradeRows(quote, billing, catalogue);
  const target = planByCode(catalogue, quote.plan.code);
  const renewsAt = target && !isFreePlan(target) ? formatPrice(quote.list_price_minor, quote.currency) : null;
  // The chooser speaks for the limits it settles. Any other limit above the
  // plan — team members, say — is not a choice: what exists stays, more waits.
  const elsewhere = choice?.required ? rows.filter((row) => row.over && !choice.covers.includes(row.key)) : [];
  // Confirmable once the choice is whole: exactly as many kept as the plan
  // runs. The review opens whole, so this only waits out a swap in progress.
  const complete = keepComplete(quote.resource_choice, keep);

  return (
    <View style={{ gap: space[6] }}>
      <Type variant="title1" accessibilityRole="header">
        {`Switch to ${quote.plan.name}?`}
      </Type>

      {choice?.required ? (
        <KeepChooser plan={quote.plan.name} choice={choice} keep={keep} onKeep={onKeep} />
      ) : (
        <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
          {rows.map((row) => (
            <View key={row.key} style={{ gap: space[2], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
              <Type variant="caption">{row.name}</Type>
              <View style={{ flexDirection: "row", gap: space[3] }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Type variant="caption">Your Portfolio has</Type>
                  <Type variant="bodyStrong">{row.used}</Type>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Type variant="caption">{`${quote.plan.name} includes`}</Type>
                  <Type variant="bodyStrong" style={row.over ? { color: theme.color.laterite["600"] } : null}>
                    {row.included}
                  </Type>
                  {row.over ? <StatusBadge tone="critical" label="Above limit" /> : null}
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {elsewhere.map((row) => (
        <Type key={row.key} variant="body" style={{ color: theme.color.ink["700"] }}>
          {`${quote.plan.name} includes ${row.included}, and this Portfolio has ${row.used}. Everything already here stays; adding more waits until there is room.`}
        </Type>
      ))}

      <View style={{ gap: space[1], padding: space[4], borderRadius: radius.md, backgroundColor: theme.color.kola["50"] }}>
        <Type variant="bodyStrong" style={{ color: theme.color.kola["800"] }}>
          Your records stay safe
        </Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          Downgrading never deletes your properties, units, tenants, agreements, payments, or history. Resources above your new plan limits may have restricted management capabilities. Existing tenancies can continue to completion, but starting new rental activity on restricted properties requires available plan capacity or an upgrade.
        </Type>
      </View>

      <Type variant="body" style={{ color: theme.color.ink["700"] }}>
        {quote.effective === "period_end"
          ? `You keep ${quote.current_plan.name} until ${formatDate(quote.effective_at)}, which is already paid for. ${quote.plan.name} starts then${renewsAt ? ` at ${renewsAt} / ${periodWord(quote.billing_interval)}` : ""}${choice?.required ? ", and your choice takes effect with it" : ""}.`
          : `${quote.plan.name} starts straight away.`}
      </Type>

      {error ? <Notice tone="error" title={error} /> : null}

      <View style={{ gap: space[3] }}>
        <Button
          label="Confirm downgrade"
          busy={busy}
          busyLabel="Confirming…"
          disabled={!complete}
          onPress={() => onConfirm(keep)}
        />
        <Button label={`Keep ${quote.current_plan.name}`} variant="secondary" disabled={busy} onPress={onKeepCurrent} />
      </View>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  total = false,
  credit = false,
}: {
  label: string;
  value: string;
  total?: boolean;
  credit?: boolean;
}) {
  const tint = credit ? { color: theme.color.kola["800"] } : null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: total ? 1 : 0,
        borderTopColor: theme.color.field["200"],
        backgroundColor: total ? theme.color.field["50"] : theme.color.field["0"],
      }}
    >
      <Type variant={total ? "bodyStrong" : "body"} style={[{ flex: 1 }, tint]}>
        {label}
      </Type>
      <Type variant={total ? "title2" : "bodyStrong"} style={[{ fontVariant: ["tabular-nums"] }, tint]}>
        {value}
      </Type>
    </View>
  );
}

function ReviewSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading the review" accessibilityRole="progressbar" style={{ gap: space[4] }}>
      <Bone width="62%" height={30} />
      <Bone height={132} round={8} />
      <Bone />
      <Bone width="72%" />
      <Bone height={48} round={8} />
    </View>
  );
}
