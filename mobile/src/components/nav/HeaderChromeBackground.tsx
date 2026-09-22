import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { theme } from "@/theme";

const WHITE = theme.color.field["0"];

/**
 * Rooomly's mobile header material.
 *
 * Navigation still owns every measurement and safe-area inset. This layer only
 * paints within that stable frame: brand green with tonal depth, a soft light
 * catch, and one translucent architectural plane. The result reads as glass
 * without blur, visual noise, or compromised title contrast.
 */
export function HeaderChromeBackground() {
  const id = `header${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.fill}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`${id}tone`} x1="0" y1="0" x2="1" y2="0.9">
            <Stop offset="0" stopColor={theme.color.kola["800"]} />
            <Stop offset="0.3" stopColor={theme.color.kola["600"]} />
            <Stop offset="0.72" stopColor={theme.color.kola["600"]} />
            <Stop offset="1" stopColor={theme.color.kola["800"]} />
          </LinearGradient>
          <LinearGradient id={`${id}glaze`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={WHITE} stopOpacity={0.11} />
            <Stop offset="0.48" stopColor={WHITE} stopOpacity={0.025} />
            <Stop offset="1" stopColor={theme.color.kola["900"]} stopOpacity={0.1} />
          </LinearGradient>
          <RadialGradient id={`${id}light`} cx="0.84" cy="0" r="0.82">
            <Stop offset="0" stopColor={WHITE} stopOpacity={0.2} />
            <Stop offset="0.42" stopColor={WHITE} stopOpacity={0.055} />
            <Stop offset="1" stopColor={WHITE} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}depth`} cx="0" cy="1" r="0.9">
            <Stop offset="0" stopColor={theme.color.kola["900"]} stopOpacity={0.19} />
            <Stop offset="1" stopColor={theme.color.kola["900"]} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}tone)`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}depth)`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}glaze)`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}light)`} />
      </Svg>

      <View style={styles.glassPlane}>
        <View style={styles.planeHighlight} />
      </View>
      <View style={styles.edge} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  glassPlane: {
    position: "absolute",
    top: "-52%",
    right: "5%",
    width: "38%",
    height: "205%",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.075)",
    backgroundColor: "rgba(255,255,255,0.026)",
    transform: [{ rotate: "-12deg" }],
  },
  planeHighlight: {
    width: StyleSheet.hairlineWidth,
    height: "100%",
    marginLeft: "27%",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  edge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
});
