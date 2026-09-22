import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, View } from "react-native";

import { radius, space } from "@/components/ui";
import { isAndroid } from "@/platform";
import { alpha, shell } from "@/shell";

/** The visible disc. Smaller than the target it sits in, on purpose. */
const DISC = 40;
const COMPACT_DISC = 36;

/**
 * A circular action in a screen header.
 *
 * The disc is 40pt and the touch target is the system's 48pt floor, reached
 * with hit slop rather than by drawing a bigger circle — a header full of 48pt
 * discs looks heavy, and a 40pt one that is only 40pt to a thumb is the more
 * common mistake.
 *
 * A translucent white well on the kola chrome, with its glyph in white. It was a
 * paper disc while headers stood on the page; on green, solid white discs would
 * be the loudest thing in the frame.
 *
 * The press language is the tab bar's, deliberately: the same spring, the same
 * bounded Android ripple. Two navigation affordances on one screen that respond
 * differently to a thumb feel like two products.
 */
export function HeaderCircleButton({
  icon,
  label,
  onPress,
  imageUri,
  compact = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Shown instead of the glyph — a real face beats a generic silhouette. */
  imageUri?: string | null;
  /** Quieter paired actions keep the 48pt touch target. */
  compact?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const press = (toValue: number) =>
    Animated.spring(scale, { toValue, speed: 34, bounciness: 2, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => press(0.92)}
        onPressOut={() => press(1)}
        // Both disc sizes reach the 48pt floor without drawing a heavier circle.
        hitSlop={compact ? 6 : space[1]}
        android_ripple={
          isAndroid
            ? { color: shell.chromePressed, radius: (compact ? COMPACT_DISC : DISC) / 2, borderless: true }
            : undefined
        }
        style={({ pressed }) => [styles.disc, compact ? styles.compactDisc : null, pressed && !isAndroid ? styles.pressed : null]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} accessible={false} style={styles.photo} />
        ) : (
          <Ionicons name={icon} size={compact ? 17 : 20} color={shell.onChrome} />
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
    backgroundColor: shell.chromeRaised,
  },
  compactDisc: {
    width: COMPACT_DISC,
    height: COMPACT_DISC,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(shell.onChrome, 0.22),
  },
  pressed: {
    backgroundColor: shell.chromePressed,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
});
