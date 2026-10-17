import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";

import type { PlanCatalogue, PortfolioBilling } from "@/billing";
import {
  currentPlanOf,
  formatPrice,
  grouped,
  isFreePlan,
  metersOf,
  periodWord,
  planPrice,
  standingOf,
  type Meter,
  type StandingAction,
} from "@/billingPresentation";
import { StatusBadge, TONES } from "@/components/billing/BillingParts";
import { Panel, Pill } from "@/components/billing/BillingSurfaces";
import { INK, KOLA, LABEL, MUTED, RULE, type IconName } from "@/components/portfolio/PortfolioList";
import { Type, radius, space } from "@/components/ui";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * The Portfolio's plan at a glance: what it is, what it costs, how it stands, how
 * much of it is in use, and the one thing to do next.
 *
 * Refined on review (2026-09-15) into one glass surface with two zones. The plan
 * leads — its rung as a glyph, its name, its standing as a word, its price and one
 * line of when — and anything that needs a person sits straight under that line
 * with its one action, because on a phone the bottom of a card is usually below
 * the fold. When that action matters most, `Change plan` steps down so the two
 * never compete. Usage is the surface's quieter second zone. The plan's
 * description is the plans screen's to say.
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
  // A plan Danpa HQ provides costs this Portfolio nothing, so that is what the
  // price says. Its usual price is in the standing line, not in display type.
  const complimentary = Boolean(billing.subscription?.is_live && billing.subscription.funding === "complimentary");
  const action = standing.attention?.action ?? null;
  const actionLeads = Boolean(action && action.kind !== "keep");
  const usageNote =
    standing.limitsNote ??
    (billing.over_limit.length ? "Nothing has been removed. Adding more pauses until you are back within your plan." : null);
  // The ladder's rung, not a plan's name, picks the glyph and its colour.
  const rung: { icon: IconName; ink: string; wash: string } =
    plan.rank >= 2
      ? { icon: "diamond-outline", ink: KOLA, wash: theme.color.kola["50"] }
      : plan.rank === 1
        ? { icon: "sparkles-outline", ink: theme.color.gold["500"], wash: alpha(theme.color.gold["500"], 0.14) }
        : { icon: "leaf-outline", ink: theme.color.ink["700"], wash: theme.color.field["100"] };
  const attention = standing.attention;

  return (
    <Panel>
      <View style={styles.plan}>
        <View style={styles.head}>
          <View style={[styles.rung, { backgroundColor: rung.wash }]}>
            <Ionicons name={rung.icon} size={20} color={rung.ink} />
          </View>
          <View style={styles.headText}>
            <Type variant="caption" style={styles.eyebrow}>Current plan</Type>
            <Type variant="title2" accessibilityRole="header" numberOfLines={1} style={styles.name}>{plan.name}</Type>
          </View>
          {standing.badge ? <StatusBadge tone={standing.badge.tone} label={standing.badge.label} /> : null}
        </View>

        <View
          accessible
          accessibilityLabel={complimentary ? `No charge. ${standing.line}` : `${formatPrice(price, plan.currency)} a ${periodWord(interval)}. ${standing.line}`}
          style={styles.priceBlock}
        >
          <View style={styles.priceRow}>
            {complimentary ? (
              <Type variant="amountLg" style={styles.price}>No charge</Type>
            ) : (
              <>
                <Type variant="amountLg" style={styles.price}>{formatPrice(price, plan.currency)}</Type>
                <Type variant="body" style={styles.per}>/ {periodWord(interval)}</Type>
              </>
            )}
          </View>
          <Type variant="caption" style={styles.line}>{standing.line}</Type>
        </View>

        {attention ? (
          <View style={[styles.attention, { backgroundColor: TONES[attention.tone].bg }]}>
            <View accessible accessibilityRole={attention.tone === "critical" ? "alert" : "summary"} style={styles.attentionText}>
              <View style={styles.attentionTitleRow}>
                <View style={[styles.attentionDot, { backgroundColor: TONES[attention.tone].rule }]} />
                <Type variant="bodyStrong" style={styles.attentionTitle}>{attention.title}</Type>
              </View>
              <Type variant="caption" style={styles.attentionBody}>{attention.body}</Type>
            </View>
            {action ? (
              <Pill
                label={action.label}
                tone={action.kind === "keep" ? "quiet" : "primary"}
                busy={busyAction === action.kind}
                busyLabel={action.kind === "keep" ? "Keeping…" : "Opening…"}
                onPress={() => onAction(action)}
              />
            ) : null}
          </View>
        ) : null}

        {billing.viewer.can_change_plan ? (
          <Pill label="Change plan" icon="swap-vertical-outline" tone={actionLeads ? "quiet" : "primary"} onPress={onChangePlan} />
        ) : (
          <Type variant="caption" style={styles.line}>Only a Portfolio owner or administrator can change the plan.</Type>
        )}
      </View>

      <View style={styles.usage}>
        <Type variant="label" accessibilityRole="header" style={styles.usageLabel}>USAGE</Type>
        {meters.map((meter, index) => <MeterLine key={meter.key} meter={meter} first={index === 0} />)}
        {usageNote ? <Type variant="caption" style={styles.usageNote}>{usageNote}</Type> : null}
      </View>
    </Panel>
  );
}

/**
 * A limit and how much of it is in use. The count is the fact and the bar only
 * reinforces it, so the line is read out as one sentence and the bar not at all.
 * An unlimited allowance has no bar to fill, so it has none.
 */
function MeterLine({ meter, first }: { meter: Meter; first: boolean }) {
  const strained = meter.state === "full" || meter.state === "near";
  const fill = meter.state === "over" ? theme.color.laterite["600"] : strained ? theme.color.harmattan["500"] : KOLA;
  const noteInk = meter.state === "over" ? theme.color.laterite["600"] : strained ? theme.color.harmattan["600"] : MUTED;
  return (
    <View
      accessible
      accessibilityLabel={`${meter.name}: ${meter.valueText}. ${meter.note}.`}
      style={[styles.meter, first ? null : styles.meterRuled]}
    >
      <View style={styles.meterHead}>
        <Type variant="body" numberOfLines={1} style={styles.meterName}>{meter.name}</Type>
        <Type variant="bodyStrong" style={styles.meterValue}>
          {grouped(meter.used)}
          {meter.limit === null ? null : <Type variant="body" style={styles.meterLimit}>{` / ${grouped(meter.limit)}`}</Type>}
        </Type>
      </View>
      {meter.limit === null ? null : (
        <View style={styles.track}>
          <View style={[styles.bar, { width: `${Math.round(meter.fill * 100)}%`, backgroundColor: fill }]} />
        </View>
      )}
      <Type variant="caption" style={[styles.meterNote, { color: noteInk }]}>{meter.note}</Type>
    </View>
  );
}

const styles = StyleSheet.create({
  plan: {
    gap: space[4],
    padding: space[4],
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  rung: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  name: {
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: -0.3,
    color: INK,
  },
  priceBlock: {
    gap: 2,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
  },
  price: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.5,
    color: INK,
  },
  per: {
    fontSize: 15,
    lineHeight: 20,
    color: MUTED,
  },
  line: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  attention: {
    gap: space[3],
    padding: space[3],
    borderRadius: 12,
  },
  attentionText: {
    gap: space[1],
  },
  attentionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  attentionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  attentionTitle: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  attentionBody: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.color.ink["700"],
  },
  usage: {
    gap: space[1],
    paddingTop: space[3],
    paddingBottom: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
    backgroundColor: alpha(theme.color.field["50"], 0.6),
  },
  usageLabel: {
    marginBottom: space[1],
    color: LABEL,
  },
  meter: {
    gap: 6,
    paddingVertical: space[2],
  },
  meterRuled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  meterHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[3],
  },
  meterName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  meterValue: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  meterLimit: {
    color: MUTED,
  },
  track: {
    height: 5,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: alpha(theme.color.ink["900"], 0.08),
  },
  bar: {
    height: "100%",
    borderRadius: radius.pill,
  },
  meterNote: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  usageNote: {
    paddingTop: space[1],
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
});
