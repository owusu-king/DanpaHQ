import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

import { theme } from "@/theme";

/** Distance between two rows of dots, and between two dots along a row. */
const RING_GAP = 6;
const DOT_GAP = 6;
/** How many rows make up one wave. The middle rows are the strongest. */
const RINGS = 15;

/**
 * Rooomly's mobile header material: flat brand green with a dotted texture.
 *
 * Two bands of dotted contours sweep in from off-canvas, one low on the leading
 * side and one high on the trailing side, like a halftone print. The dots are a
 * deeper kola, so the texture reads as part of the green rather than something
 * laid on top of it. Each band fades toward its edges, so no row starts or stops
 * abruptly.
 *
 * This replaced a gradient with a translucent glass plane. Gradients and glare
 * read as an effect; a single colour with a fine texture reads as a material.
 *
 * Navigation still owns every measurement and safe-area inset. This layer only
 * paints inside that frame, takes no touches, and is hidden from screen readers.
 */
export function HeaderChromeBackground({ edge = true, leading = true, trailing = true }: {
  /** False where the green continues past the bottom — Explore's flared corners. */
  edge?: boolean;
  /** The low band on the leading side. Off for a header that a Home hero continues. */
  leading?: boolean;
  /** The high band on the trailing side. Off for the hero under such a header. */
  trailing?: boolean;
} = {}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.fill}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width !== size?.width || height !== size?.height) setSize({ width, height });
      }}
    >
      {size ? (
        <Svg width={size.width} height={size.height}>
          {/* Low on the leading side, curving up and away. */}
          {leading ? <Wave cx={-size.width * 0.15} cy={size.height * 1.9} inner={size.height * 1.15} /> : null}
          {/* High on the trailing side, curving down past the corner. */}
          {trailing ? <Wave cx={size.width * 1.08} cy={-size.height * 0.9} inner={size.height * 1.05} /> : null}
        </Svg>
      ) : null}
      {edge ? <View style={styles.edge} /> : null}
    </View>
  );
}

/** One band of dotted concentric rows around a centre off the canvas. */
function Wave({ cx, cy, inner }: { cx: number; cy: number; inner: number }) {
  return (
    <G>
      {Array.from({ length: RINGS }, (_, index) => {
        // 0 at either edge of the band, 1 in the middle.
        const strength = 1 - Math.abs(index - (RINGS - 1) / 2) / ((RINGS - 1) / 2);
        return (
          <Circle
            key={index}
            cx={cx}
            cy={cy}
            r={inner + index * RING_GAP}
            fill="none"
            stroke={theme.color.kola["900"]}
            strokeOpacity={0.06 + strength * 0.56}
            strokeWidth={2.2}
            strokeLinecap="round"
            // A near-zero dash with round caps draws a dot.
            strokeDasharray={`0.01 ${DOT_GAP}`}
          />
        );
      })}
    </G>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
  },
  edge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
});
