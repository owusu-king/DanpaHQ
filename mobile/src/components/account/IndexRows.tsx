import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The rows both index screens are made of.
 *
 * A provider's index lives on More and a tenant's on their profile tab. What
 * they list legitimately differs — a tenant has no Team and no Archive; a
 * provider has no rental history — but they were built twice and had to be kept
 * in step by hand, which is how the two drifted apart in the first place. The
 * membership belongs to each screen; the row does not.
 *
 * A row names its destination and nothing else. `Security ›` is complete.
 */

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Type variant="label">{title.toUpperCase()}</Type>
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
        {children}
      </View>
    </View>
  );
}

export function Row({
  icon,
  label,
  count = 0,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Shown only when there is something to say. Zero is not news. */
  count?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={count ? `${label}, ${count} unread` : label}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        minHeight: 56,
        paddingVertical: space[3],
        borderTopWidth: 1,
        borderTopColor: theme.color.field["200"],
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={theme.color.ink["500"]} />
      <Type variant="bodyStrong" style={{ flex: 1, minWidth: 0 }}>{label}</Type>
      {count ? (
        <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>{count}</Type>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={theme.color.ink["300"]} />
    </Pressable>
  );
}

/**
 * Changing view and leaving are acts, not destinations, so neither gets a
 * section, a heading or a paragraph explaining itself.
 */
export function QuietLink({
  label,
  busyLabel,
  busy = false,
  tone = "accent",
  onPress,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  tone?: "accent" | "quiet";
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: "center",
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      <Type
        variant="bodyStrong"
        style={{ color: tone === "accent" ? theme.color.kola["600"] : theme.color.ink["500"] }}
      >
        {busy ? busyLabel ?? "Working…" : label}
      </Type>
    </Pressable>
  );
}
