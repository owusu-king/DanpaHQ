import { View } from "react-native";
import Animated from "react-native-reanimated";

import { ph, useHomeDensity } from "@/components/home/plinth";
import { useSkeletonPulse } from "@/motion";

/**
 * The shape of the screen, before it arrives.
 *
 * Home used to say "Loading your homes…" on one caption line, then push the
 * whole page down when the data landed. Blocks that match the real surfaces'
 * geometry cost nothing and buy two things: the layout does not jump, and the
 * wait reads as this screen loading rather than as this screen being empty.
 *
 * White surfaces on the canvas, in the places the Overview, the attention panel
 * and the homes will occupy. The pulse is the quietest one that still says
 * "working", and it is `useSkeletonPulse` rather than a loop written here so
 * that the provider's Portfolio — which drew the same blocks and forgot to move
 * them at all — breathes at the same rate.
 */
export function HomeSkeleton() {
  const density = useHomeDensity();
  const pulse = useSkeletonPulse();

  const block = (height: number) => ({
    height,
    borderRadius: density.cardRadius,
    backgroundColor: ph.paper,
    borderWidth: 1,
    borderColor: ph.line,
  });

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your homes"
      style={[{ gap: density.sectionGap }, pulse]}
    >
      <View style={block(density.compact ? 176 : 200)} />
      <View style={block(density.compact ? 116 : 132)} />
      <View style={block(density.compact ? 148 : 168)} />
    </Animated.View>
  );
}
