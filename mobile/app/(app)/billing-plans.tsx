import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  getPlanCatalogue,
  getPortfolioBilling,
  type BillingInterval,
  type PlanCatalogue,
  type PortfolioBilling,
} from "@/billing";
import {
  catalogueSaving,
  comparison,
  currentPlanOf,
  formatPrice,
  intervalLabel,
  isFreePlan,
  periodWord,
  planName,
  planOptions,
  priceNote,
  type PlanOption,
} from "@/billingPresentation";
import { BillingSkeleton, StatusBadge } from "@/components/billing/BillingParts";
import { Disclosure } from "@/components/property/WorkspacePatterns";
import { Button, Choice, Notice, Surface, Type, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * Change plan: every plan, priced for the billing cycle chosen, with the one
 * thing each can do for this Portfolio.
 *
 * The web's comparison, one plan to a card. Choosing a plan only opens its
 * review — the server prices it there, for this Portfolio, before anything
 * happens — and the full feature matrix waits behind a disclosure for the few
 * who want it.
 */
export default function BillingPlansScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ organizationId?: string }>();
  const organizationId = params.organizationId ?? "";
  const [data, setData] = useState<{ billing: PortfolioBilling; catalogue: PlanCatalogue } | null>(null);
  const [error, setError] = useState("");
  const [cycle, setCycle] = useState<BillingInterval | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setError("This Portfolio could not be identified.");
      return;
    }
    try {
      const [catalogue, billing] = await Promise.all([getPlanCatalogue(), getPortfolioBilling(organizationId)]);
      setData({ billing, catalogue });
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Plans could not load. Check your connection and try again.");
    }
  }, [organizationId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!data) {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[4] }}>
        {error ? (
          <>
            <Notice tone="error" title={error} />
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </>
        ) : (
          <BillingSkeleton />
        )}
      </ScrollView>
    );
  }

  const { billing, catalogue } = data;
  const interval = cycle ?? billing.subscription?.billing_interval ?? "monthly";
  const saving = catalogueSaving(catalogue);
  const current = currentPlanOf(billing, catalogue);

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}>
      <Type variant="body" style={{ color: theme.color.ink["500"] }}>
        {`You're on ${current.name}`}
      </Type>

      <Choice
        label="Billing cycle"
        value={interval}
        options={[
          { value: "monthly", label: intervalLabel("monthly") },
          { value: "annual", label: saving ? `${intervalLabel("annual")} · ${saving}` : intervalLabel("annual") },
        ]}
        onChange={setCycle}
      />

      {error ? <Notice tone="error" title={error} /> : null}

      {planOptions(catalogue, billing, interval).map((option) => (
        <PlanCard
          key={option.plan.code}
          option={option}
          interval={interval}
          onChoose={() =>
            router.push({
              pathname: "/(app)/billing-review",
              params: { organizationId, plan: option.plan.code, interval },
            } as never)
          }
        />
      ))}

      <Disclosure title="Compare every feature">
        <ComparisonList catalogue={catalogue} currentCode={current.code} />
      </Disclosure>
    </ScrollView>
  );
}

function PlanCard({ option, interval, onChoose }: { option: PlanOption; interval: BillingInterval; onChoose: () => void }) {
  const { plan } = option;
  const free = isFreePlan(plan);
  return (
    <Surface
      style={{
        padding: space[5],
        gap: space[4],
        borderWidth: option.isCurrent ? 2 : 1,
        borderColor: option.isCurrent ? theme.color.ink["900"] : theme.color.field["200"],
      }}
    >
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[3], rowGap: space[1] }}>
          <Type variant="title1" accessibilityRole="header">
            {plan.name}
          </Type>
          {option.isCurrent ? (
            <StatusBadge tone="neutral" label="Current plan" />
          ) : option.recommended ? (
            <StatusBadge tone="positive" label="Recommended" />
          ) : null}
        </View>
        <Type variant="body" style={{ color: theme.color.ink["500"] }}>
          {plan.description}
        </Type>
      </View>

      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}>
          {free ? (
            <Type variant="amountLg">{formatPrice(0, plan.currency)}</Type>
          ) : option.price !== null ? (
            <>
              <Type variant="amountLg">{formatPrice(option.price, plan.currency)}</Type>
              <Type variant="body" style={{ color: theme.color.ink["500"] }}>
                {`/ ${periodWord(interval)}`}
              </Type>
            </>
          ) : (
            <Type variant="bodyStrong">Not offered</Type>
          )}
        </View>
        {/* Always one line, in both cycles: switching changes these words,
            never the height of every card below. */}
        <Type variant="caption" numberOfLines={1}>
          {priceNote(plan, interval) || " "}
        </Type>
      </View>

      <View style={{ gap: space[2], paddingTop: space[4], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
        {option.limits.map((limit) => (
          <Type key={limit} variant="bodyStrong">
            {limit}
          </Type>
        ))}
      </View>

      {option.highlights.length ? (
        <View style={{ gap: space[2] }}>
          {option.inherits ? <Type variant="caption">{option.inherits}</Type> : null}
          {option.highlights.map((highlight) => (
            <View key={highlight} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Ionicons name="checkmark" size={16} color={theme.color.kola["600"]} />
              <Type variant="body" style={{ flex: 1 }}>
                {highlight}
              </Type>
            </View>
          ))}
        </View>
      ) : null}

      {/* No empty slot for a plan with nothing to do: stacked on a phone, it
          reads as a missing button. */}
      {option.unavailable ? (
        <Type variant="caption">{option.unavailable}</Type>
      ) : option.action ? (
        <Button label={option.action.label} variant={option.action.kind === "upgrade" ? "primary" : "secondary"} onPress={onChoose} />
      ) : null}
    </Surface>
  );
}

/** Everything each plan includes, one capability to a row and the three answers under it. */
function ComparisonList({ catalogue, currentCode }: { catalogue: PlanCatalogue; currentCode: string }) {
  return (
    <View style={{ gap: space[6] }}>
      {comparison(catalogue).map((group) => (
        <View key={group.group} style={{ gap: space[2] }}>
          <Type variant="bodyStrong" accessibilityRole="header">
            {group.group}
          </Type>
          {group.rows.map((row) => (
            <View
              key={row.meta.key}
              accessible
              accessibilityLabel={`${row.meta.name}: ${row.values
                .map((value) => `${planName(catalogue, value.code)}, ${value.text}`)
                .join("; ")}`}
              style={{ gap: space[2], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}
            >
              <Type variant="body">{row.meta.name}</Type>
              <View style={{ flexDirection: "row", gap: space[2] }}>
                {row.values.map((value) => (
                  <View key={value.code} style={{ flex: 1, gap: 2 }}>
                    <Type variant={value.code === currentCode ? "captionStrong" : "caption"}>
                      {planName(catalogue, value.code)}
                    </Type>
                    {row.meta.value_type === "boolean" ? (
                      value.included ? (
                        <Ionicons name="checkmark" size={18} color={theme.color.kola["600"]} />
                      ) : (
                        <Type variant="body" style={{ color: theme.color.ink["500"] }}>
                          —
                        </Type>
                      )
                    ) : (
                      <Type variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
                        {value.text}
                      </Type>
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
