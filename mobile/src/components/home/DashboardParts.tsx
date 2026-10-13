import Ionicons from "@expo/vector-icons/Ionicons";
import { Fragment, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { surface, useHomeDensity } from "@/components/home/plinth";
import { Type, radius, space } from "@/components/ui";
import { Act, Empty } from "@/components/work/WorkParts";
import { isAndroid, pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * What both Homes are made of (owner, 2026-10-06).
 *
 * The provider's dashboard was rebuilt first and the tenant's followed; the
 * parts they share live here so the two cannot drift — the white card, the
 * section heading on the ground, the next-move card, the ring, the line of
 * counts, the highlight cards with their corner arc, and the list rows.
 */

export type IconName = keyof typeof Ionicons.glyphMap;

export const WHITE = theme.color.field["0"];
export const INK = theme.color.ink["900"];
export const MUTED = theme.color.ink["500"];
export const KOLA = theme.color.kola["600"];
export const KOLA_DEEP = theme.color.kola["800"];
export const RULE = alpha(theme.color.kola["900"], 0.08);
export const PRESSED = alpha(theme.color.kola["900"], 0.05);

/** Where a thing stands, as an ink and the wash it sits on. */
export const TONE = {
  danger: { ink: theme.color.laterite["600"], wash: theme.color.laterite["100"] },
  warning: { ink: theme.color.harmattan["600"], wash: theme.color.harmattan["100"] },
  calm: { ink: theme.color.kola["600"], wash: theme.color.kola["50"] },
  kola: { ink: theme.color.kola["600"], wash: theme.color.kola["50"] },
  harmattan: { ink: theme.color.harmattan["600"], wash: theme.color.harmattan["100"] },
  laterite: { ink: theme.color.laterite["600"], wash: theme.color.laterite["100"] },
  lagoon: { ink: theme.color.lagoon["600"], wash: theme.color.lagoon["100"] },
  ink: { ink: theme.color.ink["700"], wash: theme.color.field["100"] },
} as const;

export type ToneName = keyof typeof TONE;

/** The rest of a ring, in the colour it has elsewhere. */
export const RING_EMPTY = alpha(theme.color.laterite["600"], 0.28);
export const RING_OWED = alpha(theme.color.harmattan["500"], 0.42);
/** A ring with nothing to measure: a faint dashed outline. */
export const RING_NONE = alpha(theme.color.kola["900"], 0.22);

/** A section's name on the ground, with a count or a way to the whole list beside it. */
export function Section({
  title,
  meta,
  link,
  children,
}: {
  title: string;
  meta?: string;
  link?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space[3] }}>
      <View style={dash.sectionHead}>
        <Type variant="title2" accessibilityRole="header" style={dash.sectionTitle}>{title}</Type>
        {meta ? <Type variant="caption" style={{ color: MUTED }}>{meta}</Type> : null}
        <View style={{ flex: 1 }} />
        {link ? (
          <Pressable accessibilityRole="link" onPress={link.onPress} hitSlop={8} style={dash.sectionLink}>
            <Type variant="captionStrong" style={{ color: KOLA_DEEP }}>{link.label}</Type>
            <Ionicons name="chevron-forward" size={14} color={KOLA_DEEP} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A glyph on its tint, the one way a Home marks what kind of thing a row is. */
export function Well({ icon, tone, size = 36 }: { icon: IconName; tone: ToneName; size?: number }) {
  return (
    <View style={[dash.well, { width: size, height: size, borderRadius: size / 2, backgroundColor: TONE[tone].wash }]}>
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={TONE[tone].ink} />
    </View>
  );
}

/** Money late or an agreement waiting, then what someone is waiting on, then what can wait. */
export type MoveTone = "danger" | "warning" | "calm";

export type Move = {
  key: string;
  /** What is waiting, as a fact. */
  title: string;
  /** Where, when there could be more than one. */
  detail?: string;
  /** The verb for the button when this move leads. */
  act: string;
  icon: IconName;
  tone: MoveTone;
  onPress: () => void;
};

export function urgency(tone: MoveTone) {
  return tone === "danger" ? "Act now" : tone === "warning" ? "Someone is waiting" : "When you can";
}

/**
 * What to do next. The costliest move leads, with its verb as the one solid
 * button on the page; the rest are rows under it, each in its own colour, so a
 * late payment never reads like an unread message.
 */
export function NextMoves({ moves, calm }: { moves: Move[]; calm: { title: string; hint: string } }) {
  const [lead, ...rest] = moves;
  if (!lead) {
    return (
      <View style={dash.card}>
        <Empty icon="checkmark-done-outline" title={calm.title} hint={calm.hint} crossed={false} done compact ground={WHITE} />
      </View>
    );
  }
  return (
    <View style={dash.card}>
      <View style={dash.leadRow}>
        <Well icon={lead.icon} tone={lead.tone} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Type variant="captionStrong" style={{ color: TONE[lead.tone].ink }}>{urgency(lead.tone)}</Type>
          <Type variant="bodyStrong" style={dash.leadTitle}>{lead.title}</Type>
          {lead.detail ? <Type variant="caption" numberOfLines={1} style={dash.rowLine}>{lead.detail}</Type> : null}
        </View>
      </View>
      <View style={{ marginTop: space[3], flexDirection: "row" }}>
        <Act label={lead.act} primary onPress={lead.onPress} />
      </View>
      {rest.length ? <View style={[dash.rule, { marginLeft: 0, marginTop: space[4] }]} /> : null}
      {rest.map((move, index) => (
        <Fragment key={move.key}>
          {index ? <View style={dash.rule} /> : null}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${move.title}.${move.detail ? ` ${move.detail}.` : ""} ${move.act}.`}
            onPress={move.onPress}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [dash.moveRow, pressed ? { backgroundColor: PRESSED } : null]}
          >
            <Well icon={move.icon} tone={move.tone} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Type variant="body" numberOfLines={2} style={dash.moveTitle}>{move.title}</Type>
              {move.detail ? <Type variant="caption" numberOfLines={1} style={dash.rowLine}>{move.detail}</Type> : null}
            </View>
            {move.tone === "danger" ? <View style={[dash.flag, { backgroundColor: TONE.danger.ink }]} /> : null}
            <Ionicons name="chevron-forward" size={16} color={theme.color.ink["300"]} />
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

/**
 * One ring: what is done in green, the rest as its own softer arc with a gap
 * between them, the share in the middle, and a title and line under it.
 * Holding it shows the figures behind the share; a phone has no hover, so the
 * press is the gesture.
 *
 * With nothing to measure (`share` null) it is a faint dashed outline with
 * its words muted, and holding it does nothing: there are no figures behind it.
 */
export function Ring({
  share: raw,
  rest,
  figure,
  unit,
  heldFigure = "",
  heldUnit = "",
  title,
  line,
}: {
  share: number | null;
  /** The colour of what is not done yet. */
  rest: string;
  figure: string;
  unit: string;
  /** What holding the ring shows instead. */
  heldFigure?: string;
  heldUnit?: string;
  title: string;
  line: string;
}) {
  const density = useHomeDensity();
  const [showCount, setShowCount] = useState(false);
  const empty = raw === null;
  const share = empty ? 0 : Math.max(0, Math.min(1, raw));
  const size = density.ringSize;
  const stroke = density.compact ? 9 : 11;
  const ringRadius = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * ringRadius;
  const centre = size / 2;
  // Round caps reach past an arc's ends, so the gap is measured to clear them.
  const gap = share > 0 && share < 1 ? stroke + 5 : 0;
  const doneLength = Math.max(0, circumference * share - gap / 2);
  const restLength = Math.max(0, circumference * (1 - share) - gap / 2);
  const turn = `rotate(-90 ${centre} ${centre})`;

  return (
    <View style={dash.ring}>
      <Pressable
        onPressIn={() => setShowCount(true)}
        onPressOut={() => setShowCount(false)}
        disabled={empty}
        accessibilityRole="summary"
        accessibilityLabel={`${title}: ${figure} ${unit}. ${line}.`}
        accessibilityHint={empty ? undefined : "Hold to see the figures"}
        style={{ width: size, height: size }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {empty ? (
            <Circle cx={centre} cy={centre} r={ringRadius} fill="none" stroke={RING_NONE} strokeWidth={2} strokeDasharray="3 6" strokeLinecap="round" />
          ) : (
            <Circle cx={centre} cy={centre} r={ringRadius} fill="none" stroke={theme.color.kola["50"]} strokeWidth={stroke} />
          )}
          {restLength > 0 && !empty ? (
            <Circle
              cx={centre}
              cy={centre}
              r={ringRadius}
              fill="none"
              stroke={rest}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${restLength} ${circumference}`}
              strokeDashoffset={-(doneLength + gap)}
              transform={turn}
            />
          ) : null}
          {doneLength > 0 ? (
            <Circle
              cx={centre}
              cy={centre}
              r={ringRadius}
              fill="none"
              stroke={KOLA}
              strokeWidth={showCount ? stroke + 2 : stroke}
              strokeLinecap="round"
              strokeDasharray={`${doneLength} ${circumference}`}
              transform={turn}
            />
          ) : null}
        </Svg>
        <View pointerEvents="none" style={dash.ringCentre}>
          <Type
            variant="display2"
            numberOfLines={1}
            style={[dash.ringFigure, empty ? dash.ringFigureNone : null, showCount ? dash.ringFigureHeld : null, density.compact && !showCount && !empty ? { fontSize: 24, lineHeight: 28 } : null]}
          >
            {showCount ? heldFigure : figure}
          </Type>
          <Type variant="caption" numberOfLines={1} style={dash.ringLabel}>{showCount ? heldUnit : unit}</Type>
        </View>
      </Pressable>
      <View style={{ alignItems: "center" }}>
        <Type variant="bodyStrong" numberOfLines={1} style={dash.ringTitle}>{title}</Type>
        <Type variant="caption" numberOfLines={1} style={dash.ringLine}>{line}</Type>
      </View>
    </View>
  );
}

/** Rings side by side. */
export function Rings({ children }: { children: ReactNode }) {
  return <View style={dash.rings}>{children}</View>;
}

/** The counts on one straight line, under the rings. */
export function StatCells({ children }: { children: ReactNode }) {
  return <View style={dash.cells}>{children}</View>;
}

export function CellRule() {
  return <View style={dash.cellRule} />;
}

/** One count on the line; it opens its list. */
export function Cell({ label, value, onPress, alert = false }: { label: string; value: number; onPress: () => void; alert?: boolean }) {
  // Four across a 320px phone only fit when the names step down a little.
  const narrow = useHomeDensity().veryCompact;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${value} ${label}`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [dash.cell, narrow ? { paddingHorizontal: 4 } : null, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Type variant="amount" style={[dash.cellValue, alert ? { color: TONE.danger.ink } : null]}>{value}</Type>
      <Type variant="caption" numberOfLines={1} style={[dash.cellLabel, narrow ? { fontSize: 10.5, letterSpacing: -0.1 } : null]}>{label}</Type>
    </Pressable>
  );
}

export type Highlight = {
  key: string;
  icon: IconName;
  tone: "kola" | "laterite" | "harmattan" | "lagoon";
  headline: string;
  line: string;
  act: string;
  /** What the card's corner arc draws, from 0 to 1. */
  share: number;
  /** A word or two in the corner pill. */
  tag: string;
  onPress: () => void;
};

/**
 * Readings worth acting on, side by side and swiped. Each says what is true,
 * what follows from it, and where to act; its corner arc draws the reading.
 */
export function Highlights({ items }: { items: Highlight[] }) {
  const density = useHomeDensity();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(280, Math.round((width - density.pagePadding * 2) * 0.8));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToInterval={cardWidth + space[3]}
      style={{ marginHorizontal: -density.pagePadding, marginVertical: -6 }}
      contentContainerStyle={{ gap: space[3], paddingHorizontal: density.pagePadding, paddingVertical: 6 }}
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="link"
          accessibilityLabel={`${item.headline}. ${item.line} ${item.act}.`}
          onPress={item.onPress}
          {...pressableFeedback(PRESSED)}
          style={({ pressed }) => [dash.card, dash.insight, { width: cardWidth }, pressed ? { opacity: 0.9 } : null]}
        >
          <CornerArc share={item.share} ink={TONE[item.tone].ink} narrow={cardWidth < 250} />
          <View style={dash.insightTop}>
            <Type variant="bodyStrong" numberOfLines={2} style={dash.insightHeadline}>{item.headline}</Type>
            <View style={[dash.insightTag, { backgroundColor: TONE[item.tone].wash }]}>
              <Ionicons name={item.icon} size={12} color={TONE[item.tone].ink} />
              <Type variant="captionStrong" numberOfLines={1} style={[dash.insightTagText, { color: TONE[item.tone].ink }]}>{item.tag}</Type>
            </View>
          </View>
          <Type variant="caption" numberOfLines={2} style={dash.insightLine}>{item.line}</Type>
          <View style={{ flex: 1 }} />
          <View style={[dash.insightButton, { backgroundColor: TONE[item.tone].ink }]}>
            <Type variant="captionStrong" style={dash.insightButtonText}>{item.act}</Type>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/**
 * A highlight's corner: a wide arc rising out of the bottom-right, a pale
 * track with the card's share drawn along it in its colour and a knob where it
 * ends. Decoration that is also the reading.
 */
export function CornerArc({ share: raw, ink, narrow = false }: { share: number; ink: string; narrow?: boolean }) {
  const share = Math.max(0, Math.min(1, raw));
  const width = 200;
  const height = 120;
  const cx = 170;
  const cy = 190;
  const r = 120;
  const stroke = 20;
  // The share is drawn along the part of the circle the card shows; the
  // track carries on past the right edge, so the ring reads as larger than the card.
  const from = (-136 * Math.PI) / 180;
  const full = (-78 * Math.PI) / 180;
  const beyond = (-38 * Math.PI) / 180;
  const at = (angle: number) => ({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  const arc = (end: number) => {
    const start = at(from);
    const stop = at(end);
    return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${stop.x} ${stop.y}`;
  };
  const end = from + (full - from) * share;
  const knob = at(end);
  return (
    // On a narrow card the arc sits further into the corner, clear of the button.
    <View pointerEvents="none" style={[dash.cornerArc, narrow ? { right: -44, bottom: -14 } : null]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        <Path d={arc(beyond)} stroke={theme.color.field["100"]} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        {share > 0 ? <Path d={arc(end)} stroke={ink} strokeWidth={stroke} strokeLinecap="round" fill="none" /> : null}
        {share > 0 ? <Circle cx={knob.x} cy={knob.y} r={stroke * 0.72} fill={ink} stroke={WHITE} strokeWidth={3} /> : null}
      </Svg>
    </View>
  );
}

/** A day on a tile, for a dated row. */
export function DayTile({ at, tone = "lagoon" }: { at: Date; tone?: ToneName }) {
  return (
    <View style={[dash.dayTile, { backgroundColor: TONE[tone].wash }]}>
      <Type variant="captionStrong" style={[dash.dayNumber, { color: TONE[tone].ink }]}>{at.getDate()}</Type>
      <Type variant="caption" style={[dash.dayMonth, { color: TONE[tone].ink }]}>{at.toLocaleDateString("en-GH", { month: "short" })}</Type>
    </View>
  );
}

export type ActivityRow = {
  id: string;
  title: string;
  line: string;
  icon: IconName;
  tone: ToneName;
  /** Already worded: "Yesterday", "3 days ago". */
  when: string;
  /** For a payment, where it stands. */
  status: string | null;
};

/** One thing that happened: what kind it was, who or what, when, and where it stands. */
export function ActivityItem({ row }: { row: ActivityRow }) {
  return (
    <View style={dash.listRow} accessible accessibilityLabel={`${row.title}. ${row.line}. ${row.status ? `${row.status}. ` : ""}${row.when}.`}>
      <Well icon={row.icon} tone={row.tone} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Type variant="body" numberOfLines={2} style={dash.rowTitle}>{row.title}</Type>
        {row.line ? <Type variant="caption" numberOfLines={1} style={dash.rowLine}>{row.line}</Type> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Type variant="caption" style={dash.when}>{row.when}</Type>
        {row.status ? (
          <View style={[dash.chip, { backgroundColor: TONE[row.tone].wash }]}>
            <Type variant="captionStrong" style={[dash.chipText, { color: TONE[row.tone].ink }]}>{row.status}</Type>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Rows in one card, with a hairline between them. */
export function CardList({ children }: { children: ReactNode[] }) {
  return (
    <View style={dash.card}>
      {children.map((child, index) => (
        <Fragment key={index}>
          {index ? <View style={dash.rule} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

export const dash = StyleSheet.create({
  // Every card on Home is this one: white, a hairline of the ground's green, a
  // whisper of shadow, and the same corners as the work pages.
  card: {
    ...surface,
    borderRadius: 20,
    padding: 16,
    ...(isAndroid ? { elevation: 0 } : null),
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 48,
    backgroundColor: RULE,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
    paddingHorizontal: space[1],
  },
  sectionTitle: {
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: INK,
  },
  sectionLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  well: {
    alignItems: "center",
    justifyContent: "center",
  },
  leadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  leadTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: INK,
  },
  moveRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
  },
  moveTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  flag: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  rings: {
    flexDirection: "row",
    justifyContent: "space-around",
    gap: space[3],
  },
  ring: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: space[2],
  },
  ringCentre: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  ringFigure: {
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.6,
    color: INK,
  },
  ringFigureNone: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0,
    color: MUTED,
  },
  ringFigureHeld: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  ringLabel: {
    fontSize: 11.5,
    lineHeight: 15,
    color: MUTED,
  },
  ringTitle: {
    fontSize: 14.5,
    lineHeight: 19,
    color: INK,
  },
  ringLine: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  cells: {
    flexDirection: "row",
    marginTop: space[4],
    marginHorizontal: -8,
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  cellRule: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 8,
    backgroundColor: RULE,
  },
  cellValue: {
    fontSize: 18,
    lineHeight: 24,
    color: INK,
  },
  cellLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  insight: {
    gap: 6,
    minHeight: 176,
    overflow: "hidden",
  },
  insightTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
  },
  insightTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  insightTagText: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  insightButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
  },
  insightButtonText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: WHITE,
  },
  cornerArc: {
    position: "absolute",
    right: 0,
    bottom: 0,
    opacity: 0.15,
  },
  insightHeadline: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 21,
    color: INK,
  },
  insightLine: {
    maxWidth: "72%",
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  listRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  rowLine: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  dayTile: {
    width: 36,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNumber: {
    fontSize: 15,
    lineHeight: 18,
  },
  dayMonth: {
    fontSize: 10.5,
    lineHeight: 13,
  },
  when: {
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: 11.5,
    lineHeight: 15,
  },
});
