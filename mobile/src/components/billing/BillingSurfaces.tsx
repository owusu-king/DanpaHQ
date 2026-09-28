import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import type { Tone } from "@/billingPresentation";
import { Bone, TONES } from "@/components/billing/BillingParts";
import {
  EDGE,
  GLASS,
  INK,
  KOLA,
  KOLA_DEEP,
  MUTED,
  PANEL_RADIUS,
  PRESSED,
  RULE,
  WHITE,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { sheetCardStyle } from "@/components/sheet/SheetParts";
import { Type, radius, space } from "@/components/ui";
import { isAndroid, pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * What Plan & billing is laid on (2026-09-15).
 *
 * The page says what plan, how it stands and what was paid at a glance, and keeps
 * everything longer one tap away: a panel shows the few most recent rows, and
 * "View all" opens the whole list in the shared sheet, which scrolls and swipes
 * away. These are the page's own parts — the change-plan steps keep
 * `BillingParts`, so refining this page moves nothing on theirs.
 */

/** How many rows a panel shows before handing the rest to its sheet. */
export const PREVIEW = { payments: 3, history: 2, restricted: 3 } as const;

/** A glass panel: the page's one kind of surface. */
export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

/** The way from a panel's few rows to all of them, saying how many. */
export function ViewAll({ count, noun, onPress }: { count: number; noun: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View all ${count} ${noun}`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.viewAll, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      <Type variant="captionStrong" style={styles.viewAllText}>{`View all ${count} ${noun}`}</Type>
      <Ionicons name="chevron-forward" size={16} color={KOLA} />
    </Pressable>
  );
}

/** One fact: its name, its value on the right, and at most one small act under the value. */
export function Fact({
  first = false,
  icon,
  label,
  value,
  action,
}: {
  first?: boolean;
  icon: IconName;
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <View style={[styles.fact, first ? null : styles.ruled]}>
      <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.factText}>
        <Ionicons name={icon} size={16} color={MUTED} style={styles.factIcon} />
        <Type variant="caption" style={styles.factLabel}>{label}</Type>
        <Type variant="bodyStrong" style={styles.factValue}>{value}</Type>
      </View>
      {action ? <View style={styles.factAction}>{action}</View> : null}
    </View>
  );
}

/** The page's acts: a kola pill for the one that leads, a soft kola tint for any other. */
export function Pill({
  label,
  icon,
  tone = "primary",
  busy = false,
  busyLabel,
  onPress,
}: {
  label: string;
  icon?: IconName;
  tone?: "primary" | "quiet";
  busy?: boolean;
  busyLabel?: string;
  onPress: () => void;
}) {
  const primary = tone === "primary";
  const ink = primary ? WHITE : KOLA_DEEP;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy && busyLabel ? busyLabel : label}
      aria-busy={busy} aria-disabled={busy}
      disabled={busy}
      onPress={onPress}
      {...pressableFeedback(primary ? alpha(WHITE, 0.24) : alpha(KOLA, 0.14))}
      style={({ pressed }) => [
        styles.pill,
        primary ? styles.pillPrimary : styles.pillQuiet,
        pressed && !isAndroid ? { opacity: 0.85 } : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : icon ? <Ionicons name={icon} size={17} color={ink} /> : null}
      <Type variant="bodyStrong" style={[styles.pillText, { color: ink }]}>{busy && busyLabel ? busyLabel : label}</Type>
    </Pressable>
  );
}

/** A small act inside a row: kola words on a soft tint. */
export function SmallAct({
  label,
  icon,
  accessibilityLabel,
  busy = false,
  busyLabel,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: IconName;
  accessibilityLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-busy={busy} aria-disabled={disabled || busy}
      disabled={disabled || busy}
      hitSlop={6}
      onPress={onPress}
      {...pressableFeedback(alpha(KOLA, 0.14))}
      style={({ pressed }) => [styles.smallAct, disabled && !busy ? styles.dim : null, pressed && !isAndroid ? { opacity: 0.8 } : null]}
    >
      {busy ? <ActivityIndicator size="small" color={KOLA} /> : icon ? <Ionicons name={icon} size={14} color={KOLA} /> : null}
      <Type variant="captionStrong" style={styles.smallActText}>{busy && busyLabel ? busyLabel : label}</Type>
    </Pressable>
  );
}

/** A status as a word in its tone, with a dot that only reinforces it. */
export function ToneWord({ tone, label }: { tone: Tone; label: string }) {
  return (
    <View style={styles.toneWord}>
      <View style={[styles.dot, { backgroundColor: TONES[tone].rule }]} />
      <Type variant="captionStrong" numberOfLines={1} style={[styles.toneWordText, { color: TONES[tone].fg }]}>{label}</Type>
    </View>
  );
}

/** A whole list, in the sheet: a short summary, then every row in one panel. */
export function SheetList({ summary, children }: { summary?: string; children: ReactNode }) {
  return (
    <View style={styles.sheetBody}>
      {summary ? <Type variant="caption" style={styles.sheetSummary}>{summary}</Type> : null}
      <View style={styles.sheetList}>{children}</View>
    </View>
  );
}

/** Shaped like the page that will replace it, so nothing jumps when it arrives. */
export function BillingPageSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading your plan" accessibilityRole="progressbar" style={styles.skeleton}>
      <Panel style={styles.skeletonPanel}>
        <View style={styles.skeletonHead}>
          <Bone width={44} height={44} round={14} />
          <View style={styles.skeletonHeadText}>
            <Bone width="30%" height={11} />
            <Bone width="46%" height={20} />
          </View>
        </View>
        <Bone width="52%" height={32} />
        <Bone width="64%" />
        <Bone height={46} round={23} />
      </Panel>
      <Panel style={styles.skeletonPanel}>
        <Bone width="24%" height={11} />
        <Bone height={36} />
        <Bone height={36} />
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    overflow: "hidden",
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  viewAll: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  viewAllText: {
    fontSize: 14,
    lineHeight: 19,
    color: KOLA_DEEP,
  },
  fact: {
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  factText: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
  },
  factIcon: {
    marginTop: 2,
  },
  factLabel: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
  },
  factValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 14.5,
    lineHeight: 20,
    textAlign: "right",
    color: INK,
  },
  factAction: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  pill: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
  },
  pillPrimary: {
    backgroundColor: KOLA,
  },
  pillQuiet: {
    borderWidth: 1,
    borderColor: alpha(KOLA, 0.26),
    backgroundColor: theme.color.kola["50"],
  },
  pillText: {
    fontSize: 15,
    lineHeight: 20,
  },
  smallAct: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  dim: {
    opacity: 0.5,
  },
  smallActText: {
    fontSize: 13,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  toneWord: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  toneWordText: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  sheetBody: {
    gap: space[3],
    paddingTop: space[3],
    paddingBottom: space[5],
  },
  sheetSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  // A list in a sheet is the sheet's white card, borderless on the grey.
  sheetList: sheetCardStyle,
  skeleton: {
    gap: space[5],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
  skeletonHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  skeletonHeadText: {
    flex: 1,
    gap: space[2],
  },
});
