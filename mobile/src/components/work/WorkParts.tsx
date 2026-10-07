import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Line } from "react-native-svg";

import {
  FAINT,
  INK,
  KOLA_DEEP,
  MUTED,
  PRESSED,
  RULE,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Type, radius, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The parts of a work page (owner, 2026-10-06).
 *
 * Tenancy requests, agreements, viewings and updates used to be four copies of
 * one record index: a summary panel of counts, a Filter sheet, a search box and
 * rows of status words. They are now read as work — what waits on you, what is
 * moving, what is done — and these are the pieces that make that reading the
 * same on every one of them. What each page counts and says stays the page's own.
 */

export type BriefingPart = { text: string; tone: string; strong?: boolean };

/** One sentence about the reader's own work, then the facts that qualify it. */
export function Briefing({ title, figure, parts, trailing }: {
  title: string;
  /** A large figure above the sentence, where one number is the point. */
  figure?: string;
  parts: BriefingPart[];
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.briefing}>
      <View style={styles.briefingText}>
        {figure ? (
          <Type variant="display2" accessibilityRole="header" numberOfLines={1} style={styles.figure}>{figure}</Type>
        ) : null}
        <Type variant="title2" accessibilityRole={figure ? undefined : "header"} style={figure ? styles.figureLabel : styles.title}>{title}</Type>
        {parts.length ? (
          <Type variant="caption" style={styles.line}>
            {parts.map((part, index) => (
              <Type key={part.text} variant="caption" style={{ color: part.tone, fontWeight: part.strong ? "600" : "500" }}>
                {index ? " · " : ""}{part.text}
              </Type>
            ))}
          </Type>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/** A round tool beside the briefing: search, mostly. */
export function BriefingButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.roundButton, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Ionicons name={icon} size={18} color={KOLA_DEEP} />
    </Pressable>
  );
}

/** The step on a row: small, so a list of them never shouts. */
export function Act({ label, icon, primary = false, onPress }: { label: string; icon?: IconName; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      onPress={onPress}
      {...pressableFeedback(primary ? theme.color.kola["900"] : PRESSED)}
      style={({ pressed }) => [
        styles.act,
        primary ? styles.actPrimary : styles.actQuiet,
        pressed ? (primary ? { backgroundColor: theme.color.kola["900"] } : { backgroundColor: PRESSED }) : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={primary ? theme.color.field["0"] : KOLA_DEEP} /> : null}
      <Type variant="captionStrong" style={{ color: primary ? theme.color.field["0"] : KOLA_DEEP }}>{label}</Type>
    </Pressable>
  );
}

export function Acts({ children }: { children: ReactNode }) {
  return <View style={styles.acts}>{children}</View>;
}

/** The rest of a capped section, one tap away. */
export function MoreRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.more, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Type variant="captionStrong" style={{ color: KOLA_DEEP }}>{label}</Type>
      <Ionicons name="chevron-down" size={14} color={KOLA_DEEP} />
    </Pressable>
  );
}

/** Everything done, in one line until it is wanted. */
export function Fold({ title, summary, count, open, onToggle, icon = "archive-outline" }: {
  title: string;
  summary: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={open}
      accessibilityLabel={`${title}: ${count}. ${summary}.`}
      onPress={onToggle}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.fold, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Ionicons name={icon} size={16} color={MUTED} />
      <View style={styles.foldText}>
        <Type variant="bodyStrong" style={styles.foldTitle}>{title}</Type>
        <Type variant="caption" style={styles.foldSummary}>{summary}</Type>
      </View>
      <Type variant="captionStrong" style={{ color: MUTED }}>{count}</Type>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={MUTED} />
    </Pressable>
  );
}

/** Nothing waits on the reader: say so plainly, and let the rest follow. */
export function Calm({ text, icon = "checkmark" }: { text: string; icon?: IconName }) {
  return (
    <View style={styles.calm}>
      <View style={styles.calmMark}>
        <Ionicons name={icon} size={16} color={KOLA_DEEP} />
      </View>
      <Type variant="caption" style={styles.calmText}>{text}</Type>
    </View>
  );
}

/**
 * Progress as segments, one per step: done steps filled, the current one
 * half-lit, the rest a rule. Reads at a glance where a percentage would need
 * reading.
 */
export function Segments({ total, done, tone, current = true }: { total: number; done: number; tone: string; current?: boolean }) {
  return (
    <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[
            styles.segment,
            { backgroundColor: index < done ? tone : index === done && current ? `${tone}55` : RULE },
          ]}
        />
      ))}
    </View>
  );
}

/** A continuous bar: how far through something is — a term, a quarter, a day. */
export function Bar({ value, tone, track = RULE }: { value: number; tone: string; track?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={[styles.bar, { backgroundColor: track }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.barFill, { width: `${Math.max(clamped * 100, clamped > 0 ? 4 : 0)}%`, backgroundColor: tone }]} />
    </View>
  );
}

/** Initials on the colour of where a record stands. */
export function Face({ name, ink, wash, fresh = false }: { name: string; ink: string; wash: string; fresh?: boolean }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "?";
  return (
    <View style={[styles.face, { backgroundColor: wash }]}>
      <Type variant="captionStrong" style={[styles.faceText, { color: ink }]}>{letters}</Type>
      {fresh ? <View style={styles.freshDot} /> : null}
    </View>
  );
}

/** The empty-state line colour: laterite let down into field-200, as web's `.ws-state-mark`. */
export const EMPTY_CLAY = "#CC9B8B";
/** "All done" is good news, not an absence: kola let down the same way. */
const EMPTY_DONE = "#588E78";

/**
 * An empty or no-results state, the way the owner set it (2026-10-04) and web
 * already draws it: the page's own glyph, large and thin, on nothing — no disc,
 * no badge — in a soft clay line. An absence is struck through, with a gap the
 * colour of the ground so the stroke reads as cut, not drawn over. A tick is
 * never struck: "all done" says something is there.
 *
 * One action at most, as a single clear way on (`compact` drops the padding for
 * an empty day or section inside a page).
 */
export function Empty({ icon, title, hint, crossed = true, done = false, action, compact = false, ground = theme.color.field["50"] }: {
  icon: IconName;
  title: string;
  hint?: string;
  crossed?: boolean;
  done?: boolean;
  action?: ReactNode;
  compact?: boolean;
  /** What the strike's gap is cut from: the colour the state stands on. */
  ground?: string;
}) {
  const size = compact ? 40 : 56;
  const ink = done ? EMPTY_DONE : EMPTY_CLAY;
  const strike = crossed && !done;
  return (
    <View style={[styles.empty, compact ? styles.emptyCompact : null]}>
      <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name={icon} size={size} color={ink} />
        {strike ? (
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Line x1={size * 0.14} y1={size * 0.14} x2={size * 0.86} y2={size * 0.86} stroke={ground} strokeWidth={size * 0.11} strokeLinecap="round" />
            <Line x1={size * 0.14} y1={size * 0.14} x2={size * 0.86} y2={size * 0.86} stroke={ink} strokeWidth={size * 0.05} strokeLinecap="round" />
          </Svg>
        ) : null}
      </View>
      <Type variant="bodyStrong" accessibilityRole="header" style={styles.emptyTitle}>{title}</Type>
      {hint ? <Type variant="caption" style={styles.emptyHint}>{hint}</Type> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

/** "5d" quiet while it is fresh, a laterite chip once it has waited too long. */
export function Age({ text, late }: { text: string; late: boolean }) {
  return late ? (
    <View style={styles.late}>
      <Ionicons name="time-outline" size={11} color={theme.color.laterite["600"]} />
      <Type variant="captionStrong" style={styles.lateText}>{text}</Type>
    </View>
  ) : (
    <Type variant="caption" style={styles.age}>{text}</Type>
  );
}

const styles = StyleSheet.create({
  briefing: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
  },
  briefingText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: INK,
  },
  figure: {
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  figureLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
    color: MUTED,
  },
  line: {
    fontSize: 13.5,
    lineHeight: 19,
  },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["0"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
  },
  acts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[2],
  },
  act: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
  },
  actPrimary: {
    backgroundColor: theme.color.kola["800"],
  },
  actQuiet: {
    backgroundColor: theme.color.field["0"],
    borderWidth: 1,
    borderColor: theme.color.field["300"],
  },
  more: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  fold: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: theme.color.field["0"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
  },
  foldText: {
    flex: 1,
    minWidth: 0,
  },
  foldTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  foldSummary: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  calm: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: 14,
    marginBottom: space[2],
    borderRadius: 16,
    backgroundColor: theme.color.kola["50"],
  },
  calmMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["0"],
  },
  calmText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  segments: {
    flexDirection: "row",
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  bar: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 2,
  },
  face: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  faceText: {
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.3,
  },
  // New since the last visit: a kola dot on the face, ringed in paper.
  freshDot: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: theme.color.kola["600"],
    borderWidth: 2,
    borderColor: theme.color.field["0"],
  },
  empty: {
    alignItems: "center",
    gap: space[2],
    paddingTop: space[12],
    paddingBottom: space[8],
    paddingHorizontal: space[5],
  },
  emptyCompact: {
    paddingTop: space[5],
    paddingBottom: space[5],
  },
  emptyTitle: {
    marginTop: space[2],
    fontSize: 16,
    lineHeight: 21,
    color: theme.color.ink["700"],
    textAlign: "center",
  },
  emptyHint: {
    maxWidth: 300,
    fontSize: 14,
    lineHeight: 20,
    color: theme.color.ink["500"],
    textAlign: "center",
  },
  emptyAction: {
    marginTop: space[3],
  },
  late: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: theme.color.laterite["100"],
  },
  lateText: {
    fontSize: 11.5,
    lineHeight: 15,
    color: theme.color.laterite["600"],
  },
  age: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
});
