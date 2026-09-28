import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";

import { ModalSafeArea, SafeInsets } from "@/components/sheet/ModalSafeArea";
import { SHEET_GROUND, SheetScope } from "@/components/sheet/SheetParts";
import { Type, motion, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { isAndroid, pressableFeedback, safeHeaderTop } from "@/platform";
import { theme } from "@/theme";

/** Past this share of its own height, a drag lets the sheet go… */
const DISMISS_SHARE = 0.25;
/** …or past this many points, so a tall sheet is never a long pull. */
const DISMISS_DISTANCE = 160;
/** A downward flick at this speed, in points per millisecond, lets go from anywhere. */
const DISMISS_VELOCITY = 0.8;
/** A pull upwards gives this much, and then holds. */
const OVERPULL = 24;
/**
 * Movement before a touch becomes a drag. Below both platforms' own touch slop,
 * so the sheet claims the gesture before a scroll view inside it can start one.
 */
const DRAG_SLOP = 4;
/** The sheet's rounder top. */
const SHEET_RADIUS = 32;
/** How far the footer's pills stand above the home indicator or navigation bar. */
const FOOTER_LIFT = space[3];
/** The handle's touch strip: the whole width, and a thumb's height. */
const HANDLE_HEIGHT = 28;

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Said once, at the top, beside the close button. */
  title: string;
  /**
   * Keep the title for screen readers but draw none: a sheet whose contents say
   * what it is — Filters — opens straight onto them, under its handle and close.
   */
  hideTitle?: boolean;
  /** What closing does — "Close filters" — for the close button and the scrim. */
  closeLabel: string;
  /** Actions pinned under the scrolling body, above the home indicator. */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * A sheet from the bottom edge that a thumb can always put away.
 *
 * Explore's filters opened in a transparent `Modal` that slid up with its scrim,
 * under a grab handle with no gesture behind it: the only ways out were the
 * close button, the scrim and the results button. A handle that does not drag is
 * a promise the sheet does not keep — on iOS, where every sheet swipes away, and
 * on Android, where the handle is the same invitation.
 *
 * It has two resting places — open at the height its content needs, capped below
 * the status bar, and gone — and it follows the finger between them:
 *
 * - **Only the handle drags it** (owner, 2026-09-28, as WhatsApp does), in either
 *   direction; upwards it gives a little and holds. The body never does: a drag
 *   there scrolls or works the control under the finger, and never has to guess
 *   which the person meant. The close button closes it with a tap.
 * - **Letting go past a quarter of its height, past 160pt, or on a downward
 *   flick closes it**, falling from wherever the finger left it at least as fast
 *   as the finger was going. Anything less springs home without overshooting.
 *
 * It draws its own entrance and exit on the native driver, and the scrim's
 * opacity follows the sheet's position, so a half-dragged sheet has a half-lifted
 * scrim. The Android back button, the scrim, the close button and VoiceOver's
 * escape all close it; the footer stays clear of the home indicator, and on iOS
 * the keyboard pushes the sheet up rather than covering its fields.
 */
export function BottomSheet({ visible, onClose, title, hideTitle = false, closeLabel, footer, children }: BottomSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  const [mounted, setMounted] = useState(false);
  const [height, setHeight] = useState(0);
  const [dragging, setDragging] = useState(false);

  const translate = useRef(new Animated.Value(windowHeight)).current;
  const dragBase = useRef(0);
  const releaseSpeed = useRef(0);
  const opening = useRef(false);
  // Read by gestures and effects that must not restart whenever these change.
  const travel = useRef(windowHeight);
  travel.current = height || windowHeight;
  const isMounted = useRef(mounted);
  isMounted.current = mounted;
  const still = useRef(reduceMotion);
  still.current = reduceMotion;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (visible) {
      releaseSpeed.current = 0;
      if (isMounted.current) {
        // Opened again while it was still falling: it rises from where it is.
        Animated.timing(translate, {
          toValue: 0,
          duration: still.current ? 0 : motion.duration.slow,
          easing: Easing.bezier(...motion.easing.enter),
          useNativeDriver: true,
        }).start();
      } else {
        // Held below the edge until its height is known; `measure` starts the rise.
        opening.current = true;
        translate.setValue(travel.current);
        setMounted(true);
      }
      return;
    }
    if (!isMounted.current) return;
    let cancelled = false;
    let fall: Animated.CompositeAnimation | null = null;
    translate.stopAnimation((from) => {
      if (cancelled) return;
      const remaining = Math.max(0, travel.current - from);
      // As fast as the finger that let it go, and never slower than crossing the
      // whole sheet in the base duration.
      const speed = Math.max(releaseSpeed.current, travel.current / motion.duration.base);
      fall = Animated.timing(translate, {
        toValue: travel.current,
        duration: still.current ? 0 : Math.min(motion.duration.base, remaining / speed),
        easing: Easing.bezier(...motion.easing.exit),
        useNativeDriver: true,
      });
      fall.start(({ finished }) => {
        if (finished) setMounted(false);
      });
    });
    return () => {
      cancelled = true;
      fall?.stop();
    };
  }, [translate, visible]);

  const measure = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next !== height) setHeight(next);
    if (!opening.current) return;
    opening.current = false;
    travel.current = next;
    translate.setValue(next);
    Animated.timing(translate, {
      toValue: 0,
      duration: reduceMotion ? 0 : motion.duration.slow,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    }).start();
  };

  const grab = useMemo(() => {
    const settle = (gesture: PanResponderGestureState) => {
      setDragging(false);
      const position = dragBase.current + gesture.dy;
      const letGo = Math.min(travel.current * DISMISS_SHARE, DISMISS_DISTANCE);
      if (position > letGo || (gesture.vy > DISMISS_VELOCITY && gesture.dy > 0)) {
        releaseSpeed.current = Math.max(0, gesture.vy);
        close.current();
        return;
      }
      // Not far enough and not fast enough: home, carrying the finger's speed.
      Animated.spring(translate, {
        toValue: 0,
        velocity: gesture.vy * 1000,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    };
    const vertical = (gesture: PanResponderGestureState) =>
      Math.abs(gesture.dy) > DRAG_SLOP && Math.abs(gesture.dy) > Math.abs(gesture.dx);
    return PanResponder.create({
        // The handle owns a touch from the moment it lands, as Explore's grabber
        // does. Waiting to take it on the first move left a touch with no owner
        // to take it from, and inside the sheet's modal on a phone the drag then
        // never began. The close button, deeper in the same row, still claims
        // its own tap first; a drag that starts on it is taken on the move.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: (_, gesture) => vertical(gesture),
        onPanResponderGrant: () => {
          Keyboard.dismiss();
          setDragging(true);
          dragBase.current = 0;
          translate.stopAnimation((value) => {
            dragBase.current = value;
          });
        },
        onPanResponderMove: (_, gesture) => {
          const next = dragBase.current + gesture.dy;
          translate.setValue(next >= 0 ? next : -OVERPULL * (1 - Math.exp(next / OVERPULL)));
        },
        // Once the sheet is moving, nothing inside it may take the drag away.
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, gesture) => settle(gesture),
        onPanResponderTerminate: (_, gesture) => settle(gesture),
      });
  }, [translate]);

  const scrim = useMemo(
    () => translate.interpolate({
      inputRange: [0, Math.max(1, height || windowHeight)],
      outputRange: [1, 0],
      extrapolate: "clamp",
    }),
    [translate, height, windowHeight],
  );

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* The sheet opens in its own window, which measures its own edges. */}
      <ModalSafeArea>
        <SafeInsets
          render={(edge) => (
            <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
              <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} style={styles.fill} />
              </Animated.View>
              <View pointerEvents="box-none" style={styles.stage}>
                <Animated.View
                  accessibilityViewIsModal
                  accessibilityLabel={hideTitle ? title : undefined}
                  onAccessibilityEscape={onClose}
                  onLayout={measure}
                  style={[
                    styles.sheet,
                    {
                      maxHeight: windowHeight - safeHeaderTop(edge.top) - space[3],
                      transform: [{ translateY: translate }],
                    },
                  ]}
                >
                  <View style={styles.clip}>
                    {/* The handle: the whole width of the sheet's top, and the one
                        place a drag moves it. Without a title, the close button
                        shares its row. */}
                    <View collapsable={false} style={[styles.handle, hideTitle ? styles.handleWithClose : null]} {...grab.panHandlers}>
                      <View style={styles.grabber} />
                      {hideTitle ? <View style={styles.handleClose}><Pressable
                            accessibilityRole="button"
                            accessibilityLabel={closeLabel}
                            hitSlop={6}
                            onPress={onClose}
                            {...pressableFeedback(theme.color.field["200"])}
                            style={({ pressed }) => [styles.close, pressed && !isAndroid ? styles.closePressed : null]}
                          >
                            <Ionicons name="close" size={20} color={theme.color.ink["700"]} />
                          </Pressable></View> : null}
                    </View>
                    {hideTitle ? null : (
                      <View style={styles.header}>
                        <Type variant="title2" accessibilityRole="header">{title}</Type>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={closeLabel}
                          hitSlop={6}
                          onPress={onClose}
                          {...pressableFeedback(theme.color.field["200"])}
                          style={({ pressed }) => [styles.close, pressed && !isAndroid ? styles.closePressed : null]}
                        >
                          <Ionicons name="close" size={20} color={theme.color.ink["700"]} />
                        </Pressable>
                      </View>
                    )}
                    <View style={styles.body}>
                      <ScrollView
                        scrollEnabled={!dragging}
                        bounces={false}
                        overScrollMode="never"
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={[
                          styles.bodyContent,
                          // A sheet with a footer takes its clearance there. Without
                          // one, the last row would sit under the home indicator, or
                          // under Android's navigation buttons — which then look as
                          // though the sheet were showing through them.
                          footer ? null : { paddingBottom: Math.max(edge.bottom, space[4]) },
                        ]}
                      >
                        <SheetScope>{children}</SheetScope>
                      </ScrollView>
                    </View>
                    {footer ? (
                      <View style={[styles.footer, { paddingBottom: Math.max(edge.bottom, space[4]) + FOOTER_LIFT }]}>
                        <SheetScope>{footer}</SheetScope>
                      </View>
                    ) : null}
                  </View>
                </Animated.View>
              </View>
            </KeyboardAvoidingView>
          )}
        />
      </ModalSafeArea>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  // `ink-950` at 44%: the tokens give the deepest chrome to scrims.
  scrim: {
    backgroundColor: "rgba(22,17,14,0.44)",
  },
  stage: {
    flex: 1,
    justifyContent: "flex-end",
  },
  // One warm grey from handle to footer, a round top and a soft shadow thrown
  // upwards. Nothing inside is ruled off: the white cards on it are what separate
  // one thing from another (owner, 2026-09-27, after WhatsApp's call sheet).
  sheet: {
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    backgroundColor: SHEET_GROUND,
    shadowColor: theme.color.ink["900"],
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  // The radius clips here, so iOS does not clip the shadow above with it.
  clip: {
    flexShrink: 1,
    overflow: "hidden",
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
  },
  handle: {
    height: HANDLE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  // Without a title the handle's row is tall enough for the close button too.
  handleWithClose: {
    height: 56,
  },
  handleClose: {
    position: "absolute",
    top: space[2] + 2,
    right: space[4],
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.color.field["300"],
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space[5],
    paddingRight: space[4],
  },
  close: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: theme.color.field["0"],
  },
  closePressed: {
    opacity: 0.72,
  },
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[1],
    paddingBottom: space[2],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingTop: space[3],
    paddingHorizontal: space[4],
    backgroundColor: SHEET_GROUND,
  },
});
