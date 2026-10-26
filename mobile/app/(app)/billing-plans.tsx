import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

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
  planPrice,
  priceNote,
  type PlanOption,
} from "@/billingPresentation";
import { BillingSkeleton, StatusBadge } from "@/components/billing/BillingParts";
import { Disclosure } from "@/components/property/WorkspacePatterns";
import {
  EDGE,
  FAINT,
  GroupLabel,
  INK,
  KOLA,
  KOLA_DEEP,
  Lead,
  MUTED,
  PRESSED,
  RecordPanel,
  StandingLine,
} from "@/components/record/RecordSurfaces";
import { Button, Notice, Type, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";

/** Beyond this, a plan's list stops being scannable and starts being a brochure. */
const HIGHLIGHTS_SHOWN = 3;

/**
 * Change plan: every plan, priced for the billing cycle chosen, with the one
 * thing each can do for this Portfolio.
 *
 * Choosing a plan only opens its review — the server prices it there, for this
 * Portfolio, before anything happens — and the full feature matrix waits behind
 * a disclosure for the few who want it.
 *
 * Refined on review (2026-09-21) onto the record surfaces. It was four pricing
 * cards, each with a display heading, a paragraph of description, a rule, a
 * stack of limits, a tick list and its own button: about a screen and a half
 * per plan, which is the one shape in which plans cannot be compared. A plan is
 * now a panel you can take in at a glance — name, price, what it raises, three
 * things it adds — and the panel itself is the choice.
 */
export default function BillingPlansScreen() {
  const pageBottom = useSafeBottom(space[8]);
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
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}>
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

  // What is being paid today, which does not move when the cycle toggle does:
  // the toggle prices what could be chosen, never what is already held.
  const held = billing.subscription?.billing_interval ?? "monthly";
  const heldPrice = planPrice(current, held);
  const standing = isFreePlan(current) || !heldPrice
    ? "No billing on this plan"
    : `${formatPrice(heldPrice, current.currency)} per ${periodWord(held)}`;

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}>
      <RecordPanel>
        <Lead label="You are on" value={current.name} note={standing} tone="good" />
      </RecordPanel>

      {error ? <Notice tone="error" title={error} /> : null}

      <View style={styles.section}>
        <GroupLabel>Billing cycle</GroupLabel>
        <View accessibilityRole="radiogroup" accessibilityLabel="Billing cycle" style={styles.cycles}>
          <Cycle
            label={intervalLabel("monthly")}
            selected={interval === "monthly"}
            onPress={() => setCycle("monthly")}
          />
          <Cycle
            label={intervalLabel("annual")}
            note={saving ?? undefined}
            selected={interval === "annual"}
            onPress={() => setCycle("annual")}
          />
        </View>
      </View>

      <View style={styles.section}>
        <GroupLabel>Plans</GroupLabel>
        {planOptions(catalogue, billing, interval).map((option) => (
          <PlanPanel
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
      </View>

      <Disclosure title="Compare every feature">
        <ComparisonList catalogue={catalogue} currentCode={current.code} />
      </Disclosure>
    </ScrollView>
  );
}

/** One billing cycle, and what choosing it saves. */
function Cycle({ label, note, selected, onPress }: { label: string; note?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-selected={selected}
      accessibilityLabel={note ? `${label}, ${note}` : label}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [
        styles.cycle,
        selected ? styles.cycleOn : null,
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <Type variant="bodyStrong" numberOfLines={1} style={[styles.cycleLabel, selected ? { color: KOLA_DEEP } : null]}>
        {label}
      </Type>
      {note ? <Type variant="caption" numberOfLines={1} style={styles.cycleNote}>{note}</Type> : null}
    </Pressable>
  );
}

/**
 * One plan, as the decision it is.
 *
 * The panel is the choice: there is no button inside it to miss, and no button
 * beside three others to weigh. A plan that cannot be chosen says why on the
 * same line instead, and stops being pressable.
 */
function PlanPanel({ option, interval, onChoose }: { option: PlanOption; interval: BillingInterval; onChoose: () => void }) {
  const { plan } = option;
  const free = isFreePlan(plan);
  const amount = free
    ? formatPrice(0, plan.currency)
    : option.price !== null
      ? formatPrice(option.price, plan.currency)
      : null;
  const note = priceNote(plan, interval);
  const limits = option.limits.join(" · ");
  const highlights = option.highlights.slice(0, HIGHLIGHTS_SHOWN);
  const choosable = Boolean(option.action) && !option.unavailable && !option.isCurrent;

  const body = (
    <View style={styles.plan}>
      <View style={styles.planHead}>
        <View style={styles.planWho}>
          <Type variant="bodyStrong" numberOfLines={1} style={styles.planName}>{plan.name}</Type>
          {option.isCurrent ? (
            <StatusBadge tone="neutral" label="Your plan" />
          ) : option.recommended ? (
            <StatusBadge tone="positive" label="Recommended" />
          ) : null}
        </View>
        <View style={styles.planPrice}>
          {amount ? (
            <>
              <Type variant="bodyStrong" numberOfLines={1} style={styles.planAmount}>{amount}</Type>
              {/* A free plan's note already says there is nothing to bill. */}
              {free ? null : (
                <Type variant="caption" numberOfLines={1} style={styles.planPeriod}>
                  {`per ${periodWord(interval)}`}
                </Type>
              )}
            </>
          ) : (
            <Type variant="caption" numberOfLines={1} style={styles.planPeriod}>Not offered</Type>
          )}
        </View>
      </View>

      {/* Always one line, in both cycles: switching changes these words, never
          the height of every panel below. */}
      <Type variant="caption" numberOfLines={1} style={styles.planNote}>{note || " "}</Type>

      {limits ? (
        <View style={styles.planLimits}>
          <Type variant="captionStrong" numberOfLines={2} style={styles.planLimitsText}>{limits}</Type>
        </View>
      ) : null}

      {highlights.length ? (
        <View style={styles.planAdds}>
          {option.inherits ? <Type variant="caption" style={styles.planInherits}>{option.inherits}</Type> : null}
          {highlights.map((highlight) => (
            <View key={highlight} style={styles.planAdd}>
              <Ionicons name="checkmark" size={14} color={KOLA} />
              <Type variant="caption" numberOfLines={2} style={styles.planAddText}>{highlight}</Type>
            </View>
          ))}
        </View>
      ) : null}

      {choosable ? (
        <View style={styles.planFoot}>
          <Type variant="captionStrong" numberOfLines={1} style={styles.planGo}>{option.action?.label}</Type>
          <Ionicons name="chevron-forward" size={15} color={KOLA_DEEP} />
        </View>
      ) : option.unavailable ? (
        <View style={styles.planFoot}>
          <StandingLine tone="quiet" line={option.unavailable} />
        </View>
      ) : null}
      {/* The plan in force says so in its badge; saying it again at the foot is
          a second line and a rule for a fact already on the panel. */}
    </View>
  );

  if (!choosable) return <RecordPanel style={styles.planPanel}>{body}</RecordPanel>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${option.action?.label}. ${amount ?? "Not offered"}${amount && !free ? ` per ${periodWord(interval)}` : ""}. ${limits}`}
      onPress={onChoose}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.planPressable, pressed ? { backgroundColor: PRESSED } : null]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Everything each plan includes.
 *
 * One capability to a block, with each plan's answer beside its name. It was
 * three equal columns, which on a 320pt handset left ninety points a column and
 * cut every value that was a word rather than a tick.
 */
function ComparisonList({ catalogue, currentCode }: { catalogue: PlanCatalogue; currentCode: string }) {
  return (
    <View style={styles.compare}>
      {comparison(catalogue).map((group) => (
        <View key={group.group} style={styles.compareGroup}>
          <GroupLabel>{group.group}</GroupLabel>
          <RecordPanel>
            {group.rows.map((row, index) => (
              <View
                key={row.meta.key}
                accessible
                accessibilityLabel={`${row.meta.name}: ${row.values
                  .map((value) => `${planName(catalogue, value.code)}, ${value.text}`)
                  .join("; ")}`}
                style={[styles.compareRow, index === 0 ? null : styles.ruled]}
              >
                <Type variant="bodyStrong" style={styles.compareName}>{row.meta.name}</Type>
                <View style={styles.compareValues}>
                  {row.values.map((value) => (
                    <View key={value.code} style={styles.compareValue}>
                      <Type
                        variant="caption"
                        numberOfLines={1}
                        style={[styles.comparePlan, value.code === currentCode ? { color: KOLA_DEEP } : null]}
                      >
                        {planName(catalogue, value.code)}
                      </Type>
                      {row.meta.value_type === "boolean" ? (
                        <Ionicons
                          name={value.included ? "checkmark-circle" : "remove-circle-outline"}
                          size={16}
                          color={value.included ? KOLA : theme.color.ink["300"]}
                        />
                      ) : (
                        <Type variant="captionStrong" numberOfLines={1} style={styles.compareText}>{value.text}</Type>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </RecordPanel>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[4],
  },
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  cycles: {
    flexDirection: "row",
    gap: space[2],
  },
  cycle: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingHorizontal: space[3],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  cycleOn: {
    borderWidth: 2,
    borderColor: KOLA,
    backgroundColor: theme.color.kola["50"],
  },
  cycleLabel: {
    fontSize: 14.5,
    lineHeight: 19,
    color: INK,
  },
  cycleNote: {
    fontSize: 12,
    lineHeight: 15,
    color: KOLA_DEEP,
  },
  planPanel: {
    marginTop: space[2],
  },
  planPressable: {
    overflow: "hidden",
    marginTop: space[2],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  plan: {
    gap: space[2],
    padding: 14,
  },
  planHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
  },
  planWho: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space[2],
    rowGap: 4,
  },
  planName: {
    fontSize: 16,
    lineHeight: 21,
    color: INK,
  },
  planPrice: {
    flexShrink: 0,
    alignItems: "flex-end",
  },
  planAmount: {
    fontSize: 17,
    lineHeight: 22,
    color: INK,
  },
  planPeriod: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  planNote: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  planLimits: {
    paddingTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  planLimitsText: {
    fontSize: 13,
    lineHeight: 18,
    color: INK,
  },
  planAdds: {
    gap: 4,
  },
  planInherits: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  planAdd: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
  },
  planAddText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  planFoot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  planGo: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  compare: {
    gap: space[4],
  },
  compareGroup: {
    gap: space[2],
  },
  compareRow: {
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  compareName: {
    fontSize: 14,
    lineHeight: 19,
    color: INK,
  },
  compareValues: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  compareValue: {
    flexGrow: 1,
    flexBasis: 96,
    gap: 2,
  },
  comparePlan: {
    fontSize: 11.5,
    lineHeight: 15,
    color: FAINT,
  },
  compareText: {
    fontSize: 13,
    lineHeight: 18,
    color: INK,
  },
});
