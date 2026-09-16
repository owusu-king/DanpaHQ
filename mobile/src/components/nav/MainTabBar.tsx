import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, space } from "@/components/ui";
import { duration, enter, exit, press, PRESS_SCALE } from "@/motion";
import { hapticsPolicy, isAndroid, isIOS } from "@/platform";
import { theme } from "@/theme";

const BAR_MAX_WIDTH = 560;

/** Comfortably past the system's 48pt floor, without a bar that eats the page. */
const ITEM_HEIGHT = 60;

/** The lozenge behind an active icon. Sized to hold a 24pt glyph with air. */
const PILL_WIDTH = 56;
const PILL_HEIGHT = 32;
const ICON_SIZE = 24;

/**
 * The app's primary wayfinding surface.
 *
 * It is intentionally a shelf rather than a floating pill. Daylight & Ledger
 * uses edges and rules to establish hierarchy; lifting the whole navigation
 * into a rounded capsule would make it look imported from another product.
 *
 * Every duration, curve, radius and gap below is a shared token. The bar
 * previously hardcoded `220`, `140` and two bezier curves that were
 * character-for-character `motion.duration.base`, `motion.duration.fast`,
 * `motion.easing.enter` and `motion.easing.exit` — agreeing with the system
 * right up until someone revised one of them.
 */
export function MainTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  // `flatMap` rather than `filter` because a missing descriptor has to narrow
  // away, not be asserted away.
  const visible = state.routes.flatMap((route, index) => {
    const descriptor = descriptors[route.key];
    if (!descriptor) return [];
    return isHiddenFromBar(descriptor.options)
      ? []
      : [{ route, index, options: descriptor.options }];
  });

  // A home-indicator device already has its own breathing room; a device
  // without one still needs some, or the labels sit on the screen edge.
  const bottomInset = Math.max(insets.bottom, space[2]);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Main navigation"
      style={[styles.shell, isIOS ? styles.iosShadow : null]}
    >
      <View style={[styles.routeRow, { paddingBottom: bottomInset }]}>
        {visible.map((entry, position) => (
          <TabItem
            key={entry.route.key}
            route={entry.route}
            position={position + 1}
            count={visible.length}
            focused={state.index === entry.index}
            options={entry.options}
            navigation={navigation}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Whether expo-router has taken this route out of the bar.
 *
 * `href: null` is the way to keep a route in the navigator and off the tab bar
 * — the provider's `add` screen. But **`href` never reaches a custom tab bar.**
 * expo-router destructures it away in `TabsClient` and marks the route two other
 * ways instead: `tabBarItemStyle: { display: "none" }`, and a `tabBarButton`
 * that renders `null`. The default bar honours it only because it renders that
 * button; anything custom has to read the marker.
 *
 * Reading `options.href` therefore matched nothing, and the provider grew a
 * sixth tab labelled from its filename.
 *
 * The `href` check stays as well, because the transform is skipped entirely when
 * a screen's `options` is a function — and then `href` *does* survive.
 */
function isHiddenFromBar(options: BottomTabBarProps["descriptors"][string]["options"]): boolean {
  if ((options as { href?: string | null }).href === null) return true;
  return StyleSheet.flatten(options.tabBarItemStyle)?.display === "none";
}

type TabItemProps = {
  route: BottomTabBarProps["state"]["routes"][number];
  position: number;
  count: number;
  focused: boolean;
  options: BottomTabBarProps["descriptors"][string]["options"];
  navigation: BottomTabBarProps["navigation"];
};

function TabItem({ route, position, count, focused, options, navigation }: TabItemProps) {
  /* Two shared values rather than two `Animated.Value`s. The old pair already
     ran on the native driver, so this is not a frame the bar was dropping; what
     it buys is one animation API in the app instead of two, and a pill whose
     width and opacity are computed in the same worklet rather than through an
     `interpolate` chain that has to be rebuilt on every render. */
  const focusProgress = useSharedValue(focused ? 1 : 0);
  const pressScale = useSharedValue(1);
  const label =
    typeof options.tabBarLabel === "string"
      ? options.tabBarLabel
      : typeof options.title === "string"
        ? options.title
        : route.name;

  /* In an effect, not in the render body. Reanimated is explicit that a shared
     value must not be written during render — under React 19 the render runs
     twice in development and the second write would restart the animation from
     wherever the first had reached.

     Reduce Motion is not checked here: both configs carry `ReduceMotion.System`
     and the UI thread answers it without asking JavaScript, so the tab bar no
     longer holds a subscription to an accessibility setting it was only using
     to zero a duration. */
  useEffect(() => {
    focusProgress.value = withTiming(
      focused ? 1 : 0,
      // Arriving is worth watching; leaving should get out of the way.
      focused ? enter(duration.base) : exit(duration.fast),
    );
  }, [focusProgress, focused]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: focusProgress.value,
    // The lozenge grows out from under the glyph rather than fading in at full
    // width, so the focused tab reads as having been chosen.
    transform: [{ scaleX: interpolate(focusProgress.value, [0, 1], [0.62, 1]) }],
  }));

  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const animatePress = (toValue: number) => {
    pressScale.value = withSpring(toValue, press);
  };

  const onPress = () => {
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });

    if (!focused && !event.defaultPrevented) {
      if (hapticsPolicy.onSelection) {
        void import("expo-haptics")
          .then((haptics) => haptics.selectionAsync())
          .catch(() => null);
      }
      navigation.navigate(route.name, route.params);
    }
  };

  const onLongPress = () => {
    navigation.emit({ type: "tabLongPress", target: route.key });
  };

  const activeColor = theme.color.kola["800"];
  const inactiveColor = theme.color.ink["500"];
  const color = focused ? activeColor : inactiveColor;
  const badge = options.tabBarBadge;

  return (
    <View style={styles.itemCell}>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, ${position} of ${count}`}
        testID={options.tabBarButtonTestID}
        hitSlop={space[1]}
        // Bounded to a circle around the glyph rather than flooding the whole
        // cell — Material ripples inside the target, not across the shelf.
        android_ripple={
          isAndroid
            ? { color: theme.color.kola["50"], radius: PILL_WIDTH / 2, borderless: true }
            : undefined
        }
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => animatePress(PRESS_SCALE)}
        onPressOut={() => animatePress(1)}
        style={styles.pressTarget}
      >
        {/*
          The press scales the glyph and its lozenge, and deliberately not the
          label: type that rubber-bands under a thumb reads as a toy. The label
          holds still and only the thing being aimed at responds.
        */}
        <Animated.View style={[styles.iconStage, stageStyle]}>
          <Animated.View pointerEvents="none" style={[styles.activePill, pillStyle]} />
          {options.tabBarIcon?.({ focused, color, size: ICON_SIZE })}
          {badge !== undefined ? (
            <View style={styles.badge}>
              <Text numberOfLines={1} style={styles.badgeText}>
                {badge}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.25}
          style={[styles.label, { color }, focused ? styles.activeLabel : null]}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: theme.color.field["0"],
    borderTopColor: theme.color.field["200"],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iosShadow: {
    shadowColor: theme.color.ink["900"],
    shadowOpacity: 0.055,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -5 },
  },
  routeRow: {
    width: "100%",
    maxWidth: BAR_MAX_WIDTH,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: space[1],
  },
  itemCell: {
    flex: 1,
    minWidth: PILL_WIDTH,
  },
  pressTarget: {
    minHeight: ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    paddingTop: space[1],
  },
  iconStage: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  activePill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  label: {
    maxWidth: "100%",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.1,
    textAlign: "center",
  },
  activeLabel: {
    fontWeight: "700",
  },
  badge: {
    position: "absolute",
    top: -space[1] / 2,
    right: space[2],
    minWidth: 17,
    height: 17,
    borderRadius: radius.pill,
    paddingHorizontal: space[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.laterite["600"],
    borderWidth: 2,
    borderColor: theme.color.field["0"],
  },
  badgeText: {
    color: theme.color.field["0"],
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
  },
});
