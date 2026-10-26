import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { motion, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { shell } from "@/shell";
import { theme } from "@/theme";

/** How long a launch may take before it says why it is taking so long. */
const PATIENCE_MS = 8000;

/**
 * What stands in front of Danpa HQ while it works out who is looking.
 *
 * Three dots on the ground the app itself opens onto, and nothing else.
 *
 * It used to be the full chrome — a green field with the wordmark in white —
 * which is a brand moment in the one place nobody wants one: the delay before
 * their own screen. It also meant a launch changed colour twice, green to
 * ivory, on the way to a page that is ivory. Waiting should look like waiting.
 *
 * The dots take turns, and that is the whole of the motion. They hold still for
 * anybody who has asked the system to reduce motion.
 */
export function LaunchScreen() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const beats = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      for (const beat of beats) beat.setValue(1);
      return;
    }
    const rise = (beat: Animated.Value) =>
      Animated.sequence([
        Animated.timing(beat, {
          toValue: 1,
          duration: motion.duration.base,
          easing: Easing.bezier(...motion.easing.enter),
          useNativeDriver: true,
        }),
        Animated.timing(beat, {
          toValue: 0,
          duration: motion.duration.slow,
          easing: Easing.bezier(...motion.easing.standard),
          useNativeDriver: true,
        }),
      ]);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.stagger(motion.duration.fast, beats.map(rise)),
        Animated.delay(motion.duration.base),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beats, reduceMotion]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={slow ? "Opening Danpa HQ. Still connecting." : "Opening Danpa HQ"}
      style={styles.ground}
    >
      <View style={styles.dots}>
        {beats.map((beat, index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              {
                // A dot lifts and brightens together, so the beat reads on a
                // screen too dim to show a four-point rise on its own.
                opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.32, 1] }),
                transform: [{ translateY: beat.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
              },
            ]}
          />
        ))}
      </View>
      {slow ? (
        <Text style={[styles.slow, { bottom: insets.bottom + space[10] }]}>
          Still connecting. This can take a moment on a slow network.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The launch screen, held over the navigator until the gate has settled.
 *
 * Opaque the instant it is needed — a fade *in* would be a frame of the wrong
 * screen — and lifted only once the screen behind it is the right one, after a
 * beat for that screen's first frame to land. It is the same curtain for a launch,
 * a sign-in and a sign-out, because each is a change of who is looking.
 */
export function LaunchCurtain({ settled }: { settled: boolean }) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    if (!settled) {
      opacity.stopAnimation();
      opacity.setValue(1);
      setLifted(false);
      return;
    }
    const lift = Animated.timing(opacity, {
      toValue: 0,
      delay: motion.duration.fast,
      duration: reduceMotion ? 0 : motion.duration.base,
      easing: Easing.bezier(...motion.easing.exit),
      useNativeDriver: true,
    });
    lift.start(({ finished }) => {
      if (finished) setLifted(true);
    });
    return () => lift.stop();
  }, [opacity, reduceMotion, settled]);

  if (settled && lifted) return null;

  return (
    <Animated.View
      pointerEvents={settled ? "none" : "auto"}
      accessibilityViewIsModal={!settled}
      // A constant while unsettled: the animated value may still be at the end of
      // the last lift, and one frame of it would show the screen being hidden.
      style={[StyleSheet.absoluteFill, { opacity: settled ? opacity : 1 }]}
    >
      <LaunchScreen />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The ivory the app itself opens onto, and which `app.json` gives the native
  // splash, so a launch never changes colour on its way to the first screen.
  ground: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.canvas,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.color.kola["600"],
  },
  slow: {
    position: "absolute",
    left: space[8],
    right: space[8],
    textAlign: "center",
    fontSize: 14,
    lineHeight: 21,
    color: theme.color.ink["500"],
  },
});
