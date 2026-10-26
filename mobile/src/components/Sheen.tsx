import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { theme } from "@/theme";

/**
 * White light across a surface, strongest along its top edge: what makes a pill
 * read as glass rather than paint. Every glass button and the tab bar draw it.
 * Silent to a screen reader and never in the way of a touch.
 */
export function Sheen({ from, to, until = 1 }: { from: number; to: number; until?: number }) {
  const id = `sheen${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.color.field["0"]} stopOpacity={from} />
            <Stop offset={until} stopColor={theme.color.field["0"]} stopOpacity={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
