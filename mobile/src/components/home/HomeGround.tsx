import { useId, useState, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { ph } from "@/components/home/plinth";
import { theme } from "@/theme";

/** The light across the top corner: frosted glass catching a window, no more. */
const SHEEN_OPACITY = 0.46;
/** A pool of the green low on the far side, so the tone is never one flat fill. */
const DEPTH_OPACITY = 0.05;

/**
 * The ground both Homes are drawn on: Rooomly's green, let down into the ivory
 * until it is a tone rather than a colour.
 *
 * It replaced a warm stone, which under the kola header read as a second, duller
 * brand, with paper cards a shade of the same beige. The ground is now the
 * header's own green softened into the page — deepest just under the header,
 * lightest where the list runs out — with a breath of light across the top
 * corner and a faint pool of green low on the far side. The cards on it are
 * white, so they lift by tone alone and need only a whisper of shadow.
 *
 * It is painted once, behind the scroller, and does not scroll: the content
 * moves over a still ground. It takes no touches and says nothing to a screen
 * reader.
 *
 * It used to take `active`, so the tenant's Home could hold the same tree
 * without painting while signed out — back when that screen was a wall of
 * listing cards, which on the ground would have read as a dashboard. The
 * listings moved to Explore where they belong, both Homes now paint in every
 * state, and a prop nothing passes is machinery pretending to be an option.
 */
export function HomeGround({ children }: { children: ReactNode }) {
  const window = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // One per mount, and safe inside `url(#…)`: two grounds in one web document
  // never share a gradient.
  const id = `ground${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const width = size?.width ?? window.width;
  const height = size?.height ?? window.height;

  return (
    <View
      style={[styles.fill, styles.painted]}
      onLayout={(event) => {
        const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
        if (nextWidth !== size?.width || nextHeight !== size?.height) setSize({ width: nextWidth, height: nextHeight });
      }}
    >
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={StyleSheet.absoluteFill}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={`${id}tone`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={ph.groundTop} />
                <Stop offset="0.55" stopColor={ph.ground} />
                <Stop offset="1" stopColor={ph.groundLow} />
              </LinearGradient>
              <RadialGradient
                id={`${id}sheen`}
                gradientUnits="userSpaceOnUse"
                cx={width * 0.92}
                cy={0}
                r={Math.max(width * 0.95, 1)}
              >
                <Stop offset="0" stopColor={theme.color.field["0"]} stopOpacity={SHEEN_OPACITY} />
                <Stop offset="1" stopColor={theme.color.field["0"]} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient
                id={`${id}depth`}
                gradientUnits="userSpaceOnUse"
                cx={0}
                cy={height}
                r={Math.max(width, 1)}
              >
                <Stop offset="0" stopColor={theme.color.kola["600"]} stopOpacity={DEPTH_OPACITY} />
                <Stop offset="1" stopColor={theme.color.kola["600"]} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}tone)`} />
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}depth)`} />
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}sheen)`} />
          </Svg>
        </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  // Under the gradient, and all that shows for the frame before it draws.
  painted: {
    backgroundColor: ph.ground,
  },
});
