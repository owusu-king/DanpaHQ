import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/shell/Wordmark";
import { motion, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { shell } from "@/shell";

/** How long a launch may take before it says why it is taking so long. */
const PATIENCE_MS = 8000;

/**
 * What stands in front of Rooomly while it works out who is looking.
 *
 * Before it knows the account, the role and the route, a launch has one honest
 * thing to show: the product's name. Anything more specific is a guess, and the
 * guesses were the problem — a refresh drew whichever screen the address named
 * before there was a session, which for a tenant's Home was the signed-out
 * browsing page, and only then swapped the dashboard in.
 *
 * It is the chrome — Rooomly's green, with the mark in white — so a launch goes
 * from the splash to this to the first header without changing colour. The o's
 * take turns rising, and that is the whole of the motion. It says "working" in
 * Rooomly's own letters rather than in a platform spinner, and it holds still for
 * anybody who has asked the system to reduce motion — the name is the point; the
 * movement is only reassurance.
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
      accessibilityLabel={slow ? "Opening Rooomly. Still connecting." : "Opening Rooomly"}
      style={styles.ground}
    >
      <Wordmark size={44} beats={beats} />
      {/* A short rule under the name: the register the rest of the app draws. */}
      <View style={styles.register} />
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
  ground: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.chrome,
  },
  register: {
    width: space[8],
    height: 2,
    marginTop: space[3],
    borderRadius: 1,
    backgroundColor: shell.markOnChrome,
  },
  slow: {
    position: "absolute",
    left: space[8],
    right: space[8],
    textAlign: "center",
    fontSize: 14,
    lineHeight: 21,
    color: shell.onChromeMuted,
  },
});
