import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useHomeDensity } from "@/components/home/plinth";
import { Type, radius, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * A list's filters, out where they can be seen (owner, 2026-10-06).
 *
 * The Properties and Units lists hid their filters behind one Filter button
 * and a sheet, then said what was on in tokens under the heading — three
 * controls for one choice. Now each choice is a chip in a row that scrolls
 * sideways: its colour, its name and how many it holds, and the one that is
 * on is filled. A choice with nothing in it steps back rather than vanishing,
 * so the row never reshuffles under a thumb.
 */

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  count: number;
  /** The colour this state has elsewhere; none for the "everything" choice. */
  tone?: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

const INK = theme.color.ink["900"];
const WHITE = theme.color.field["0"];
const EDGE = alpha(theme.color.kola["900"], 0.1);
const KOLA_DEEP = theme.color.kola["800"];

export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  quiet = false,
}: {
  /** What the row chooses, for a screen reader. */
  label: string;
  /** A second row under the first: its choice is outlined rather than filled, so the two do not compete. */
  quiet?: boolean;
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const density = useHomeDensity();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      style={{ marginHorizontal: -density.pagePadding }}
      contentContainerStyle={{ gap: space[2], paddingHorizontal: density.pagePadding, paddingVertical: 2 }}
    >
      {options.map((option) => {
        const on = option.value === value;
        const tone = option.tone ?? KOLA_DEEP;
        const filled = on && !quiet;
        const outlined = on && quiet;
        const empty = option.count === 0 && !on;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            aria-selected={on}
            accessibilityLabel={`${option.label}, ${option.count}`}
            onPress={() => onChange(option.value)}
            {...pressableFeedback(alpha(tone, 0.12))}
            style={({ pressed }) => [
              styles.chip,
              filled ? { backgroundColor: tone, borderColor: tone } : null,
              outlined ? { backgroundColor: theme.color.kola["50"], borderColor: tone, borderWidth: 1.5 } : null,
              empty ? styles.empty : null,
              pressed && !on ? { backgroundColor: alpha(tone, 0.08) } : null,
            ]}
          >
            {option.icon ? (
              <Ionicons name={option.icon} size={15} color={filled ? WHITE : tone} />
            ) : option.tone ? (
              <View style={[styles.dot, { backgroundColor: filled ? WHITE : tone }]} />
            ) : null}
            <Type variant="captionStrong" numberOfLines={1} style={[styles.label, { color: filled ? WHITE : outlined ? tone : INK }]}>
              {option.label}
            </Type>
            <View style={[styles.count, { backgroundColor: filled ? alpha(WHITE, 0.22) : alpha(tone, 0.12) }]}>
              <Type variant="captionStrong" style={[styles.countText, { color: filled ? WHITE : tone }]}>{option.count}</Type>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A small round tool beside a search field: sort, or anything that toggles. */
export function ToolButton({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-selected={active}
      onPress={onPress}
      {...pressableFeedback(alpha(KOLA_DEEP, 0.1))}
      style={({ pressed }) => [styles.tool, active ? styles.toolOn : null, pressed ? { opacity: 0.85 } : null]}
    >
      <Ionicons name={icon} size={19} color={active ? WHITE : KOLA_DEEP} />
    </Pressable>
  );
}

/** The list's one way to add, beside its heading: compact, solid, and named. */
export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      {...pressableFeedback(theme.color.kola["900"])}
      style={({ pressed }) => [styles.add, pressed ? { backgroundColor: theme.color.kola["900"] } : null]}
    >
      <Ionicons name="add" size={18} color={WHITE} />
      <Type variant="captionStrong" numberOfLines={1} style={styles.addText}>{label}</Type>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  add: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: radius.pill,
    backgroundColor: KOLA_DEEP,
  },
  addText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: WHITE,
  },
  chip: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: WHITE,
  },
  empty: {
    opacity: 0.55,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 13.5,
    lineHeight: 18,
  },
  count: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    fontSize: 12,
    lineHeight: 16,
  },
  tool: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: WHITE,
  },
  toolOn: {
    borderColor: KOLA_DEEP,
    backgroundColor: KOLA_DEEP,
  },
});

