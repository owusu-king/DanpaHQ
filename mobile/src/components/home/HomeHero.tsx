import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactElement, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type RefreshControlProps } from "react-native";

import { ph } from "@/components/home/plinth";
import { HeaderChromeBackground } from "@/components/nav/HeaderChromeBackground";
import { space } from "@/components/ui";
import { useFloatingTabBarClearance } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/** The panel's top corners, and how far it rises over the green. */
const PANEL_RADIUS = 28;
/** How far the page scrolls before the greeting has fully gone. */
const FADE_DISTANCE = 96;

export type HeroChip = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

/**
 * The top of both Homes: the header's green carried down behind a greeting,
 * with the dashboard on a rounded panel that rises over it.
 *
 * The header stays where it is. The hero scrolls with the page, and as it goes
 * the greeting fades, drifts up and settles a little smaller, so by the time the
 * panel reaches the header the screen is the ordinary tab — green above, the
 * page below — with nothing having jumped. The panel keeps its round corners
 * against the header's green, so the two still read as one piece.
 *
 * The screen sets `headerShadowVisible: false`, which tells `TabHeader` to drop
 * its edge and lower band, so header and hero share one dotted texture.
 *
 * The hero is part of the scroll rather than the header, so a pull past the top
 * would show the ground above it. A block of the same green sits above the hero
 * for that overscroll, and a pull-to-refresh spinner is drawn in white on it.
 */
export function HomeHeroScroll({
  title,
  chips = [],
  padding,
  gap,
  refreshControl,
  children,
}: {
  title: string;
  /** Up to two quiet shortcuts under the greeting. */
  chips?: HeroChip[];
  padding: number;
  gap: number;
  refreshControl?: ReactElement<RefreshControlProps>;
  children: ReactNode;
}) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const barClearance = useFloatingTabBarClearance();

  const greetingStyle = {
    opacity: scrollY.interpolate({ inputRange: [0, FADE_DISTANCE * 0.8], outputRange: [1, 0], extrapolate: "clamp" }),
    transform: [
      { translateY: scrollY.interpolate({ inputRange: [-120, 0, FADE_DISTANCE], outputRange: [-30, 0, 34], extrapolate: "clamp" }) },
      { scale: scrollY.interpolate({ inputRange: [-120, 0, FADE_DISTANCE], outputRange: [1.06, 1, 0.92], extrapolate: "clamp" }) },
    ],
  } as const;

  return (
    <Animated.ScrollView
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      contentContainerStyle={styles.content}
      refreshControl={refreshControl}
    >
      <View style={styles.hero}>
        <View pointerEvents="none" style={styles.overscroll} />
        <HeaderChromeBackground edge={false} trailing={false} />
        <Animated.View style={[styles.greeting, greetingStyle]}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          {chips.length ? (
            <View style={styles.chips}>
              {chips.slice(0, 2).map((chip) => (
                <Pressable
                  key={chip.id}
                  accessibilityRole="button"
                  accessibilityLabel={chip.label}
                  onPress={chip.onPress}
                  hitSlop={4}
                  style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}
                >
                  <Ionicons name={chip.icon} size={14} color={shell.chrome} />
                  <Text allowFontScaling={false} numberOfLines={1} style={styles.chipLabel}>{chip.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Animated.View>
      </View>

      <View style={[styles.panel, { padding, gap, paddingBottom: space[12] + barClearance }]}>{children}</View>
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  hero: {
    backgroundColor: shell.chrome,
    paddingTop: space[3],
    paddingBottom: PANEL_RADIUS + space[6],
    paddingHorizontal: space[5],
  },
  overscroll: {
    position: "absolute",
    top: -1000,
    left: 0,
    right: 0,
    height: 1000,
    backgroundColor: shell.chrome,
  },
  greeting: {
    alignItems: "center",
    gap: space[4],
  },
  title: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "600",
    letterSpacing: -0.4,
    textAlign: "center",
    color: shell.onChrome,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space[2],
  },
  // White pills, as in the reference: the one bright thing on the green.
  chip: {
    height: 34,
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: shell.onChrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(theme.color.kola["900"], 0.12),
  },
  chipPressed: {
    backgroundColor: theme.color.kola["50"],
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "500",
    color: theme.color.ink["900"],
  },
  panel: {
    flexGrow: 1,
    marginTop: -PANEL_RADIUS,
    paddingTop: space[6],
    borderTopLeftRadius: PANEL_RADIUS,
    borderTopRightRadius: PANEL_RADIUS,
    backgroundColor: ph.ground,
  },
});
