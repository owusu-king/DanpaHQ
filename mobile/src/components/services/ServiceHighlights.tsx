import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Platform, Pressable, StyleSheet, View } from "react-native";

import { Type, motion, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

const WHITE = theme.color.field["0"];
const HIGHLIGHTS = [
  {
    title: "Everyday essentials",
    body: "Keep your household numbers together.",
    icon: "wallet-outline",
  },
  {
    title: "A name you recognise",
    body: "Label saved numbers so each is easy to find.",
    icon: "pricetag-outline",
  },
  {
    title: "Ready when you need it",
    body: "Find saved details in the services below.",
    icon: "file-tray-outline",
  },
] as const;

/** One steady glass surface. Only its story fades; the catalogue stays still. */
export function ServiceHighlights() {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [screenReader, setScreenReader] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const playing = focused && foreground && !paused && !reduceMotion && !screenReader;
  const highlight = HIGHLIGHTS[current] ?? HIGHLIGHTS[0];

  useEffect(() => {
    let live = true;
    // React Native Web returns true unconditionally; it cannot detect a reader.
    // Browser users retain reduced-motion support and explicit playback controls.
    if (Platform.OS !== "web") {
      void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
        if (live) setScreenReader(enabled);
      });
    }
    const reader = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    const app = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => {
      live = false;
      reader.remove();
      app.remove();
    };
  }, []);

  useEffect(() => {
    if (!playing) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.duration.base,
        easing: Easing.bezier(...motion.easing.enter),
        useNativeDriver: true,
      }),
      Animated.delay(6000),
      Animated.timing(opacity, {
        toValue: 0,
        duration: motion.duration.fast,
        easing: Easing.bezier(...motion.easing.exit),
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setCurrent((index) => (index + 1) % HIGHLIGHTS.length);
    });
    return () => animation.stop();
  }, [current, opacity, playing]);

  return (
    <View>
      <View style={styles.frame}>
        <Animated.View
          accessible
          accessibilityLabel={`${highlight.title}. ${highlight.body}`}
          style={[styles.story, { opacity }]}
        >
          <View style={styles.copy}>
            <Type variant="title2" style={styles.title}>{highlight.title}</Type>
            <Type variant="body" style={styles.body}>{highlight.body}</Type>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.illustration}>
            <Ionicons name={highlight.icon} size={40} color={theme.color.kola["50"]} />
          </View>
        </Animated.View>
        <Type variant="caption" style={styles.note}>Service payments coming soon</Type>
      </View>
      <View style={styles.pagination}>
        {!reduceMotion && !screenReader ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paused ? "Play service highlights" : "Pause service highlights"}
            onPress={() => setPaused((value) => !value)}
            {...pressableFeedback(alpha(theme.color.kola["800"], 0.08))}
            style={({ pressed }) => [styles.control, pressed ? styles.pressed : null]}
          >
            <Ionicons name={paused ? "play-outline" : "pause-outline"} size={14} color={theme.color.kola["800"]} />
          </Pressable>
        ) : null}
        <View accessible accessibilityLabel={`Highlight ${current + 1} of ${HIGHLIGHTS.length}`} style={styles.dots}>
          {HIGHLIGHTS.map((item, index) => (
            <View key={item.title} style={[styles.dot, index === current && styles.activeDot]} />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next service highlight"
          onPress={() => { setPaused(true); setCurrent((index) => (index + 1) % HIGHLIGHTS.length); }}
          {...pressableFeedback(alpha(theme.color.kola["800"], 0.08))}
          style={({ pressed }) => [styles.control, pressed ? styles.pressed : null]}
        >
          <Ionicons name="chevron-forward" size={16} color={theme.color.kola["800"]} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: theme.color.kola["800"],
    borderWidth: 1,
    borderColor: alpha(WHITE, 0.18),
    borderRadius: 14,
    minHeight: 148,
    padding: space[4],
    gap: space[2],
    overflow: "hidden",
  },
  story: { flex: 1, minHeight: 90, flexDirection: "row", alignItems: "center", gap: space[4] },
  copy: { flex: 1, gap: 6 },
  illustration: { width: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, lineHeight: 23, letterSpacing: -0.2, color: WHITE },
  body: { fontSize: 13, lineHeight: 18, color: alpha(WHITE, 0.88) },
  note: { fontSize: 11, lineHeight: 16, color: alpha(WHITE, 0.78) },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: alpha(theme.color.kola["800"], 0.15) },
  activeDot: { width: 20, backgroundColor: theme.color.kola["800"] },
  control: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  pressed: { backgroundColor: alpha(theme.color.kola["800"], 0.08) },
});
