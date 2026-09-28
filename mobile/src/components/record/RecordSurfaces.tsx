import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  FAINT,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { sheetCardStyle, useInSheet } from "@/components/sheet/SheetParts";
import { Type, space } from "@/components/ui";
import { isAndroid, pressableFeedback, surfaceElevation } from "@/platform";
import { theme } from "@/theme";

/**
 * The surfaces a record stands on.
 *
 * The index pages stand on Rooomly's green, where a frosted-glass panel lifts
 * off the ground. A record — one viewing, one agreement, one person's access —
 * stands on the warm ivory every pushed screen has always used, and there the
 * same glass is nothing: 72% white over `field-50` lifts by about one percent.
 *
 * So a record's panel is paper on ivory, held by a warm hairline and, on iOS
 * only, the house's very subtle shadow. The vocabulary is deliberately the same
 * as `PortfolioList` — panel, fact, group label, a lead figure, one pill — so
 * the two halves of the app read as one product in two rooms.
 */

/** Paper, on the warm ground the pushed screens keep. */
export const PAPER = theme.color.field["0"];
export const GROUND = theme.color.field["50"];
/** A warm hairline, never a green-tinted one: this ground is ivory. */
export const EDGE = theme.color.field["200"];
export const PRESSED = theme.color.field["100"];
export const PANEL_RADIUS = 16;

export { FAINT, HARMATTAN, INK, KOLA, KOLA_DEEP, LATERITE, MUTED };

export type RecordTone = "action" | "waiting" | "good" | "quiet" | "alert";

/** What a tone is worth in words: its ink, and the wash a well takes. */
export const TONE: Record<RecordTone, { ink: string; wash: string }> = {
  action: { ink: KOLA_DEEP, wash: theme.color.kola["50"] },
  waiting: { ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  good: { ink: KOLA, wash: theme.color.kola["50"] },
  quiet: { ink: MUTED, wash: theme.color.field["100"] },
  alert: { ink: LATERITE, wash: theme.color.laterite["100"] },
};

/**
 * A record's one kind of surface: paper, held by a hairline. In a sheet it is the
 * sheet's white card instead, borderless on the grey.
 */
export function RecordPanel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const inSheet = useInSheet();
  return <View style={[styles.panel, inSheet ? sheetCardStyle : null, style]}>{children}</View>;
}

/** A section's name, standing on the ground rather than inside a panel. */
export function GroupLabel({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <View style={styles.groupLabelRow}>
      <Type variant="label" accessibilityRole="header" style={styles.groupLabel}>{children.toUpperCase()}</Type>
      {action}
    </View>
  );
}

/**
 * The one figure a record leads with.
 *
 * Every record has a single number or phrase that answers why somebody opened
 * it — what it costs, when it is, what is outstanding. It goes here, once.
 */
export function Lead({
  label,
  value,
  note,
  tone = "quiet",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: RecordTone;
}) {
  return (
    <View accessible accessibilityLabel={note ? `${label}, ${value}. ${note}.` : `${label}, ${value}`} style={styles.lead}>
      <Type variant="caption" style={styles.leadLabel}>{label}</Type>
      <Type variant="amountLg" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.leadValue}>
        {value}
      </Type>
      {note ? (
        <View style={styles.leadNote}>
          <View style={[styles.dot, { backgroundColor: TONE[tone].ink }]} />
          <Type variant="caption" numberOfLines={2} style={[styles.leadNoteText, { color: TONE[tone].ink }]}>{note}</Type>
        </View>
      ) : null}
    </View>
  );
}

/** Where something stands, as a dot and one line. Colour is never the only cue. */
export function StandingLine({ line, tone = "quiet" }: { line: string; tone?: RecordTone }) {
  const strong = tone === "action" || tone === "alert";
  return (
    <View accessible accessibilityLabel={line} style={styles.standing}>
      <View style={[styles.dot, { backgroundColor: TONE[tone].ink }]} />
      <Type
        variant={strong ? "captionStrong" : "caption"}
        numberOfLines={2}
        style={[styles.standingText, { color: TONE[tone].ink }]}
      >
        {line}
      </Type>
    </View>
  );
}

/**
 * One fact: what it is on the left, what it says on the right.
 *
 * The right never gives way, so an amount or a date is never cut in half; the
 * label takes whatever width is left.
 */
export function Fact({
  label,
  value,
  first = false,
  tone,
  action,
  wide = false,
}: {
  label: string;
  value: string;
  first?: boolean;
  tone?: RecordTone;
  action?: ReactNode;
  /**
   * For a sentence rather than a value.
   *
   * A date or an amount belongs on the right, where the eye runs down a column
   * of them. Prose right-aligned over two ragged lines reads as a mistake, so
   * it sits under its label and takes the width.
   */
  wide?: boolean;
}) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.fact, first ? null : styles.ruled]}>
      {wide ? (
        <View style={styles.factStack}>
          <Type variant="caption" style={styles.factLabel}>{label}</Type>
          <Type variant="body" style={[styles.factProse, tone ? { color: TONE[tone].ink } : null]}>{value}</Type>
        </View>
      ) : (
        <View style={styles.factLine}>
          <Type variant="caption" style={styles.factLabel}>{label}</Type>
          <Type
            variant="bodyStrong"
            numberOfLines={2}
            style={[styles.factValue, tone ? { color: TONE[tone].ink } : null]}
          >
            {value}
          </Type>
        </View>
      )}
      {action ? <View style={styles.factAction}>{action}</View> : null}
    </View>
  );
}

/** A row that goes somewhere: a well, what it is, and the chevron that says so. */
export function LinkRow({
  icon,
  label,
  detail,
  tone = "quiet",
  first = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  tone?: RecordTone;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={detail ? `${label}. ${detail}.` : label}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [
        styles.linkRow,
        first ? null : styles.ruled,
        pressed && !isAndroid ? { backgroundColor: PRESSED } : null,
      ]}
    >
      <View style={[styles.well, { backgroundColor: TONE[tone].wash }]}>
        <Ionicons name={icon} size={16} color={TONE[tone].ink} />
      </View>
      <View style={styles.linkBody}>
        {/* A 320pt handset leaves this about 188 points, which is short of
            "Verification and publication". A row's own name wraps rather than
            being cut — the detail under it is what may be abbreviated. */}
        <Type variant="bodyStrong" numberOfLines={2} style={styles.linkLabel}>{label}</Type>
        {detail ? <Type variant="caption" numberOfLines={2} style={styles.linkDetail}>{detail}</Type> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.color.ink["300"]} style={styles.linkChevron} />
    </Pressable>
  );
}

/**
 * The act a record is about.
 *
 * One to a decision. Everything quieter is a `QuietAct`, and a stack of these
 * is the shape this redesign exists to remove.
 */
export function Pill({
  label,
  icon,
  tone = "primary",
  busy = false,
  busyLabel,
  disabled = false,
  grow = false,
  onPress,
}: {
  label: string;
  icon?: IconName;
  tone?: "primary" | "quiet" | "danger";
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  /** Fill the bar it sits in, when it is the only thing in it. */
  grow?: boolean;
  onPress: () => void;
}) {
  const ink = tone === "primary" ? theme.color.field["0"] : tone === "danger" ? LATERITE : KOLA_DEEP;
  const inert = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy && busyLabel ? busyLabel : label}
      aria-busy={busy} aria-disabled={inert}
      disabled={inert}
      onPress={onPress}
      {...pressableFeedback(tone === "primary" ? theme.color.kola["800"] : PRESSED)}
      style={({ pressed }) => [
        styles.pill,
        grow ? styles.pillGrow : null,
        tone === "primary" ? styles.pillPrimary : tone === "danger" ? styles.pillDanger : styles.pillQuiet,
        inert ? styles.dim : null,
        pressed && !isAndroid ? { opacity: 0.85 } : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={ink} />
      ) : icon ? (
        <Ionicons name={icon} size={17} color={ink} />
      ) : null}
      <Type variant="bodyStrong" numberOfLines={1} style={[styles.pillText, { color: ink }]}>
        {busy && busyLabel ? busyLabel : label}
      </Type>
    </Pressable>
  );
}

/** A small act beside something: kola words, no furniture. */
export function QuietAct({
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
  /** When the visible word is short because its row already says the rest. */
  accessibilityLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const inert = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (busy && busyLabel ? busyLabel : label)}
      aria-busy={busy} aria-disabled={inert}
      disabled={inert}
      hitSlop={space[2]}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.quietAct, inert ? styles.dim : null, pressed && !isAndroid ? { opacity: 0.72 } : null]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={KOLA_DEEP} />
      ) : icon ? (
        <Ionicons name={icon} size={15} color={KOLA_DEEP} />
      ) : null}
      <Type variant="captionStrong" style={styles.quietActText}>{busy && busyLabel ? busyLabel : label}</Type>
    </Pressable>
  );
}

/**
 * The decisions, pinned where a thumb is.
 *
 * A record that exists to be answered keeps its answer reachable without
 * scrolling back — and off the page's reading order, so the reading is not
 * interrupted by a button every third paragraph.
 */
export function ActionBar({ children, note }: { children: ReactNode; note?: string }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // On the narrowest handsets a pill beside a quiet act squeezes the pill until
  // its own label is cut. The bar stacks instead: nothing here is abbreviated.
  const narrow = width < 360;
  return (
    <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
      {note ? <Type variant="caption" numberOfLines={2} style={styles.actionNote}>{note}</Type> : null}
      <View style={[styles.actionRow, narrow ? styles.actionColumn : null]}>{children}</View>
    </View>
  );
}

/** Somebody's own words, kept as theirs. */
export function Quote({ children }: { children: string }) {
  return (
    <View style={styles.quote}>
      <Type variant="body" style={styles.quoteText}>{children}</Type>
    </View>
  );
}

/** The quietest line on the page: what somebody should know, not be told. */
export function Footnote({ children }: { children: ReactNode }) {
  return <Type variant="caption" style={styles.footnote}>{children}</Type>;
}

const styles = StyleSheet.create({
  panel: {
    overflow: "hidden",
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: PAPER,
    ...surfaceElevation,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  groupLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: 2,
  },
  groupLabel: {
    letterSpacing: 0.6,
    color: alphaInk(0.62),
  },
  lead: {
    gap: 2,
    padding: space[4],
  },
  leadLabel: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  leadValue: {
    color: INK,
  },
  leadNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginTop: space[1],
  },
  leadNoteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  standing: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  standingText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  fact: {
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  factLine: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[4],
  },
  factStack: {
    gap: 2,
  },
  factProse: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
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
  linkRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  well: {
    width: 32,
    height: 32,
    marginTop: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  linkBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  linkLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  linkDetail: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  linkChevron: {
    marginTop: 9,
  },
  pill: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    borderRadius: 24,
    borderWidth: 1,
  },
  pillGrow: {
    flex: 1,
  },
  pillPrimary: {
    borderColor: KOLA,
    backgroundColor: KOLA,
  },
  pillQuiet: {
    borderColor: EDGE,
    backgroundColor: PAPER,
  },
  pillDanger: {
    borderColor: theme.color.laterite["100"],
    backgroundColor: theme.color.laterite["100"],
  },
  pillText: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 20,
  },
  quietAct: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: 2,
  },
  quietActText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  dim: {
    opacity: 0.55,
  },
  actionBar: {
    gap: space[2],
    paddingTop: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
    backgroundColor: PAPER,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  actionColumn: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  actionNote: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  quote: {
    gap: space[1],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.field["300"],
    backgroundColor: theme.color.field["100"],
  },
  quoteText: {
    fontSize: 14.5,
    lineHeight: 21,
    color: theme.color.ink["700"],
  },
  footnote: {
    fontSize: 12.5,
    lineHeight: 17,
    color: FAINT,
  },
});

/** Ink at an opacity, for the one label that must sit under everything else. */
function alphaInk(opacity: number) {
  const value = Number.parseInt(INK.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}
