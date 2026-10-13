import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from "expo-router/tabs";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isHiddenFromBar } from "@/components/nav/tabRoutes";
import { radius, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { hapticsPolicy } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/** The capsule's height: a 48pt target with the glass's own rim around it. */
const CAPSULE_HEIGHT = 64;

/** How far the selection lozenge sits inside the capsule's rim. */
const LOZENGE_INSET = 4;

const BAR_MAX_WIDTH = 520;
const ICON_SIZE = 24;

/** How much the lozenge swells under a held finger, and the glyphs beneath it. */
const LIFT_SCALE = 1.14;
const LENS_MAGNIFY = 0.16;

/** iOS 26 draws real Liquid Glass; anything older gets the system's chrome blur. */
const LIQUID_GLASS = isLiquidGlassAvailable();

/**
 * The lozenge is two springs, not one. Its leading edge is stiff and its
 * trailing edge soft, so a move stretches it toward where it is going and the
 * tail catches up — the liquid travel of the iOS 26 bar, rather than a block
 * sliding on rails.
 */
const LEAD = { stiffness: 320, damping: 22, mass: 0.8 } as const;
const TRAIL = { stiffness: 150, damping: 24, mass: 1 } as const;
/** The swell under a finger: quick in, a little give on the way out. */
const LIFT_IN = { stiffness: 420, damping: 16, mass: 1 } as const;
const LIFT_OUT = { stiffness: 260, damping: 14, mass: 1 } as const;

type SpringShape = { stiffness: number; damping: number; mass: number };

type Entry = {
  route: BottomTabBarProps["state"]["routes"][number];
  index: number;
  options: BottomTabBarProps["descriptors"][string]["options"];
};

const spring = (value: Animated.Value, toValue: number, config: SpringShape) =>
  Animated.spring(value, { toValue, ...config, useNativeDriver: true });

/**
 * The iOS navigation: a glass capsule that floats over the page.
 *
 * WhatsApp, Capital One and the rest of the current iOS crop moved the tab bar
 * off the screen's edge and onto a pill the page scrolls beneath. On iOS 26 it
 * is the system's Liquid Glass; on earlier releases a chrome-material blur with
 * a paper wash, so it never reads as a hole.
 *
 * It behaves like the system bar:
 *
 * - **Touch** a tab and the lozenge swells into a lens and flows to it, leading
 *   edge first, the glyphs under the lens magnifying as it passes.
 * - **Drag** along the bar and the lozenge follows the finger, rubber-banding
 *   past either end, with a selection tick for every tab it crosses. Letting go
 *   settles it on the nearest tab and opens it.
 * - **Colour follows the lozenge**, not a timer: each glyph and name fills in
 *   by how close the lozenge is, so a jump across three tabs lights each in turn.
 *
 * Built on React Native's own Animated and PanResponder, every animation on the
 * native driver — no Reanimated or Gesture Handler. With those added, the app
 * froze at its launch screen in Expo Go on an iPhone 17 Pro Max (2026-10-13).
 *
 * The bar is out of the layout flow, so it tells the navigator how much of the
 * screen it covers; `useSafeBottom` and `useFloatingTabBarClearance` read that
 * back so the last row of every tab clears the glass.
 */
export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const reduceMotion = useReduceMotion();

  const visible = useMemo(
    () =>
      state.routes.flatMap((route, index): Entry[] => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return [];
        return isHiddenFromBar(descriptor.options) ? [] : [{ route, index, options: descriptor.options }];
      }),
    [descriptors, state.routes],
  );
  const count = visible.length;
  const focusedPosition = visible.findIndex((entry) => entry.index === state.index);

  // Sit just above the home indicator, as the system bars do; a phone without
  // one still gets a deliberate gap under the capsule.
  const dockLift = Math.max(insets.bottom - space[3], space[3]);

  useEffect(() => {
    reportHeight?.(CAPSULE_HEIGHT + dockLift);
  }, [dockLift, reportHeight]);

  const [cell, setCell] = useState(0);
  const [lead] = useState(() => new Animated.Value(0));
  const [trail] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));
  const row = useRef<View>(null);
  // Where the row starts on screen, so a touch anywhere in it maps to a tab.
  const rowLeft = useRef(0);
  const hovered = useRef(-1);
  const placed = useRef(false);

  /** Carry the lozenge to a tab: springs normally, a cut under Reduce Motion. */
  const settleTo = useCallback(
    (position: number) => {
      if (!cell || position < 0) return;
      const target = position * cell;
      if (!placed.current || reduceMotion) {
        placed.current = true;
        lead.setValue(target);
        trail.setValue(target);
        return;
      }
      Animated.parallel([spring(lead, target, LEAD), spring(trail, target, TRAIL)]).start();
    },
    [cell, lead, reduceMotion, trail],
  );

  useEffect(() => {
    settleTo(focusedPosition);
  }, [focusedPosition, settleTo]);

  /** What a tap does in any navigator: announce it, then go unless prevented. */
  const select = useCallback(
    (position: number) => {
      const entry = visible[position];
      if (!entry) return;
      const focused = entry.index === state.index;
      const event = navigation.emit({ type: "tabPress", target: entry.route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(entry.route.name, entry.route.params);
      } else {
        // Nothing moved, so the lozenge goes home.
        settleTo(focusedPosition);
      }
    },
    [focusedPosition, navigation, settleTo, state.index, visible],
  );

  // The responder is made once; the latest of everything it needs is read
  // through this ref, so a re-render never swaps the gesture mid-drag.
  const live = useRef({ cell, count, focusedPosition, reduceMotion, select, settleTo });
  useEffect(() => {
    live.current = { cell, count, focusedPosition, reduceMotion, select, settleTo };
  });

  const [responder] = useState(() => {
    const moveTo = (pageX: number, follow: boolean) => {
      const { cell: width, count: tabs, reduceMotion: still } = live.current;
      if (!width) return;
      const max = width * (tabs - 1);
      let target = pageX - rowLeft.current - width / 2;
      // Past either end the lozenge gives a little, then holds.
      if (target < 0) target = -Math.sqrt(-target) * 2.4;
      else if (target > max) target = max + Math.sqrt(target - max) * 2.4;
      if (still) {
        lead.setValue(target);
        trail.setValue(target);
      } else if (follow) {
        lead.setValue(target);
        spring(trail, target, TRAIL).start();
      } else {
        Animated.parallel([spring(lead, target, LEAD), spring(trail, target, TRAIL)]).start();
      }
      const position = Math.min(tabs - 1, Math.max(0, Math.round(target / width)));
      if (hovered.current !== position) {
        if (hovered.current !== -1 && hapticsPolicy.onSelection) {
          void import("expo-haptics")
            .then((haptics) => haptics.selectionAsync())
            .catch(() => null);
        }
        hovered.current = position;
      }
    };

    const release = (open: boolean) => {
      const { reduceMotion: still, select: choose, settleTo: settle, focusedPosition: home } = live.current;
      if (still) lift.setValue(0);
      else spring(lift, 0, LIFT_OUT).start();
      const position = hovered.current;
      hovered.current = -1;
      if (open && position >= 0) {
        // Settle first, so the lozenge is already landing as the page changes.
        settle(position);
        choose(position);
      } else {
        // Taken away mid-drag — a call, a sheet: go home, open nothing.
        settle(home);
      }
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        hovered.current = -1;
        if (live.current.reduceMotion) lift.setValue(1);
        else spring(lift, 1, LIFT_IN).start();
        moveTo(event.nativeEvent.pageX, false);
      },
      onPanResponderMove: (event) => moveTo(event.nativeEvent.pageX, true),
      onPanResponderRelease: () => release(true),
      onPanResponderTerminate: () => release(false),
    });
  });

  // The lozenge's centre, and how far its two edges have pulled apart.
  const centre = useMemo(() => Animated.multiply(Animated.add(lead, trail), 0.5), [lead, trail]);
  const pull = useMemo(() => Animated.subtract(lead, trail), [lead, trail]);
  const span = cell || 1;
  const stretch = pull.interpolate({ inputRange: [-span, 0, span], outputRange: [2, 1, 2], extrapolate: "clamp" });
  // A stretched lozenge thins a touch, the way a drop does when it runs.
  const thin = pull.interpolate({ inputRange: [-span, 0, span], outputRange: [0.9, 1, 0.9], extrapolate: "clamp" });
  const swell = lift.interpolate({ inputRange: [0, 1], outputRange: [1, LIFT_SCALE] });
  const tint = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] });

  const onAction = (position: number) => (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "activate") select(position);
  };

  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom: dockLift }]}>
      <View style={styles.capsule}>
        <View style={styles.material}>
          {LIQUID_GLASS ? (
            <GlassView glassEffectStyle="regular" colorScheme="light" style={StyleSheet.absoluteFill} />
          ) : (
            <>
              <BlurView tint="systemChromeMaterialLight" intensity={90} style={StyleSheet.absoluteFill} />
              <View style={[StyleSheet.absoluteFill, styles.wash]} />
            </>
          )}
        </View>

        <View
          ref={row}
          accessibilityRole="tablist"
          accessibilityLabel="Main navigation"
          style={styles.row}
          onLayout={(event) => {
            setCell(count ? event.nativeEvent.layout.width / count : 0);
            row.current?.measureInWindow((x) => {
              rowLeft.current = x;
            });
          }}
          {...responder.panHandlers}
        >
          {cell > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.lozenge,
                {
                  width: cell,
                  transform: [{ translateX: centre }, { scaleX: stretch }, { scaleY: thin }, { scale: swell }],
                },
              ]}
            >
              <Animated.View style={[StyleSheet.absoluteFill, styles.tint, { opacity: tint }]} />
              <Animated.View style={[StyleSheet.absoluteFill, styles.lens, { opacity: lift }]} />
            </Animated.View>
          ) : null}

          {visible.map((entry, position) => (
            <GlassTab
              key={entry.route.key}
              entry={entry}
              position={position}
              count={count}
              focused={state.index === entry.index}
              cell={cell}
              centre={centre}
              lift={lift}
              onAction={onAction(position)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

type GlassTabProps = {
  entry: Entry;
  position: number;
  count: number;
  focused: boolean;
  cell: number;
  centre: Animated.AnimatedMultiplication<number>;
  lift: Animated.Value;
  onAction: (event: AccessibilityActionEvent) => void;
};

/**
 * One destination. It has no press handler of its own — the bar's responder
 * owns every touch — but VoiceOver still activates it through `activate`.
 */
function GlassTab({ entry, position, count, focused, cell, centre, lift, onAction }: GlassTabProps) {
  const { options, route } = entry;
  const label =
    typeof options.tabBarLabel === "string"
      ? options.tabBarLabel
      : typeof options.title === "string"
        ? options.title
        : route.name;

  // 1 with the lozenge's centre on this tab, 0 a whole tab away or more.
  const near = useMemo(
    () =>
      cell
        ? centre.interpolate({
            inputRange: [(position - 1) * cell, position * cell, (position + 1) * cell],
            outputRange: [0, 1, 0],
            extrapolate: "clamp",
          })
        : new Animated.Value(focused ? 1 : 0),
    [cell, centre, focused, position],
  );
  const far = useMemo(() => Animated.subtract(1, near), [near]);
  const magnify = useMemo(
    () => Animated.multiply(lift, near).interpolate({ inputRange: [0, 1], outputRange: [1, 1 + LENS_MAGNIFY] }),
    [lift, near],
  );

  const badge = options.tabBarBadge;

  return (
    <View
      accessible
      accessibilityRole="tab"
      aria-selected={focused}
      accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, ${position + 1} of ${count}`}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={onAction}
      testID={options.tabBarButtonTestID}
      style={styles.cell}
    >
      <Animated.View style={[styles.iconStage, { transform: [{ scale: magnify }] }]}>
        <Animated.View pointerEvents="none" style={[styles.glyph, { opacity: far }]}>
          {options.tabBarIcon?.({ focused: false, color: shell.resting, size: ICON_SIZE })}
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.glyph, { opacity: near }]}>
          {options.tabBarIcon?.({ focused: true, color: shell.active, size: ICON_SIZE })}
        </Animated.View>
        {badge !== undefined ? (
          <View style={styles.badge}>
            <Text numberOfLines={1} style={styles.badgeText}>
              {badge}
            </Text>
          </View>
        ) : null}
      </Animated.View>

      <View style={styles.labelStage}>
        <Animated.Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.label, styles.restingLabel, { opacity: far }]}>
          {label}
        </Animated.Text>
        <Animated.Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.label, styles.activeLabel, { opacity: near }]}>
          {label}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: space[4],
    right: space[4],
    alignItems: "center",
  },
  // Not clipped: the lens swells past the rim under a finger, as the system's
  // does. Only the material is clipped to the pill.
  capsule: {
    width: "100%",
    maxWidth: BAR_MAX_WIDTH,
    height: CAPSULE_HEIGHT,
    borderRadius: radius.pill,
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  material: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(theme.color.field["0"], 0.7),
  },
  // Pre-26 only: lifts the blur toward paper so busy content behind stays calm.
  wash: {
    backgroundColor: alpha(theme.color.field["0"], 0.42),
  },
  row: {
    flex: 1,
    flexDirection: "row",
    margin: LOZENGE_INSET,
  },
  lozenge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  // At rest: a pale kola lozenge.
  tint: {
    borderRadius: radius.pill,
    backgroundColor: alpha(theme.color.kola["600"], 0.12),
  },
  // Under a finger: a bright lens with a lit rim, lifted on its own shadow.
  lens: {
    borderRadius: radius.pill,
    backgroundColor: alpha(theme.color.field["0"], 0.55),
    borderWidth: 1,
    borderColor: alpha(theme.color.field["0"], 0.95),
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  cell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  iconStage: {
    width: 32,
    height: ICON_SIZE + 2,
    alignItems: "center",
    justifyContent: "center",
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
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: 0.1,
    textAlign: "center",
  },
  restingLabel: { color: shell.resting, fontWeight: "500" },
  activeLabel: { position: "absolute", top: 0, right: 0, left: 0, color: shell.active, fontWeight: "600" },
  badge: {
    position: "absolute",
    top: -space[1],
    right: -space[2],
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    paddingHorizontal: space[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.laterite["600"],
  },
  badgeText: {
    color: theme.color.field["0"],
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "600",
  },
});
