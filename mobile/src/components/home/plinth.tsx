import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import { Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";

/**
 * The design language both Home screens are drawn in.
 *
 * Warm stone ground, paper surfaces, an architectural register — the same
 * language the web dashboards use, recomposed for a phone. The provider's
 * Portfolio and the tenant's rentals are different subjects told in one voice,
 * so the voice lives here rather than twice.
 *
 * The values are local constants rather than tokens. `mobile/src/theme.ts` is
 * generated from `packages/design-tokens/tokens.json` with drift detection in
 * CI, and the same source compiles into the web stylesheet: promoting one
 * screen's palette into it would repaint both products. Where a Rooomly token
 * already says the same thing, it is used.
 */
export const ph = {
  // Lighter ground and warmer paper than the web sheet uses. A phone is held
  // closer, in worse light, and the contrast that reads as two planes on a
  // desk reads as a dark page with white boxes cut out of it in the hand.
  stone: "#E9E3D6",
  paper: "#F6F3EA",
  paperDim: "#EFEBE0",
  ink: "#181611",
  ink70: "rgba(24,22,17,0.70)",
  ink55: "rgba(24,22,17,0.55)",
  ink38: "rgba(24,22,17,0.38)",
  line: "rgba(24,22,17,0.09)",
  lineStrong: "rgba(24,22,17,0.14)",
  graphite: "#6E6A5C",
  gold: "#9C7A38",
  goldSoft: "#DCC694",
  goldStrong: "#C99A46",
  brand: "#4B6F55",
  sage: "#54634F",
  greenSoft: "#DEE7DD",
  brick: "#A8483A",
  brickSoft: "#F1E0DB",
  amber: "#A97A2D",
  amberSoft: "#F1E6D2",
  navy: "#1B2430",
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
    cardPadding: between(12, 16),
    headingSize: between(22, 27),
    headingLine: between(27, 32),
    labelSize: between(10.5, 12),
    ringSize: between(92, 112),
    chartHeight: between(108, 132),
  } as const;
}

export const surface = {
  backgroundColor: ph.paper,
  borderWidth: 1,
  borderColor: ph.line,
  borderRadius: 16,
  padding: space[4],
} as const;

/** The surfaces that carry a screen. Never more than two on one of them. */
export const primarySurface = {
  ...surface,
  borderColor: ph.lineStrong,
  shadowColor: "#181611",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

export function plinthRow(first: boolean, compact = false) {
  return {
    flexDirection: "row",
    alignItems: "center",
    gap: compact ? space[2] : space[3],
    paddingVertical: compact ? 9 : space[3],
    borderTopWidth: first ? 0 : 1,
    borderTopColor: ph.line,
  } as const;
}

/** The small square a row's glyph sits in. Accented when it means money in. */
export function tile(accent: boolean, compact = false) {
  const size = compact ? 27 : 30;
  return {
    width: size,
    height: size,
    borderRadius: compact ? 7 : 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent ? ph.greenSoft : ph.paperDim,
    borderWidth: accent ? 0 : 1,
    borderColor: ph.line,
  } as const;
}

/**
 * Registration ticks, at opposite corners.
 *
 * The one piece of drafting language that marks a surface as primary. Two
 * absolutely placed corners rather than a border, so they read as marks on a
 * drawing instead of as decoration around a box.
 */
export function Ticks() {
  const corner = { position: "absolute", width: 9, height: 9, borderColor: ph.ink38 } as const;
  return (
    <>
      <View pointerEvents="none" style={{ ...corner, top: 12, left: 12, borderTopWidth: 1.2, borderLeftWidth: 1.2 }} />
      <View pointerEvents="none" style={{ ...corner, right: 12, bottom: 12, borderBottomWidth: 1.2, borderRightWidth: 1.2 }} />
    </>
  );
}

/**
 * A measured rule: gold establishes the register, graphite carries it out.
 *
 * The page's one repeated ornament, and the thing that ties a heading to the
 * calibrated instruments under it.
 */
export function Register({
  width = 22,
  height = 1.5,
  gap = 0,
}: {
  width?: number;
  height?: number;
  gap?: number;
}) {
  return (
    <View pointerEvents="none" style={{ flexDirection: "row", alignItems: "center", marginTop: gap }}>
      <View style={{ width, height, backgroundColor: ph.gold }} />
      <View style={{ flex: 1, height: 1, backgroundColor: ph.line }} />
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
    <View style={[surface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16 }]}>
      <View style={{ flexDirection: "row", alignItems: eyebrow ? "flex-start" : "baseline", justifyContent: "space-between", gap: space[2], marginBottom: density.compact ? space[1] : space[2] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? (
            <Type variant="label" style={{ fontSize: density.compact ? 9.5 : 10.5, lineHeight: 13, color: ph.ink38 }}>
              {eyebrow}
            </Type>
          ) : null}
          <Type variant="bodyStrong" style={{ fontSize: density.compact ? 13 : 14, lineHeight: 19, color: ph.ink }}>{title}</Type>
        </View>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={density.compact ? 6 : 4} {...pressableFeedback(ph.paperDim)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, fontWeight: "500", color: ph.graphite }}>{action.label}</Type>
              <Ionicons name="chevron-forward" size={density.compact ? 11 : 12} color={ph.graphite} />
            </View>
          </Pressable>
        ) : meta ? (
          <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, color: ph.ink38 }}>{meta}</Type>
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
