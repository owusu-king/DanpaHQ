import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { radius, space } from "@/components/ui";
import { press as pressSpring, PRESS_SCALE } from "@/motion";
import { isAndroid } from "@/platform";
import { theme } from "@/theme";

/** The visible disc. Smaller than the target it sits in, on purpose. */
const DISC = 40;

/**
 * A circular action in a screen header.
 *
 * The disc is 40pt and the touch target is the system's 48pt floor, reached
 * with hit slop rather than by drawing a bigger circle — a header full of 48pt
 * discs looks heavy, and a 40pt one that is only 40pt to a thumb is the more
 * common mistake. The provider header's `+` is 42pt with no slop and misses the
 * floor; this is the shape that should replace it.
 *
 * The press language is the tab bar's, deliberately: the same spring, the same
 * bounded Android ripple. Two navigation affordances on one screen that respond
 * differently to a thumb feel like two products.
 *
 * It used to be the same spring by transcription — `speed: 34, bounciness: 2`
 * written out here and again in the tab bar. It is now the same spring because
 * both import it.
 */
export function HeaderCircleButton({
  icon,
  label,
  onPress,
  imageUri,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Shown instead of the glyph — a real face beats a generic silhouette. */
  imageUri?: string | null;
}) {
  const scale = useSharedValue(1);
  const discStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const press = (toValue: number) => {
    scale.value = withSpring(toValue, pressSpring);
  };

  return (
    <Animated.View style={discStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => press(PRESS_SCALE)}
        onPressOut={() => press(1)}
        // 40pt disc + 4pt each side = the 48pt floor, without a heavier circle.
        hitSlop={space[1]}
        android_ripple={
          isAndroid
            ? { color: theme.color.kola["50"], radius: DISC / 2, borderless: true }
            : undefined
        }
        style={({ pressed }) => [styles.disc, pressed && !isAndroid ? styles.pressed : null]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} accessible={false} style={styles.photo} />
        ) : (
          <Ionicons name={icon} size={20} color={theme.color.ink["700"]} />
        )}
      </Pressable>
    </Animated.View>
  );
}

/** The row these sit in. Exported so a header does not restate the spacing. */
export function HeaderActions({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginRight: space[4],
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: theme.color.field["100"],
  },
  pressed: {
    backgroundColor: theme.color.field["200"],
  },
  photo: {
    width: "100%",
    height: "100%",
  },
});
