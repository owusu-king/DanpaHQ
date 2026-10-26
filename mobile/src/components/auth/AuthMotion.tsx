import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { motion, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { hapticsPolicy, pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Motion for the way in, kept apart from the frame it plays on.
 *
 * `AuthScene` is static by contract — a header that moves while somebody types
 * a password is in the way — so nothing here touches the hero. What moves is
 * the panel's content as a step arrives, a choice as it is made, a field that
 * was refused, and the moment an account exists. Everything is opacity and
 * transform on the native driver, inside the tokens' 140–320ms, and collapses
 * to a cut when the system asks for reduced motion.
 */

const KOLA = theme.color.kola["600"];
const DEEP = theme.color.kola["900"];
const WHITE = theme.color.field["0"];
const enter = Easing.bezier(...motion.easing.enter);
const standard = Easing.bezier(...motion.easing.standard);

/** A selection tick, iOS only: Android's motors make it read as a fault. */
export function tick() {
  if (!hapticsPolicy.onSelection) return;
  void import("expo-haptics")
    .then((haptics) => haptics.selectionAsync())
    .catch(() => null);
}

/**
 * A step arriving: its content lifts 12 points into place as it fades in.
 *
 * Paired with the stack's own transition, this is what makes role → details →
 * number → code read as one surface changing its question rather than four
 * pages replacing each other. `index` staggers siblings by 40ms, no more.
 */
export function Rise({
  children,
  index = 0,
  style,
}: {
  children: ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: reduce ? 0 : motion.duration.slow,
      delay: reduce ? 0 : 60 + index * 40,
      easing: enter,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [index, progress, reduce]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A short sideways shake whenever `signal` changes to something truthy.
 *
 * For a submission that was refused: the field is already tinted and says why,
 * and the shake is what draws the eye to it from the button. Six points, three
 * swings, 260ms — a nudge, not a tremor.
 */
export function Shake({ signal, children }: { signal: unknown; children: ReactNode }) {
  const reduce = useReduceMotion();
  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!signal || reduce) return;
    const swing = (to: number) =>
      Animated.timing(offset, { toValue: to, duration: 52, easing: standard, useNativeDriver: true });
    const run = Animated.sequence([swing(-6), swing(5), swing(-3), swing(2), swing(0)]);
    run.start();
    return () => run.stop();
  }, [offset, reduce, signal]);

  return <Animated.View style={{ transform: [{ translateX: offset }] }}>{children}</Animated.View>;
}

/**
 * One of the two answers to "How will you use Danpa HQ?".
 *
 * A compact row (owner, 2026-10-13): the tall cards with their bullet lists
 * made a two-way choice feel heavy. A tile, a name, one line, and a tick at the
 * end. The chosen row takes its hue as a fill and an edge, its tile turns
 * solid, and the tick settles in — the fill and the tick fade, the row itself
 * breathes 1% and back.
 */
export function RoleCard({
  icon,
  tone,
  title,
  body,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: { ink: string; wash: string; deep: string };
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  const reduce = useReduceMotion();
  const on = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const press = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = Animated.timing(on, {
      toValue: selected ? 1 : 0,
      duration: reduce ? 0 : motion.duration.base,
      easing: standard,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [on, reduce, selected]);

  const pressTo = (value: number) =>
    Animated.timing(press, {
      toValue: value,
      duration: reduce ? 0 : motion.duration.fast,
      easing: standard,
      useNativeDriver: true,
    }).start();

  const scale = Animated.multiply(
    press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }),
    on.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.012, 1] }),
  );

  return (
    <Animated.View style={[styles.roleShadow, { transform: [{ scale }] }]}>
      <Pressable
        onPress={() => {
          tick();
          onPress();
        }}
        onPressIn={() => pressTo(1)}
        onPressOut={() => pressTo(0)}
        accessibilityRole="radio"
        aria-checked={selected}
        accessibilityLabel={`${title}. ${body}`}
        {...pressableFeedback(alpha(tone.ink, 0.12))}
        style={[styles.role, selected ? { borderColor: tone.ink } : null]}
      >
        {/* The chosen fill sits behind the content and fades rather than snapping. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tone.wash, opacity: on }]}
        />
        <View style={styles.roleTile}>
          <View style={[StyleSheet.absoluteFill, styles.roleTileFill, { backgroundColor: tone.wash }]} />
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.roleTileFill, { backgroundColor: tone.ink, opacity: on }]}
          />
          <Ionicons name={icon} size={22} color={selected ? WHITE : tone.ink} />
        </View>
        <View style={styles.roleText}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.roleTitle, { color: selected ? tone.deep : ROLE_INK }]}>
            {title}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.roleBody}>
            {body}
          </Text>
        </View>
        <View style={styles.roleCheck}>
          <View style={[StyleSheet.absoluteFill, styles.roleRing]} />
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.roleTick,
              { backgroundColor: tone.ink, opacity: on, transform: [{ scale: on.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] },
            ]}
          >
            <Ionicons name="checkmark" size={14} color={WHITE} />
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const ROLE_INK = theme.color.ink["900"];

/**
 * The moment an account exists: a disc grows in, the tick lands a beat later,
 * and one soft ring spreads out and fades. Once, never looping — a success that
 * keeps celebrating starts to look like it is waiting for something.
 */
export function SuccessMark({ tone = KOLA }: { tone?: string }) {
  const reduce = useReduceMotion();
  const disc = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const mark = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const ring = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) return;
    const run = Animated.parallel([
      Animated.timing(disc, { toValue: 1, duration: motion.duration.slow, easing: enter, useNativeDriver: true }),
      Animated.timing(mark, { toValue: 1, duration: motion.duration.base, delay: 160, easing: enter, useNativeDriver: true }),
      Animated.timing(ring, { toValue: 1, duration: 640, delay: 120, easing: standard, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [disc, mark, reduce, ring]);

  return (
    <View style={styles.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.successRing,
          {
            borderColor: tone,
            opacity: ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.45, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.55] }) }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.successDisc,
          {
            backgroundColor: tone,
            opacity: disc,
            transform: [{ scale: disc.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          },
        ]}
      >
        <Animated.View
          style={{
            opacity: mark,
            transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
          }}
        >
          <Ionicons name="checkmark" size={38} color={WHITE} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * A soft breathing dot, for a state that is in somebody else's hands: a review
 * under way. Slow (1.6s), small, and still under reduced motion.
 */
export function PendingPulse({ color = theme.color.gold["600"] }: { color?: string }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) return;
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: standard, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: standard, useNativeDriver: true }),
      ]),
    );
    run.start();
    return () => run.stop();
  }, [pulse, reduce]);

  return (
    <View style={styles.pulse}>
      <Animated.View
        style={[
          styles.pulseHalo,
          {
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.04] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
          },
        ]}
      />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  roleShadow: {
    borderRadius: 18,
    shadowColor: DEEP,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  // One row: tile, name and line, tick. A choice between two, not a brochure.
  role: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingLeft: space[3],
    paddingRight: space[4],
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
    overflow: "hidden",
  },
  roleTile: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  roleTileFill: {
    borderRadius: 13,
  },
  roleCheck: {
    width: 22,
    height: 22,
  },
  roleRing: {
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: alpha(DEEP, 0.2),
  },
  roleTick: {
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  roleText: {
    flex: 1,
    gap: 2,
  },
  roleTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
  },
  roleBody: {
    color: theme.color.ink["500"],
    fontSize: 13.5,
    lineHeight: 18,
  },

  success: {
    width: 112,
    height: 112,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  successRing: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
  },
  successDisc: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
  },

  pulse: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseHalo: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

/**
 * A field's focus, drawn behind its row: a breath of tint and an edge that
 * grows down the leading side. It used to switch on in one frame, which on a
 * form of six rows read as the page flickering as the keyboard moved through it.
 */
export function FieldEdge({ focused, wrong }: { focused: boolean; wrong: boolean }) {
  const reduce = useReduceMotion();
  const lit = useRef(new Animated.Value(focused || wrong ? 1 : 0)).current;

  useEffect(() => {
    const run = Animated.timing(lit, {
      toValue: focused || wrong ? 1 : 0,
      duration: reduce ? 0 : motion.duration.fast,
      easing: standard,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [focused, lit, reduce, wrong]);

  const hue = wrong ? theme.color.laterite["600"] : KOLA;
  const wash = wrong ? theme.color.laterite["100"] : theme.color.kola["50"];

  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: wash, opacity: lit }]} />
      <Animated.View
        pointerEvents="none"
        style={[
          edgeStyles.edge,
          { backgroundColor: hue, opacity: lit, transform: [{ scaleY: lit.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] },
        ]}
      />
    </>
  );
}

const edgeStyles = StyleSheet.create({
  edge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
});
