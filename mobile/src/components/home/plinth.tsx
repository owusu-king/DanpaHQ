import Ionicons from "@expo/vector-icons/Ionicons";
import { useId, type ReactNode } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Svg, { Defs, Rect, RadialGradient, Stop } from "react-native-svg";

import { Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";

/**
 * The design language both Home screens are drawn in.
 *
 * A soft mint canvas, white surfaces raised off it, generous radii and figures
 * set large — the same language the web dashboards use, recomposed for a phone.
 * The provider's Portfolio and the tenant's rentals are different subjects told
 * in one voice, so the voice lives here rather than twice.
 *
 * **This was a warm stone-and-gold register with drafting marks on it** —
 * registration ticks at a card's corners, a gold rule under every heading, a
 * gold tick register around the occupancy dial. It matched the web dashboards
 * exactly, and then the web moved to white-and-green and this did not, so the
 * two products stopped looking like one product. The values below are the web
 * surface's own, resolved from OKLCH to the hex React Native accepts, so a
 * screenshot of either platform's Home is the same design.
 *
 * The ground is only three percent off white now, where it used to be a full
 * shade of stone. That closes an old disagreement: this file used to hold a
 * *lighter* ground than the web sheet on the argument that a phone is held
 * closer, in worse light, and the desk contrast reads as white boxes cut out of
 * a dark page in the hand. At this separation that no longer applies, and both
 * platforms can hold the same value.
 *
 * The values stay local constants rather than tokens. `mobile/src/theme.ts` is
 * generated from `packages/design-tokens/tokens.json` with drift detection in
 * CI, and the same source compiles into the web stylesheet — promoting this
 * palette into it would repaint every other screen in both products, which is a
 * decision far larger than two dashboards. Where a Rooomly token already says
 * the same thing, it is used.
 */
export const ph = {
  /** The canvas. Barely tinted — enough for white to read as raised. */
  stone: "#F1F8F3",
  paper: "#FFFFFF",
  /** The ground of anything nested inside a surface: plates, tracks, tiles. */
  paperDim: "#F3FAF6",

  ink: "#0A110E",
  ink70: "rgba(10,17,14,0.70)",
  ink55: "rgba(10,17,14,0.55)",
  ink38: "rgba(10,17,14,0.38)",
  graphite: "#5C6661",

  brand: "#107550",
  brandSoft: "#E6F7ED",
  brandGlow: "#95E6BB",

  /* The two states that must stay legible beside a green product: money that is
     late, and work that is waiting. Neither can be the brand hue. */
  brick: "#B03B35",
  brickSoft: "#F7EBEB",
  amber: "#A46D1A",
  amberSoft: "#FFF0D6",
  amberStrong: "#C98F2E",

  line: "#E3E7E5",
  lineStrong: "#DBE1DE",
} as const;

/**
 * A fluid phone scale, bounded by the narrow Galaxy-class screen and the
 * larger modern-phone canvas. It changes measurements, never the composition.
 */
export function useHomeDensity() {
  const { width } = useWindowDimensions();
  const progress = Math.max(0, Math.min(1, (width - 320) / 110));
  const between = (small: number, large: number) =>
    Math.round((small + (large - small) * progress) * 10) / 10;

  return {
    compact: width <= 390,
    veryCompact: width < 350,
    pagePadding: between(14, 20),
    sectionGap: between(12, 16),
    cardPadding: between(14, 18),
    cardRadius: between(16, 20),
    headingSize: between(24, 30),
    headingLine: between(28, 34),
    labelSize: between(10.5, 12),
    ringSize: between(96, 116),
    chartHeight: between(108, 132),
  } as const;
}

export const surface = {
  backgroundColor: ph.paper,
  borderWidth: 1,
  borderColor: ph.line,
  borderRadius: 20,
  padding: space[4],
  /* Wide and low. A dashboard is a page of raised planes, and a tight dark
     shadow on eight of them turns into grime. */
  shadowColor: "#0A110E",
  shadowOpacity: 0.05,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
} as const;

/** The surfaces that carry a screen. Never more than two on one of them. */
export const primarySurface = {
  ...surface,
  shadowOpacity: 0.07,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
  /* The wash below is absolutely placed and has to stop at the corner. */
  overflow: "hidden",
} as const;

/**
 * The mark of a surface that leads the screen.
 *
 * Registration ticks used to do this job — two drafted corners on a card, the
 * one piece of blueprint language the design kept. They read as a technical
 * drawing rather than as a product, and they were the single thing that dated
 * both Home screens most.
 *
 * Light does it instead: a brand wash in the top corner, clipped to the card's
 * radius. It says "this one first" at a glance and costs no contrast anywhere
 * text actually sits. Rendered as an SVG gradient because React Native has no
 * CSS gradients, and as a `Rect` filling its own viewport so it scales with
 * whatever card it is dropped into.
 */
export function Wash({ height = 150 }: { height?: number }) {
  // A gradient is referenced by id, and a screen carries two of these. Native
  // gives each `Svg` its own document, but under react-native-web they land in
  // one — where a second `plinthWash` is a duplicate id. `useId` includes
  // colons, which are not valid in a `url(#…)` reference, so they come out.
  const gradientId = `wash${useId().replaceAll(":", "")}`;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, left: 0, height }}>
      <Svg width="100%" height={height}>
        <Defs>
          <RadialGradient id={gradientId} cx="100%" cy="0%" r="88%">
            <Stop offset="0%" stopColor={ph.brandGlow} stopOpacity={0.34} />
            <Stop offset="72%" stopColor={ph.brandGlow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={height} fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

/**
 * A row in a card's list.
 *
 * Separated by a hairline still, unlike the web, where a row reveals its own
 * bounds by filling on hover. A phone has no hover, and eight rows with a 36px
 * plate each and nothing between them read as one block with pictures in it.
 * The line is lighter than it was and the rows are taller, which is most of
 * what the web change was actually buying.
 */
export function plinthRow(first: boolean, compact = false) {
  return {
    flexDirection: "row",
    alignItems: "center",
    gap: compact ? space[3] : space[3],
    paddingVertical: compact ? 11 : 13,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: ph.line,
  } as const;
}

/** The plate a row's glyph sits in. Brand-tinted when the row means money in. */
export function tile(accent: boolean, compact = false) {
  const size = compact ? 34 : 36;
  return {
    width: size,
    height: size,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent ? ph.brandSoft : ph.paperDim,
  } as const;
}

/**
 * A state, as a pill.
 *
 * Green when there is nothing to do, amber when there is, brick when money is
 * late — and never red for a summary of ordinary work waiting, which is a false
 * alarm about a normal Tuesday.
 */
export function Pill({
  label,
  tone = "clear",
  compact = false,
}: {
  label: string;
  tone?: "clear" | "attention" | "late" | "quiet";
  compact?: boolean;
}) {
  const palette = {
    clear: { fg: ph.brand, bg: ph.brandSoft },
    attention: { fg: ph.amber, bg: ph.amberSoft },
    late: { fg: ph.brick, bg: ph.brickSoft },
    quiet: { fg: ph.graphite, bg: ph.paperDim },
  }[tone];

  return (
    <View
      style={{
        flexShrink: 1,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: compact ? 3 : 4,
        borderRadius: 999,
        backgroundColor: palette.bg,
      }}
    >
      <Type
        variant="caption"
        numberOfLines={1}
        style={{ fontSize: compact ? 10.5 : 11.5, lineHeight: 15, fontWeight: "600", color: palette.fg }}
      >
        {label}
      </Type>
    </View>
  );
}

/** A quiet card: title, an optional count, an optional way onward. */
export function PlinthCard({
  title,
  eyebrow,
  meta,
  action,
  children,
}: {
  title: string;
  /** Set when the card's subject needs naming above its own headline. */
  eyebrow?: string;
  meta?: string;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  const density = useHomeDensity();
  return (
    <View style={[surface, { padding: density.cardPadding, borderRadius: density.cardRadius }]}>
      <View style={{ flexDirection: "row", alignItems: eyebrow ? "flex-start" : "center", justifyContent: "space-between", gap: space[2], marginBottom: density.compact ? space[2] : space[3] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? (
            <Type variant="label" style={{ fontSize: density.compact ? 9.5 : 10.5, lineHeight: 14, letterSpacing: 0.9, color: ph.graphite }}>
              {eyebrow}
            </Type>
          ) : null}
          <Type variant="bodyStrong" style={{ fontSize: density.compact ? 14 : 15, lineHeight: 20, letterSpacing: -0.15, color: ph.ink }}>{title}</Type>
        </View>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={density.compact ? 6 : 4} {...pressableFeedback(ph.paperDim)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, fontWeight: "600", color: ph.graphite }}>{action.label}</Type>
              <Ionicons name="chevron-forward" size={density.compact ? 11 : 12} color={ph.graphite} />
            </View>
          </Pressable>
        ) : meta ? (
          <Pill label={meta} tone="quiet" compact={density.compact} />
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

/** A date, short. Tolerates both date-only strings and full stamps. */
export function shortDate(value: string) {
  const at = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(at.getTime())
    ? value
    : at.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}
