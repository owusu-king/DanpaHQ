import { Image, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { theme } from "@/theme";
import { OPENING_SCENE } from "./scenes";

/**
 * A band of the welcome scene, above the sign-in form.
 *
 * Sign-in is one tap from the journey's choice and is where most launches end
 * up, so the product's face should not appear once per installation and then
 * never again. This is the first scene's own artwork, cropped to a header.
 *
 * It draws nothing of its own. An earlier version hand-authored rooftops out of
 * SVG rectangles and triangles — the same mistake, and the same result, as the
 * scenes it was meant to echo. When the illustration is installed this shows a
 * band of it; until then it is the same tonal wash the journey uses.
 *
 * Static: no pager, no parallax, no loop. A header that moves while somebody is
 * typing a password is a header that is in the way.
 */
export function AuthCrest({ height = 132 }: { height?: number }) {
  const scene = OPENING_SCENE;

  return (
    <View
      style={{ height, overflow: "hidden" }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      >
        <Defs>
          <LinearGradient id="crest-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={scene.wash[0]} />
            <Stop offset="1" stopColor={theme.color.field["50"]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#crest-wash)" />
      </Svg>

      {scene.layers[0]?.source ? (
        <Image
          source={scene.layers[0].source}
          // Anchored to the top of the artwork: the interesting half of the
          // scene is its upper 60%, and a header centred on the canvas would
          // show the ground the art was told to leave empty.
          resizeMode="cover"
          style={{ width: "100%", height: "100%" }}
        />
      ) : null}

      {/* The form's ground, so the band settles into the page rather than
          ending on a line. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: Math.round(height * 0.35),
          backgroundColor: theme.color.field["50"],
          opacity: 0.9,
        }}
      />
    </View>
  );
}
