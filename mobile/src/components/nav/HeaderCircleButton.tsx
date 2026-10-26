import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { radius, space } from "@/components/ui";
import { isAndroid } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

/** The visible disc. Smaller than the target it sits in, on purpose. */
const DISC = 40;

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
  bare = false,
  badge = 0,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Shown instead of the glyph — a real face beats a generic silhouette. */
  imageUri?: string | null;
  /** Just the glyph on the green, the way the tab headers draw their tools. A
   *  well appears only while it is pressed. */
  bare?: boolean;
  /** Unread work behind this button. Shown as a count, capped at 9+. */
  badge?: number;
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
        hitSlop={space[1]}
        android_ripple={
          isAndroid
            ? { color: shell.chromePressed, radius: DISC / 2, borderless: true }
            : undefined
        }
        style={({ pressed }) => [
          styles.disc,
          bare ? styles.bareDisc : null,
          pressed && (bare || !isAndroid) ? styles.pressed : null,
        ]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} accessible={false} style={styles.photo} />
        ) : (
          <Ionicons name={icon} size={bare ? 23 : 20} color={shell.onChrome} />
        )}
      </Pressable>
      {badge > 0 ? (
        <View pointerEvents="none" style={styles.badge}>
          <Text allowFontScaling={false} style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
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
  bareDisc: {
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  pressed: {
    backgroundColor: shell.chromePressed,
  },
  // Laterite, cut out of the green by a ring of the chrome itself.
  badge: {
    position: "absolute",
    top: -3,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.laterite["600"],
    borderWidth: 2,
    borderColor: shell.chrome,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "600",
    color: shell.onChrome,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
});
