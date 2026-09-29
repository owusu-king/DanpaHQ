import { Pressable, StyleSheet, View } from "react-native";

import { Type, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * Two or three sides of one page — Rent or Buy on Explore, Selling or Buying in
 * Enquiries. A pill track with the chosen side filled in kola, the same shape
 * the web draws (`.explore-mode`), so the two clients read as one product.
 */
export function PillSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.track}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            aria-selected={selected}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              selected ? styles.chosen : null,
              pressed && !selected ? styles.pressed : null,
            ]}
          >
            <Type variant="bodyStrong" style={[styles.text, selected ? styles.chosenText : null]}>
              {option.label}
            </Type>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 4,
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["0"],
  },
  option: {
    minWidth: 84,
    minHeight: 38,
    paddingHorizontal: space[4],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  chosen: {
    backgroundColor: theme.color.kola["600"],
  },
  pressed: {
    backgroundColor: theme.color.kola["50"],
  },
  text: {
    fontSize: 15,
    lineHeight: 20,
    color: theme.color.ink["700"],
  },
  chosenText: {
    color: theme.color.field["0"],
  },
});
