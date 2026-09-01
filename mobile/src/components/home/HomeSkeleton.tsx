import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

import { ph, useHomeDensity } from "@/components/home/plinth";
import { motion } from "@/components/ui";
import { useReduceMotion } from "@/motion";

/**
 * The shape of the screen, before it arrives.
 *
 * Home used to say "Loading your homes…" on one caption line, then push the
 * whole page down when the data landed. Blocks that match the real surfaces'
 * geometry cost nothing and buy two things: the layout does not jump, and the
 * wait reads as this screen loading rather than as this screen being empty.
 *
 * Paper on stone, in the places the Overview, the attention panel and the homes
 * will occupy. The pulse is the quietest one that still says "working" —
 * opacity between 0.45 and 1, on the shared `base` duration. Reduce Motion
 * holds it still rather than removing it, because the shape is the point and
 * the movement is only the reassurance.
 */
export function HomeSkeleton() {
  const density = useHomeDensity();
  const pulse = useRef(new Animated.Value(0.45)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.75);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: motion.duration.slow,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: motion.duration.slow,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  const block = (height: number) => ({
    height,
    borderRadius: density.compact ? 14 : 16,
    backgroundColor: ph.paper,
    borderWidth: 1,
    borderColor: ph.line,
  });

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your homes"
      style={{ gap: density.sectionGap, opacity: pulse }}
    >
      <View style={block(density.compact ? 176 : 200)} />
      <View style={block(density.compact ? 116 : 132)} />
      <View style={block(density.compact ? 148 : 168)} />
    </Animated.View>
  );
}
