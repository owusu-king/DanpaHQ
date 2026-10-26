import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef } from "react";
import { Animated, Pressable, View } from "react-native";

import { ph, Register, useHomeDensity } from "@/components/home/plinth";
import { Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

export type Shortcut = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** A count worth knowing before tapping. Omitted, not zero, when there is none. */
  count?: number;
};

/**
 * The rest of the tenant's rental life, one tap away.
 *
 * Deliberately last and deliberately quiet. Everything above it answers *what
 * needs me* and *what am I renting*; this answers *where is everything else*,
 * which is a different question and a lesser one. Putting Saved and Services in
 * cards among the tenancy content would give navigation the same weight as an
 * overdue rent charge.
 *
 * Which is also why these are the one thing on Home that is *not* a paper
 * surface: frosted glass on the green ground rather than white cards, so they
 * read as the edge of the page rather than as another card of content.
 *
 * A count appears only when there is something to count. "Saved · 0" is not
 * information, and a row of zeroes reads as a product nobody uses.
 *
 * Not attention. Notifications sits here rather than in the panel above because
 * Home already derives what is outstanding from the records themselves —
 * `notificationMeaning` says so in as many words: "Home is what actually knows
 * what is outstanding; this never claims to." An unread flag is a weaker signal
 * than an unpaid charge, and showing both would say the same thing twice, less
 * accurately the second time.
 */
export function HomeShortcuts({ shortcuts }: { shortcuts: Shortcut[] }) {
  const density = useHomeDensity();
  if (!shortcuts.length) return null;

  return (
    <View style={{ gap: space[2], marginTop: density.compact ? space[1] : space[2] }}>
      {/* On the ground, not on a card, so it is set dark enough to read there. */}
      <Type
        variant="label"
        accessibilityRole="header"
        style={{ fontSize: density.labelSize, lineHeight: 14, color: ph.ink70 }}
      >
        EVERYTHING ELSE
      </Type>
      <Register width={density.compact ? 18 : 22} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[1] }}>
        {shortcuts.map((shortcut) => (
          <ShortcutTile key={shortcut.id} shortcut={shortcut} />
        ))}
      </View>
    </View>
  );
}

function ShortcutTile({ shortcut }: { shortcut: Shortcut }) {
  const density = useHomeDensity();
  const scale = useRef(new Animated.Value(1)).current;

  const press = (toValue: number) =>
    Animated.spring(scale, { toValue, speed: 34, bounciness: 2, useNativeDriver: true }).start();

  const counted = typeof shortcut.count === "number" && shortcut.count > 0;

  return (
    // Two per row on any handset, without measuring the screen: each tile takes
    // just under half the width and the gap absorbs the difference.
    <Animated.View style={{ flexBasis: "48%", flexGrow: 1, transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          counted ? `${shortcut.label}, ${shortcut.count}` : shortcut.label
        }
        onPress={shortcut.onPress}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        {...pressableFeedback(ph.paperDim)}
        style={({ pressed }) => ({
          minHeight: theme.targetMin,
          flexDirection: "row",
          alignItems: "center",
          gap: density.compact ? space[2] : space[3],
          paddingVertical: space[3],
          paddingHorizontal: density.compact ? space[2] : space[3],
          borderRadius: density.compact ? 12 : 14,
          // Frosted glass: the ground shows through, and a bright rim catches
          // the light where a card would carry a shadow.
          borderWidth: 1,
          borderColor: ph.glassEdge,
          backgroundColor: ph.glass,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <Ionicons name={shortcut.icon} size={density.compact ? 16 : 18} color={ph.graphite} />
        <Type variant="bodyStrong" numberOfLines={1} style={{ flex: 1, fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, color: ph.ink70 }}>
          {shortcut.label}
        </Type>
        {counted ? (
          <View style={{ minWidth: density.compact ? 18 : 20, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 20, alignItems: "center", backgroundColor: ph.goldSoft }}>
            <Type variant="caption" style={{ fontSize: density.compact ? 10 : 11, lineHeight: 15, fontWeight: "600", color: ph.ink }}>
              {shortcut.count}
            </Type>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
