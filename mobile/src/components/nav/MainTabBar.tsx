import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassTabBar } from "@/components/nav/GlassTabBar";
import { isHiddenFromBar } from "@/components/nav/tabRoutes";
import { motion, radius, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { hapticsPolicy, isAndroid, isIOS } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

const BAR_MAX_WIDTH = 560;

/** A 48pt target with air above and below it, and room for the indicator to breathe. */
const ITEM_HEIGHT = 62;

/** The narrowest a destination may be. Five of them still fit a 320pt phone. */
const CELL_MIN_WIDTH = 56;

/** The pale kola indicator behind the tab you are on, and the circle a ripple stays in. */
const INDICATOR_WIDTH = 60;
const INDICATOR_HEIGHT = 32;

const ICON_SIZE = 24;

/** The tab you are on: deep kola, over its pale kola indicator. */
const ACTIVE = shell.active;

/** Every other tab: kola's darkest shade, muted to a green-grey. */
const RESTING = shell.resting;

/**
 * The app's primary wayfinding surface.
 *
 * A paper shelf under a hairline, each destination a glyph over its name, all in
 * Rooomly's green. The tab you are on is drawn three ways at once — a pale kola
 * indicator widens behind its glyph, the outline fills in deep kola, and its name
 * turns bold — so the state never rests on colour alone. The other tabs are
 * outlines in a muted kola, which keeps the whole bar green rather than brown
 * grey.
 *
 * Everything moves on the native driver: the indicator widens into place as the
 * glyph crossfades from outline to filled and the name from one weight to the
 * other, and leaving is quicker than arriving. A press springs the glyph and its
 * indicator, never the label, with a ripple bounded to the indicator on Android
 * and a selection haptic on iOS. On iOS a whisper of shadow lifts the shelf off
 * the page; Android keeps the hairline, which reads cleanly on its panels.
 *
 * Every duration, curve, radius and gap below is a shared token.
 */
export function MainTabBar(props: BottomTabBarProps) {
  // iOS floats a glass capsule over the page instead (owner, 2026-10-13).
  return isIOS ? <GlassTabBar {...props} /> : <ShelfTabBar {...props} />;
}

function ShelfTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
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
      style={[styles.bar, isIOS ? styles.lift : null]}
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

type TabItemProps = {
  route: BottomTabBarProps["state"]["routes"][number];
  position: number;
  count: number;
  focused: boolean;
  options: BottomTabBarProps["descriptors"][string]["options"];
  navigation: BottomTabBarProps["navigation"];
};

function TabItem({ route, position, count, focused, options, navigation }: TabItemProps) {
  const reduceMotion = useReduceMotion();
  const focusProgress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const resting = useMemo(() => focusProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), [focusProgress]);
  const widen = useMemo(() => focusProgress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }), [focusProgress]);
  const label =
    typeof options.tabBarLabel === "string"
      ? options.tabBarLabel
      : typeof options.title === "string"
        ? options.title
        : route.name;

  useEffect(() => {
    Animated.timing(focusProgress, {
      toValue: focused ? 1 : 0,
      // Arriving is worth watching; leaving should get out of the way.
      duration: reduceMotion ? 0 : focused ? motion.duration.base : motion.duration.fast,
      easing: Easing.bezier(
        ...(focused ? motion.easing.enter : motion.easing.exit),
      ),
      useNativeDriver: true,
    }).start();
  }, [focusProgress, focused, reduceMotion]);

  const animatePress = (toValue: number) => {
    if (reduceMotion) {
      pressScale.setValue(toValue);
      return;
    }
    Animated.spring(pressScale, {
      toValue,
      speed: 34,
      bounciness: 2,
      useNativeDriver: true,
    }).start();
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

  const badge = options.tabBarBadge;

  return (
    <View style={styles.itemCell}>
      <Pressable
        accessibilityRole="tab"
        aria-selected={focused}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, ${position} of ${count}`}
        testID={options.tabBarButtonTestID}
        hitSlop={space[1]}
        // Bounded to the indicator rather than flooding the whole cell —
        // Material ripples inside the target, not across the shelf.
        android_ripple={
          isAndroid
            ? { color: shell.activeGround, radius: INDICATOR_WIDTH / 2, borderless: true }
            : undefined
        }
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => animatePress(0.92)}
        onPressOut={() => animatePress(1)}
        style={styles.pressTarget}
      >
        {/*
          The press scales the glyph and its indicator, and deliberately not the
          label: type that rubber-bands under a thumb reads as a toy. The label
          holds still and only the thing being aimed at responds.
        */}
        <Animated.View style={[styles.iconStage, { transform: [{ scale: pressScale }] }]}>
          <Animated.View
            pointerEvents="none"
            style={[styles.indicator, { opacity: focusProgress, transform: [{ scaleX: widen }] }]}
          />
          <Animated.View pointerEvents="none" style={[styles.glyph, { opacity: resting }]}>
            {options.tabBarIcon?.({ focused: false, color: RESTING, size: ICON_SIZE })}
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.glyph, { opacity: focusProgress }]}>
            {options.tabBarIcon?.({ focused: true, color: ACTIVE, size: ICON_SIZE })}
          </Animated.View>
          {badge !== undefined ? (
            <View style={styles.badge}>
              <Text numberOfLines={1} style={styles.badgeText}>
                {badge}
              </Text>
            </View>
          ) : null}
        </Animated.View>

        {/* Both weights of the name share one box, so the crossfade moves nothing. */}
        <View style={styles.labelStage}>
          <Animated.Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.25}
            style={[styles.label, styles.restingLabel, { opacity: resting }]}
          >
            {label}
          </Animated.Text>
          <Animated.Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.25}
            style={[styles.label, styles.activeLabel, { opacity: focusProgress }]}
          >
            {label}
          </Animated.Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: shell.paper,
    borderTopColor: shell.rule,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // iOS only: the shelf lifts off the page by a whisper, in kola rather than grey.
  lift: {
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
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
    minWidth: CELL_MIN_WIDTH,
  },
  pressTarget: {
    minHeight: ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    paddingTop: space[1],
  },
  iconStage: {
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  indicator: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
    backgroundColor: shell.activeGround,
  },
  glyph: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  labelStage: {
    alignSelf: "stretch",
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.1,
    textAlign: "center",
  },
  restingLabel: { color: RESTING, fontWeight: "500" },
  activeLabel: { position: "absolute", top: 0, right: 0, left: 0, color: ACTIVE, fontWeight: "600" },
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
    borderColor: shell.paper,
  },
  badgeText: {
    color: theme.color.field["0"],
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "600",
  },
});
