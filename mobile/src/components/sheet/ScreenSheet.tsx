import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { motion } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { theme } from "@/theme";

/** Past this share of its own height, a drag lets the sheet go… */
const DISMISS_SHARE = 0.25;
/** …or past this many points, so a tall sheet is never a long pull. */
const DISMISS_DISTANCE = 160;
/** A downward flick at this speed, in points per millisecond, lets go from anywhere. */
const DISMISS_VELOCITY = 0.8;
/** A pull upwards gives this much, and then holds. */
const OVERPULL = 24;
/** The handle's touch strip: the whole width, over the page's own top padding. */
const HANDLE_HEIGHT = 24;
/** The share of the room under the status bar the sheet stands in, as iOS's detent. */
const DETENT = 0.94;

export type ScreenSheetHandle = { dismiss: () => void };

type ScreenSheetProps = {
  ref?: Ref<ScreenSheetHandle>;
  /** Called once the sheet has left: the route pops here. */
  onClose: () => void;
  /** What the scrim does, for a screen reader: "Close artisans". */
  closeLabel: string;
  /** Matches the page drawn inside, so the rounded top reads as one piece. */
  ground: string;
  children: ReactNode;
};

/**
 * A whole route drawn as a sheet, for Android.
 *
 * Find Artisans is UIKit's own sheet on iOS. On Android, react-native-screens'
 * native form sheet failed on opening — a native view re-parented while the
 * sheet mounted, which a development build shows as a red screen and the
 * owner's Galaxy S10+ showed as a frozen app — and every native sheet also
 * takes over the window's inset listener for the rest of the app's life. After
 * that an empty band stood under the tab bar (owner, 2026-10-25). So the route
 * is a transparent page there, and this draws the sheet over it: a scrim, a
 * rounded card at the same detent, and a handle that drags it away.
 *
 * It moves on the native driver with React Native's own `Animated` and
 * `PanResponder`, not Reanimated, which froze Expo Go at launch. Only the handle
 * drags, as in `BottomSheet`; the scrim, the back button and the page's own
 * close button let it fall before the route pops.
 */
export function ScreenSheet({ ref, onClose, closeLabel, ground, children }: ScreenSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  const [translate] = useState(() => new Animated.Value(windowHeight));
  const travel = useRef(windowHeight);
  const opened = useRef(false);
  const leaving = useRef(false);
  const dragBase = useRef(0);
  // Read by gestures and animations that must not restart when these change.
  const still = useRef(reduceMotion);
  const close = useRef(onClose);
  useEffect(() => {
    still.current = reduceMotion;
    close.current = onClose;
  });

  const dismiss = useCallback((speed = 0) => {
    if (leaving.current) return;
    leaving.current = true;
    Keyboard.dismiss();
    translate.stopAnimation((from) => {
      const remaining = Math.max(0, travel.current - from);
      // As fast as the finger that let it go, and never slower than crossing the
      // whole sheet in the base duration.
      const pace = Math.max(speed, travel.current / motion.duration.base);
      Animated.timing(translate, {
        toValue: travel.current,
        duration: still.current ? 0 : Math.min(motion.duration.base, remaining / pace),
        easing: Easing.bezier(...motion.easing.exit),
        useNativeDriver: true,
      }).start(() => close.current());
    });
  }, [translate]);

  useImperativeHandle(ref, () => ({ dismiss: () => dismiss() }), [dismiss]);

  // Registered on mount, so a listener the page adds later — a profile's own
  // way back — is asked first.
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss();
      return true;
    });
    return () => listener.remove();
  }, [dismiss]);

  const measure = (event: LayoutChangeEvent) => {
    travel.current = Math.round(event.nativeEvent.layout.height);
    if (opened.current) return;
    opened.current = true;
    translate.setValue(travel.current);
    Animated.timing(translate, {
      toValue: 0,
      duration: still.current ? 0 : motion.duration.slow,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    }).start();
  };

  const grab = useMemo(() => {
    const settle = (gesture: PanResponderGestureState) => {
      const position = dragBase.current + gesture.dy;
      const letGo = Math.min(travel.current * DISMISS_SHARE, DISMISS_DISTANCE);
      if (position > letGo || (gesture.vy > DISMISS_VELOCITY && gesture.dy > 0)) {
        dismiss(Math.max(0, gesture.vy));
        return;
      }
      Animated.spring(translate, {
        toValue: 0,
        velocity: gesture.vy * 1000,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        Keyboard.dismiss();
        dragBase.current = 0;
        translate.stopAnimation((value) => {
          dragBase.current = value;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const next = dragBase.current + gesture.dy;
        translate.setValue(next >= 0 ? next : -OVERPULL * (1 - Math.exp(next / OVERPULL)));
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, gesture) => settle(gesture),
      onPanResponderTerminate: (_, gesture) => settle(gesture),
    });
  }, [dismiss, translate]);

  const scrim = useMemo(
    () => translate.interpolate({
      inputRange: [0, Math.max(1, windowHeight)],
      outputRange: [1, 0],
      extrapolate: "clamp",
    }),
    [translate, windowHeight],
  );

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={() => dismiss()} style={styles.fill} />
      </Animated.View>
      <View pointerEvents="box-none" style={styles.stage}>
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={() => dismiss()}
          onLayout={measure}
          style={[styles.sheet, { backgroundColor: ground, transform: [{ translateY: translate }] }]}
        >
          {children}
          <View collapsable={false} style={styles.handle} {...grab.panHandlers}>
            <View style={styles.grabber} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // The same scrim as `BottomSheet`: `ink-950` at 44%.
  scrim: { backgroundColor: "rgba(22,17,14,0.44)" },
  stage: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    height: `${DETENT * 100}%`,
    overflow: "hidden",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handle: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HANDLE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.color.field["300"],
  },
});
