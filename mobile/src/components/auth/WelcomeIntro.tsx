import Ionicons from "@expo/vector-icons/Ionicons";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { TextLink } from "@/components/auth/AuthFields";
import { motion, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { pressableFeedback } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

const KOLA = theme.color.kola["600"];
const INK = theme.color.ink["900"];
const MUTED = theme.color.ink["500"];
const WHITE = theme.color.field["0"];

/** The widest the column gets, on any screen. */
const MEASURE = 420;

/** How long one breath of the mark takes, in and out. Slow on purpose. */
const BREATH_MS = 3200;
/** How long the accent letters rest between hums. */
const HUM_REST_MS = 2400;
/** The part of the name set in kola, one letter per hum. */
const ACCENT = ["H", "Q"] as const;

/**
 * The first page of a fresh install: Danpa HQ saying hello.
 *
 * It picks up exactly where the launch curtain leaves off. The curtain is kola
 * dots taking turns on ivory; this is the same ivory, and that beat now lives in
 * the kola HQ of the name, the letters still taking turns, only slower — the app
 * has finished waiting and is humming. No green hero, no header, no form: a mark, a name,
 * one line of welcome, and the one thing to do.
 *
 * Arriving, everything settles into place top to bottom, the mark first. Once
 * it has, the mark breathes and the HQ hums; the button catches the light
 * once, to say it is ready. All of it holds still under Reduce Motion.
 */
export function WelcomeIntro({
  onStart,
  onSignIn,
  onExplore,
}: {
  onStart: () => void;
  onSignIn: () => void;
  onExplore: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  // Arrival, in order: mark, name, words, action, ways on.
  const [markIn, nameIn, wordsIn, actionIn, waysIn] = useRef(
    [0, 1, 2, 3, 4].map(() => new Animated.Value(0)) as [Animated.Value, Animated.Value, Animated.Value, Animated.Value, Animated.Value],
  ).current;
  const breath = useRef(new Animated.Value(0)).current;
  const hums = useRef(ACCENT.map(() => new Animated.Value(0))).current;
  const sheen = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const arrive = [markIn, nameIn, wordsIn, actionIn, waysIn];
    if (reduceMotion) {
      for (const value of arrive) value.setValue(1);
      return;
    }

    const entrance = Animated.stagger(
      90,
      arrive.map((value) =>
        Animated.spring(value, { toValue: 1, stiffness: 170, damping: 20, mass: 1, useNativeDriver: true }),
      ),
    );

    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );

    // The launch curtain's beat, slowed down: the accent letters, in turn.
    const hum = Animated.loop(
      Animated.sequence([
        Animated.stagger(
          motion.duration.base,
          hums.map((value) =>
            Animated.sequence([
              Animated.timing(value, { toValue: 1, duration: motion.duration.slow, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true }),
              Animated.timing(value, { toValue: 0, duration: motion.duration.slow * 1.6, easing: Easing.bezier(...motion.easing.standard), useNativeDriver: true }),
            ]),
          ),
        ),
        Animated.delay(HUM_REST_MS),
      ]),
    );

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );

    // Once, after everything has landed: the button catches the light.
    const shine = Animated.sequence([
      Animated.delay(250),
      Animated.timing(sheen, { toValue: 1, duration: 900, easing: Easing.bezier(...motion.easing.standard), useNativeDriver: true }),
    ]);

    glow.start();
    entrance.start(() => {
      breathe.start();
      hum.start();
      shine.start();
    });

    return () => {
      entrance.stop();
      breathe.stop();
      hum.stop();
      glow.stop();
      shine.stop();
    };
  }, [actionIn, breath, drift, hums, markIn, nameIn, reduceMotion, sheen, waysIn, wordsIn]);

  /** Fade up from a little below, settling on a spring. */
  const rise = (value: Animated.Value, distance = 14) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  return (
    <View style={styles.ground}>
      <StatusBar style="dark" />

      {/* Two soft lights on the ivory, drifting very slowly: enough colour that
          the page is never blank, never enough to be a pattern. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          styles.glowKola,
          { transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-12, 18] }) }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 22] }) }] },
        ]}
      >
        <Glow id="kola" color={theme.color.kola["300"]} strength={0.28} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          styles.glowGold,
          { transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [14, -16] }) }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [10, -14] }) }] },
        ]}
      >
        <Glow id="gold" color={theme.color.gold["300"]} strength={0.34} />
      </Animated.View>

      <View style={[styles.column, { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[6] }]}>
        <View style={styles.centre}>
          <Animated.View
            style={[
              styles.tile,
              {
                opacity: markIn,
                transform: [
                  { scale: markIn.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
                  { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) },
                ],
              },
            ]}
          >
            <Animated.View style={[styles.halo, { opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }]}>
              <Glow id="halo" color={theme.color.kola["300"]} strength={0.45} size={HALO} />
            </Animated.View>
            <View style={styles.tileFace}>
              <Ionicons name="home" size={34} color={WHITE} />
            </View>
          </Animated.View>

          <Animated.View style={[styles.wordmark, rise(nameIn, 10)]} accessible accessibilityRole="header" accessibilityLabel="Danpa HQ">
            {/* The H and Q move on their own, so the word space before them is a margin. */}
            <Text allowFontScaling={false} style={[styles.letters, styles.wordSpace]}>Danpa</Text>
            {hums.map((hum, index) => (
              <Animated.Text
                key={ACCENT[index]}
                allowFontScaling={false}
                style={[
                  styles.letters,
                  styles.accent,
                  {
                    opacity: hum.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
                    transform: [{ translateY: hum.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
                  },
                ]}
              >
                {ACCENT[index]}
              </Animated.Text>
            ))}
          </Animated.View>

          <Animated.View style={[styles.words, rise(wordsIn)]}>
            <Text maxFontSizeMultiplier={1.3} style={styles.welcome}>
              Welcome home.
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.line}>
              Find your next home, or look after the homes you provide.
            </Text>
          </Animated.View>
        </View>

        <View style={styles.foot}>
          <Animated.View style={rise(actionIn, 18)}>
            <Pressable
              onPress={onStart}
              accessibilityRole="button"
              accessibilityLabel="Get started"
              {...pressableFeedback(WHITE)}
              style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.sheen,
                  {
                    opacity: sheen.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] }),
                    transform: [
                      { translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-120, MEASURE] }) },
                      { rotate: "18deg" },
                    ],
                  },
                ]}
              />
              <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>
                Get started
              </Text>
              <Ionicons name="arrow-forward" size={18} color={WHITE} />
            </Pressable>
          </Animated.View>

          <Animated.View style={[styles.ways, rise(waysIn, 10)]}>
            <View style={styles.aside}>
              <Text maxFontSizeMultiplier={1.4} style={styles.asideText}>Already with us?</Text>
              <TextLink label="Sign in" strong onPress={onSignIn} />
            </View>
            <TextLink label="Explore homes first" muted onPress={onExplore} />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

/** A pool of light that fades to nothing at its edge, so it never reads as a shape. */
function Glow({ id, color, strength, size = GLOW }: { id: string; color: string; strength: number; size?: number }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={strength} />
          <Stop offset="0.55" stopColor={color} stopOpacity={strength * 0.4} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

const GLOW = 520;
/** The light the mark breathes in, a little wider than the mark itself. */
const HALO = 180;

const styles = StyleSheet.create({
  // The launch curtain's own ivory, so nothing changes colour on the way in.
  ground: {
    flex: 1,
    backgroundColor: shell.canvas,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    width: GLOW,
    height: GLOW,
  },
  glowKola: {
    top: -200,
    left: -220,
  },
  glowGold: {
    bottom: -20,
    right: -260,
  },
  column: {
    flex: 1,
    width: "100%",
    maxWidth: MEASURE,
    alignSelf: "center",
    paddingHorizontal: space[6],
  },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[5],
  },
  tile: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: HALO,
    height: HALO,
  },
  tileFace: {
    width: 84,
    height: 84,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: KOLA,
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  wordmark: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  letters: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.5,
    color: INK,
  },
  accent: {
    color: KOLA,
  },
  // About a word space at 22pt.
  wordSpace: {
    marginRight: 6,
  },
  words: {
    alignItems: "center",
    gap: space[3],
    marginTop: space[3],
  },
  welcome: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "600",
    letterSpacing: -0.6,
    textAlign: "center",
    color: INK,
  },
  line: {
    maxWidth: 320,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    color: MUTED,
  },
  foot: {
    gap: space[5],
  },
  action: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: 18,
    backgroundColor: KOLA,
    overflow: "hidden",
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  actionPressed: {
    backgroundColor: theme.color.kola["800"],
  },
  // A soft band of light, swept across once.
  sheen: {
    position: "absolute",
    top: -20,
    bottom: -20,
    left: 0,
    width: 56,
    backgroundColor: alpha(WHITE, 0.22),
  },
  actionText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    color: WHITE,
  },
  ways: {
    alignItems: "center",
    gap: space[3],
  },
  aside: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  asideText: {
    fontSize: 14,
    lineHeight: 20,
    color: MUTED,
  },
});
