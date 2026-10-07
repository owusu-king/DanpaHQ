import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { ph, useHomeDensity } from "@/components/home/plinth";
import { TONE } from "@/components/services/ServiceGlyph";
import { Type, radius, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/**
 * What both More screens are made of: the page, its groups, their rows, and the
 * two acts at its foot.
 *
 * A provider's index is their More and a tenant's is theirs. What they list
 * legitimately differs — a tenant has no Team and no Archive; a provider has no
 * rental history — but they were built twice and had to be kept in step by hand,
 * which is how the two drifted apart in the first place. The membership belongs
 * to each screen; the look does not.
 *
 * A row names its destination and nothing else. `Security ›` is complete.
 *
 * The look is soft glass (product owner review, 2026-09-14). The hairline lists
 * on a bare page read as flat, so each group is now one frosted panel — never a
 * card per row — on a page the chrome's green reaches into. A group's glyphs share
 * one of the colours Services already sorts by, which gives the page a rhythm a
 * thumb can follow before it reads a word.
 */

type Tone = keyof typeof TONE;

const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];

/** Frosted glass: the ground shows through, and a line in its own green settles it. */
const GLASS = alpha(WHITE, 0.72);
const GLASS_EDGE = alpha(DEEP, 0.08);
/** Between rows, where a press lands, and the ripple that answers one on Android. */
const RULE = alpha(DEEP, 0.08);
const PRESSED = alpha(DEEP, 0.05);
const RIPPLE = alpha(theme.color.kola["600"], 0.12);
/** A group's name, in the tab bar's muted green rather than a brown grey. */
const LABEL = alpha(DEEP, 0.76);
const CHEVRON = alpha(DEEP, 0.34);

/**
 * The ground. The chrome's green, let down under the header and gone to a breath
 * by the time the list runs out — a tone, never the Homes' dashboard green.
 */
const AURA_DEPTH = 420;
const AURA_OPACITY = 0.1;
const FLOOR_OPACITY = 0.025;
/** Light across the top corner, and a pool of green low on the far side. */
const SHEEN_OPACITY = 0.5;
const POOL_OPACITY = 0.05;

/** The group a row is drawn in decides its colour, so a row never names one. */
const GroupTone = createContext<Tone>("kola");

/** One row's measurements, shared by the row and by the hairline its group draws. */
function useRowGeometry() {
  const density = useHomeDensity();
  const compact = density.compact;
  return {
    compact,
    veryCompact: density.veryCompact,
    inset: compact ? space[3] : 14,
    gap: space[3],
    well: compact ? 30 : 32,
    wellRadius: compact ? 9 : 10,
    glyph: compact ? 16 : 17,
    minHeight: compact ? 50 : 52,
    panelRadius: compact ? 16 : 18,
    labelSize: density.labelSize,
  };
}

/**
 * The page: its ground, and one scroller of groups over it.
 *
 * The ground is painted once, behind the scroller, and does not move, so the
 * glass passes over a still light. It takes no touches and says nothing to a
 * screen reader.
 */
export function IndexPage({ children }: { children: ReactNode }) {
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[10]);
  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: density.pagePadding,
          paddingTop: density.compact ? space[5] : space[6],
          paddingBottom: pageBottom,
          gap: density.sectionGap + space[2],
        }}
      >
        {children}
      </ScrollView>
    </IndexGround>
  );
}

/** The hub ground on its own, for a page that needs its own scroller — a form. */
export function IndexGround({ children }: { children: ReactNode }) {
  const window = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // One per mount, and safe inside `url(#…)`: two grounds in one web document
  // never share a gradient.
  const id = `index${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const width = size?.width ?? window.width;
  const height = size?.height ?? window.height;

  return (
    <View
      style={styles.ground}
      onLayout={(event) => {
        const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
        if (nextWidth !== size?.width || nextHeight !== size?.height) setSize({ width: nextWidth, height: nextHeight });
      }}
    >
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={StyleSheet.absoluteFill}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={`${id}aura`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={AURA_DEPTH}>
              <Stop offset="0" stopColor={theme.color.kola["600"]} stopOpacity={AURA_OPACITY} />
              <Stop offset="1" stopColor={theme.color.kola["600"]} stopOpacity={0} />
            </LinearGradient>
            <RadialGradient id={`${id}pool`} gradientUnits="userSpaceOnUse" cx={0} cy={height} r={Math.max(width, 1)}>
              <Stop offset="0" stopColor={theme.color.kola["600"]} stopOpacity={POOL_OPACITY} />
              <Stop offset="1" stopColor={theme.color.kola["600"]} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={`${id}sheen`} gradientUnits="userSpaceOnUse" cx={width * 0.9} cy={0} r={Math.max(width, 1)}>
              <Stop offset="0" stopColor={WHITE} stopOpacity={SHEEN_OPACITY} />
              <Stop offset="1" stopColor={WHITE} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={theme.color.kola["600"]} fillOpacity={FLOOR_OPACITY} />
          <Rect x="0" y="0" width="100%" height={AURA_DEPTH} fill={`url(#${id}aura)`} />
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}pool)`} />
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}sheen)`} />
        </Svg>
      </View>
      {children}
    </View>
  );
}

/**
 * A named group: small caps over one glass panel of rows.
 *
 * Rows a role cannot reach are left out by the screen, so the hairlines are
 * drawn here, between the rows that remain, and a group left with none draws
 * nothing rather than an empty panel.
 */
export function Group({
  title,
  tone = "kola",
  children,
}: {
  title: string;
  /** The colour this group's glyphs share. Neighbouring groups take different ones. */
  tone?: Tone;
  children: ReactNode;
}) {
  const geometry = useRowGeometry();
  const rows = Children.toArray(children).filter(isValidElement);
  if (!rows.length) return null;

  return (
    <View style={{ gap: space[2] }}>
      <Type
        variant="label"
        accessibilityRole="header"
        style={{ paddingHorizontal: space[1], fontSize: geometry.labelSize, lineHeight: 16, color: LABEL }}
      >
        {title.toUpperCase()}
      </Type>
      <View style={[styles.panel, isAndroid ? null : styles.panelLift, { borderRadius: geometry.panelRadius }]}>
        {/* Clipped inside, so a press never paints past the corners; the shadow
            stays on the frame outside, which a clip would cut off. */}
        <View style={{ borderRadius: geometry.panelRadius - 1, overflow: "hidden" }}>
          <GroupTone.Provider value={tone}>
            {rows.map((row, index) => (
              <Fragment key={row.key ?? index}>
                {index ? (
                  <View
                    style={{
                      height: StyleSheet.hairlineWidth,
                      marginLeft: geometry.inset + geometry.well + geometry.gap,
                      backgroundColor: RULE,
                    }}
                  />
                ) : null}
                {row}
              </Fragment>
            ))}
          </GroupTone.Provider>
        </View>
      </View>
    </View>
  );
}

export function Row({
  icon,
  label,
  count = 0,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Shown only when there is something to say. Zero is not news. */
  count?: number;
  onPress: () => void;
}) {
  const geometry = useRowGeometry();
  const palette = TONE[useContext(GroupTone)];

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={count ? `${label}, ${count} unread` : label}
      onPress={onPress}
      {...pressableFeedback(RIPPLE)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: geometry.gap,
        minHeight: geometry.minHeight,
        paddingVertical: space[2],
        paddingHorizontal: geometry.inset,
        backgroundColor: pressed ? PRESSED : "transparent",
      })}
    >
      <View
        style={{
          width: geometry.well,
          height: geometry.well,
          borderRadius: geometry.wellRadius,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.wash,
        }}
      >
        <Ionicons name={icon} size={geometry.glyph} color={palette.ink} />
      </View>
      <Type
        variant="bodyStrong"
        style={{ flex: 1, minWidth: 0, fontSize: geometry.compact ? 15 : 15.5, lineHeight: 20, color: theme.color.ink["900"] }}
      >
        {label}
      </Type>
      {count ? (
        <View style={styles.count}>
          <Type variant="captionStrong" style={styles.countText}>{count}</Type>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={geometry.compact ? 15 : 16} color={CHEVRON} />
    </Pressable>
  );
}

/**
 * The foot of More: two quiet glass tiles, composed like Home's Everything else
 * shortcuts. Both actions share a footprint; laterite ink keeps leaving distinct.
 */
export function IndexActions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

/** Home and More answer a press with the same restrained spring. */
function usePressSpring() {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => {
    if (reduceMotion) {
      scale.setValue(toValue);
      return;
    }
    Animated.spring(scale, { toValue, speed: 34, bounciness: 2, useNativeDriver: true }).start();
  };
  return { scale, pressIn: () => animate(0.97), pressOut: () => animate(1) };
}

function ActionTile({
  label,
  busyLabel,
  busy,
  onPress,
  icon,
  tone,
  eyebrow,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "switch" | "leave";
  eyebrow?: string;
}) {
  const density = useHomeDensity();
  const press = usePressSpring();
  const ink = tone === "leave" ? theme.color.laterite["600"] : ph.ink70;
  const glyph = tone === "leave" ? ink : theme.color.kola["600"];

  return (
    <Animated.View style={{ flex: 1, minWidth: 0, transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? busyLabel : label}
        aria-busy={busy} aria-disabled={busy}
        disabled={busy}
        onPress={onPress}
        onPressIn={press.pressIn}
        onPressOut={press.pressOut}
        {...pressableFeedback(ph.paperDim)}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: theme.targetMin,
          flexDirection: "row",
          alignItems: "center",
          gap: density.compact ? space[2] : space[3],
          paddingVertical: space[2],
          paddingHorizontal: density.compact ? space[2] : space[3],
          borderRadius: density.compact ? 12 : 14,
          borderWidth: 1,
          borderColor: GLASS_EDGE,
          backgroundColor: ph.glass,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        {busy ? (
          <ActivityIndicator size="small" color={glyph} />
        ) : (
          <Ionicons name={icon} size={density.compact ? 16 : 18} color={glyph} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {eyebrow ? (
            <Type variant="caption" style={{ fontSize: 10, lineHeight: 13, color: theme.color.kola["600"] }}>
              {eyebrow}
            </Type>
          ) : null}
          <Type
            variant="bodyStrong"
            style={{ fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, color: ink }}
          >
            {busy ? busyLabel : eyebrow ? label.replace(/^Switch to /, "") : label}
          </Type>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Move into the other workspace with the same account. */
export function SwitchExperienceButton({
  label,
  busyLabel = "Switching…",
  busy = false,
  onPress,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return <ActionTile label={label} busyLabel={busyLabel} busy={busy} onPress={onPress} icon="swap-horizontal" tone="switch" eyebrow="Switch to" />;
}

/** Leave the account on this device. */
export function SignOutButton({
  label,
  busyLabel = "Signing out…",
  busy = false,
  onPress,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return <ActionTile label={label} busyLabel={busyLabel} busy={busy} onPress={onPress} icon="log-out-outline" tone="leave" />;
}

/**
 * A quiet act inline with content — Pay early beside a billing record. Changing
 * experience and signing out have their own buttons above.
 */
export function QuietLink({
  label,
  busyLabel,
  busy = false,
  tone = "accent",
  onPress,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  tone?: "accent" | "quiet";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      aria-busy={busy}
      disabled={busy}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: "center",
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      <Type
        variant="bodyStrong"
        style={{ color: tone === "accent" ? theme.color.kola["600"] : theme.color.ink["500"] }}
      >
        {busy ? busyLabel ?? "Working…" : label}
      </Type>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: shell.canvas,
  },
  panel: {
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  // A whisper of green shadow on iOS and the web preview. Android draws
  // elevation through a translucent fill as a smudge, so there the edge does it.
  panelLift: {
    shadowColor: DEEP,
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["600"],
  },
  countText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: WHITE,
  },
  actions: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space[2],
    marginTop: space[2],
  },
});
