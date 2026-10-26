import { Animated, StyleSheet, Text, View, type TextStyle } from "react-native";

import { shell } from "@/shell";

/** The name, split where the mark changes colour and a word space falls: Danpa, then HQ. */
const BASE = "Danpa";
const ACCENT = ["H", "Q"] as const;

/**
 * Danpa HQ, set in type: white letters, and its HQ in the palest kola.
 *
 * Until there is a drawn logo this is the mark — on the launch curtain, where the
 * H and the Q take turns rising, and as the title of both Homes, whose pages name
 * themselves with a greeting and whose header would otherwise be an empty band.
 *
 * It is never scaled by the reader's font size: it is a mark rather than text to
 * be read, and its accessible name is the word.
 */
export function Wordmark({
  size = 20,
  beats,
}: {
  size?: number;
  /** One value per accent letter, 0 at rest and 1 risen. Given only where the mark moves. */
  beats?: readonly Animated.Value[];
}) {
  const letters: TextStyle = {
    fontSize: size,
    lineHeight: Math.round(size * 1.2),
    fontWeight: "700",
    letterSpacing: Number((-0.027 * size).toFixed(2)),
    color: shell.onChrome,
  };

  if (!beats) {
    return (
      <Text allowFontScaling={false} accessibilityRole="header" accessibilityLabel="Danpa HQ" style={letters}>
        {`${BASE} `}
        <Text style={styles.accent}>{ACCENT.join("")}</Text>
      </Text>
    );
  }

  return (
    <View accessible accessibilityLabel="Danpa HQ" style={styles.row}>
      {/* Separate letters cannot share a space character, so the word space is a margin. */}
      <Text allowFontScaling={false} style={[letters, { marginRight: Math.round(size * 0.26) }]}>{BASE}</Text>
      {ACCENT.map((letter, index) => {
        const beat = beats[index];
        return (
          <Animated.Text
            key={letter}
            allowFontScaling={false}
            style={[
              letters,
              styles.accent,
              beat
                ? {
                    opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
                    transform: [
                      { translateY: beat.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.1] }) },
                    ],
                  }
                : null,
            ]}
          >
            {letter}
          </Animated.Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  accent: {
    color: shell.markOnChrome,
  },
});
