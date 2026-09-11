import { View } from "react-native";

import type { PlanCatalogue, PortfolioBilling } from "@/billing";
import {
  currentPlanOf,
  formatPrice,
  isFreePlan,
  metersOf,
  periodWord,
  planPrice,
  standingOf,
  type StandingAction,
} from "@/billingPresentation";
import { Attention, StatusBadge, UsageMeter } from "@/components/billing/BillingParts";
import { Button, Surface, Type, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * The Portfolio's plan at a glance: what it is, what it costs, when it is paid
 * until, how much of it is in use, and the one thing to do next.
 *
 * The web's plan surface, stacked for a phone. Anything that needs a person — a
 * renewal due, a payment pending, a change about to happen — sits straight under
 * the standing line instead of below the meters, because on a phone the bottom
 * of a card is usually below the fold. When it carries an action, `Change plan`
 * steps down to a secondary button so the two never compete.
 */
export function CurrentPlanCard({
  billing,
  catalogue,
  busyAction,
  onChangePlan,
  onAction,
}: {
  billing: PortfolioBilling;
  catalogue: PlanCatalogue;
  busyAction: StandingAction["kind"] | null;
  onChangePlan: () => void;
  onAction: (action: StandingAction) => void;
}) {
  const plan = currentPlanOf(billing, catalogue);
  const standing = standingOf(billing, catalogue);
  const meters = metersOf(billing, catalogue);
  const free = isFreePlan(plan);
  const interval = free ? "monthly" : (billing.subscription?.billing_interval ?? "monthly");
  const price = free ? 0 : (planPrice(plan, interval) ?? plan.monthly_price_minor);
  // A plan Rooomly provides costs this Portfolio nothing, so that is what the
  // price says. Its usual price is in the standing line, not in display type.
  const complimentary = Boolean(billing.subscription?.is_live && billing.subscription.funding === "complimentary");
  const action = standing.attention?.action ?? null;
  const actionLeads = Boolean(action && action.kind !== "keep");
  const usageNote =
    standing.limitsNote ??
    (billing.over_limit.length ? "Nothing has been removed. Adding more pauses until you are back within your plan." : null);
  // The ladder's rung, not a plan's name, picks the edge.
  const accent = plan.rank >= 2 ? theme.color.kola["600"] : plan.rank === 1 ? theme.color.gold["500"] : theme.color.field["300"];

  return (
    <Surface style={{ padding: 0, overflow: "hidden" }}>
      <View style={{ padding: space[5], gap: space[3], borderLeftWidth: 3, borderLeftColor: accent }}>
        <Type variant="label">CURRENT PLAN</Type>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[3], rowGap: space[1] }}>
          <Type variant="display3" accessibilityRole="header">
            {plan.name}
          </Type>
          {standing.badge ? <StatusBadge tone={standing.badge.tone} label={standing.badge.label} /> : null}
        </View>
        {plan.description ? (
          <Type variant="body" style={{ color: theme.color.ink["500"] }}>
            {plan.description}
          </Type>
        ) : null}

        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2], marginTop: space[1] }}>
          {complimentary ? (
            <Type variant="amountLg">No charge</Type>
          ) : (
            <>
              <Type variant="amountLg">{formatPrice(price, plan.currency)}</Type>
              <Type variant="body" style={{ color: theme.color.ink["500"] }}>
                / {periodWord(interval)}
              </Type>
            </>
          )}
        </View>
        <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
          {standing.line}
        </Type>

        {standing.attention ? (
          <Attention tone={standing.attention.tone} title={standing.attention.title} body={standing.attention.body}>
            {action ? (
              <Button
                label={action.label}
                variant={action.kind === "keep" ? "secondary" : "primary"}
                busy={busyAction === action.kind}
                busyLabel={action.kind === "keep" ? "Keeping…" : "Opening…"}
                onPress={() => onAction(action)}
              />
            ) : null}
          </Attention>
        ) : null}

        {billing.viewer.can_change_plan ? (
          <View style={{ marginTop: space[1] }}>
            <Button label="Change plan" variant={actionLeads ? "secondary" : "primary"} onPress={onChangePlan} />
          </View>
        ) : (
          <Type variant="caption">Only a Portfolio owner or administrator can change the plan.</Type>
        )}
      </View>

      <View
        style={{
          padding: space[5],
          gap: space[4],
          borderTopWidth: 1,
          borderTopColor: theme.color.field["200"],
          backgroundColor: theme.color.field["50"],
        }}
      >
        <Type variant="label" accessibilityRole="header">
          USAGE
        </Type>
        {meters.map((meter) => (
          <UsageMeter key={meter.key} meter={meter} />
        ))}
        {usageNote ? <Type variant="caption">{usageNote}</Type> : null}
      </View>
    </Surface>
  );
}
