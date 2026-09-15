import { Animated, StyleSheet, Text, View, type TextStyle } from "react-native";

import { shell } from "@/shell";

/**
 * Rooomly, set in type: white letters, and its three o's in the palest kola.
 *
 * Until there is a drawn logo this is the mark — on the launch curtain, where the
 * o's take turns rising, and as the title of both Homes, whose pages name
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
  /** One value per o, 0 at rest and 1 risen. Given only where the mark moves. */
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
      <Text allowFontScaling={false} accessibilityRole="header" accessibilityLabel="Rooomly" style={letters}>
        R<Text style={styles.o}>ooo</Text>mly
      </Text>
    );
  }

  return (
    <View accessible accessibilityLabel="Rooomly" style={styles.row}>
      <Text allowFontScaling={false} style={letters}>R</Text>
      {beats.map((beat, index) => (
        <Animated.Text
          key={index}
          allowFontScaling={false}
          style={[
            letters,
            styles.o,
            {
              opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
              transform: [
                { translateY: beat.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.1] }) },
              ],
            },
          ]}
        >
          o
        </Animated.Text>
      ))}
      <Text allowFontScaling={false} style={letters}>mly</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  o: {
    color: shell.markOnChrome,
  },
});
