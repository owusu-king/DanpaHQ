import { Image, View, type LayoutRectangle } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useReduceMotion } from "@/motion";
import { theme } from "@/theme";
import { SCENE_ART, type Scene, type SceneLayer } from "./scenes";

/**
 * The stage the welcome illustrations play on.
 *
 * One street seen three times, with the camera moving between them. This file
 * moves the camera; `scenes.ts` says what is being photographed, and
 * `assets/welcome/README.md` says how it should be drawn.
 *
 * **It draws nothing itself, on purpose.** The version before this one
 * hand-authored the buildings and the people out of SVG rectangles, triangles
 * and two quadratic curves. That yields geometry, not illustration, and it read
 * exactly like what it was. Artwork belongs to an illustrator; a component's
 * job is to carry it well.
 *
 * **Moved on the UI thread.** Every layer is an ordinary view translating from
 * the pager's scroll offset, so the parallax stays smooth on a device that has
 * better things to do with its main thread. Two layers per scene at different
 * rates is the depth.
 *
 * Each layer owns one worklet that reads the shared offset directly. The
 * version before this built an `Animated.Value.interpolate` chain per layer on
 * every render — six interpolation nodes rebuilt whenever this component
 * re-rendered, for a number that had not changed.
 *
 * Until the art is installed each scene is a plain tonal wash. That is
 * deliberately not a placeholder illustration: a wrong picture is worse than an
 * honest absence, and the wash still lets the movement and the type be judged.
 */
export function WelcomeWorld({
  scroll,
  width,
  scenes,
  frame,
}: {
  /** The pager's horizontal offset, in pixels. */
  scroll: SharedValue<number>;
  width: number;
  scenes: number;
  /** The area the world is drawn into. */
  frame: LayoutRectangle | null;
}) {
  const reduceMotion = useReduceMotion();
  const height = frame?.height ?? 320;

  return (
    <View style={{ flex: 1, overflow: "hidden" }} pointerEvents="none">
      {SCENE_ART.slice(0, scenes).map((scene, index) => (
        <SceneStage
          key={index}
          scene={scene}
          index={index}
          width={width}
          scroll={scroll}
          reduceMotion={reduceMotion}
        />
      ))}

      {/* The ground the headline sits on, so type never lands on busy art. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: Math.round(height * 0.42),
          backgroundColor: theme.color.field["50"],
          opacity: 0.94,
        }}
      />
    </View>
  );
}

/** Every layer fills the stage it is drawn on. */
const FILL = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };

/**
 * One scene, visible only while its own stop is the one on screen.
 *
 * A component rather than a function returning JSX, because each of these owns
 * a worklet and a hook cannot be called from inside a `map`.
 */
function SceneStage({
  scene,
  index,
  width,
  scroll,
  reduceMotion,
}: {
  scene: Scene;
  index: number;
  width: number;
  scroll: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const from = (index - 1) * width;
  const at = index * width;
  const to = (index + 1) * width;

  const sceneStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scroll.value, [from, at, to], [0, 1, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[FILL, sceneStyle]}>
      {/* The ground the scene settles onto, and all there is until the
          artwork arrives. */}
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`wash-${index}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={scene.wash[0]} />
            <Stop offset="1" stopColor={scene.wash[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#wash-${index})`} />
      </Svg>

      {scene.layers.map((layer, depthIndex) =>
        layer.source ? (
          <ParallaxLayer
            key={depthIndex}
            source={layer.source}
            depth={layer.depth}
            width={width}
            centre={at}
            scroll={scroll}
            reduceMotion={reduceMotion}
          />
        ) : null,
      )}
    </Animated.View>
  );
}

/**
 * One plane of a scene, sliding at its own rate.
 *
 * The travel is measured from the scene's own centre rather than from the start
 * of the journey, so every scene parallaxes as it comes through instead of the
 * third one having drifted three screens' worth before anybody sees it.
 */
function ParallaxLayer({
  source,
  depth,
  width,
  centre,
  scroll,
  reduceMotion,
}: {
  source: NonNullable<SceneLayer["source"]>;
  depth: number;
  width: number;
  centre: number;
  scroll: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const travel = width * depth * 0.5;

  const layerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: reduceMotion
          ? 0
          : interpolate(
              scroll.value,
              [centre - width, centre, centre + width],
              [travel, 0, -travel],
              Extrapolation.CLAMP,
            ),
      },
    ],
  }));

  return (
    <Animated.View style={[FILL, layerStyle]}>
      <Image
        source={source}
        // Cropped to fill: the canvas is drawn wider than any phone so the sides
        // can be lost without losing the subject. The art direction keeps
        // everything that matters in the top 60%.
        resizeMode="cover"
        style={{ width: "100%", height: "100%" }}
        // Decorative. The headline beside it is the accessible content.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Animated.View>
  );
}
