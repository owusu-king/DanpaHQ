import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { alpha, shell } from "@/shell";

/** The same height as the search field and the Filters button beside it. */
const SIZE = 42;

/**
 * Saved, beside Explore's search: where a search here leads.
 *
 * Explore's top is one row — search, Saved, Filters — with no profile and no
 * bell (owner, 2026-10-06): a row of tools above the search made the top
 * heavy, and both are a tab away. Saved is a glass well, so the white Filters
 * button stays the one solid control beside the field.
 *
 * Scoped to the Explore *tab* rather than to the screen behind it. That screen
 * is `search.tsx`, which is also registered as a pushed `/search` route — one
 * component, two places — and a button wired inside it would have appeared on
 * both.
 */
export function ExploreHeaderActions() {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Saved"
      onPress={() => router.push("/(app)/saved" as never)}
      hitSlop={3}
      style={({ pressed }) => [styles.saved, pressed ? styles.pressed : null]}
    >
      <Ionicons name="bookmark-outline" size={18} color={shell.onChrome} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  saved: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.chromeRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(shell.onChrome, 0.3),
  },
  pressed: {
    backgroundColor: shell.chromePressed,
  },
});
