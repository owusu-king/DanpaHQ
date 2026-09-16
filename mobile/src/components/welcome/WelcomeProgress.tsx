import { View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { radius } from "@/components/ui";
import { theme } from "@/theme";

/** One step's width. Small enough to read as progress, not as a control. */
const SEGMENT = 26;

/**
 * Where you are in the introduction.
 *
 * Not `● ○ ○`. Rooomly already draws progress as checkpoints — one segment per
 * step, filling as they clear — on every property setup in the product, and an
 * introduction that arrives before anything else may as well teach the shape
 * the rest of the app uses.
 *
 * The filled segment tracks the swipe rather than snapping at the end of it, so
 * a half-finished gesture shows itself half-finished. That is what makes a
 * pager feel like it is being dragged rather than clicked.
 */
export function WelcomeProgress({
  scroll,
  width,
  scenes,
}: {
  scroll: SharedValue<number>;
  width: number;
  scenes: number;
}) {
  return (
    <View
      style={{ flexDirection: "row", gap: 4 }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: scenes }}
      accessibilityLabel={`Introduction, ${scenes} steps`}
    >
      {Array.from({ length: scenes }, (_, index) => (
        <Segment key={index} index={index} width={width} scroll={scroll} />
      ))}
    </View>
  );
}

/** One step. A component of its own, because each owns a worklet. */
function Segment({
  index,
  width,
  scroll,
}: {
  index: number;
  width: number;
  scroll: SharedValue<number>;
}) {
  const fill = useAnimatedStyle(() => ({
    // Slid in behind a clip, not scaled: React Native scales from the centre, so
    // a scaled fill would grow outward from the middle of the segment instead of
    // filling it from the left. Translating a full-width bar under
    // `overflow: hidden` gives the right shape, on the UI thread either way.
    transform: [
      {
        translateX: interpolate(
          scroll.value,
          [(index - 1) * width, index * width, (index + 1) * width],
          [-SEGMENT, 0, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <View
      style={{
        width: SEGMENT,
        height: 4,
        borderRadius: radius.pill,
        backgroundColor: theme.color.field["200"],
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[
          {
            height: "100%",
            borderRadius: radius.pill,
            backgroundColor: theme.color.kola["600"],
            width: SEGMENT,
          },
          fill,
        ]}
      />
    </View>
  );
}
