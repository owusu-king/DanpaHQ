import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { EDGE, INK, KOLA, KOLA_DEEP, MUTED, PRESSED, RecordPanel } from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Type, radius, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** What choosing it gets you, when the label alone does not say. */
  detail?: string;
};

/**
 * One answer out of a set, chosen from a sheet.
 *
 * `Choice` lays its options out as a wrapping row of chips. That is right for
 * two or three short words and wrong for everything else: a water source, a
 * meter type, a relationship to a property and a kind of space are each five or
 * six options of uneven length, and a form asking four such questions became a
 * screenful of loose chips with no shape to it.
 *
 * This reads as a field — the same height, the same frame, the same focus
 * language as a text input — so a form of questions looks like a form. Pressing
 * it opens the answers as full-width rows, where a long label has room and each
 * can say what it means underneath itself.
 *
 * A native picker would be the obvious alternative and is not used: it cannot
 * carry a second line per option, it looks different on each platform, and on
 * Android it is a dialog that the app's own sheet language already replaced.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  placeholder = "Choose",
  disabled = false,
  onChange,
}: {
  label: string;
  value: T | "";
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  const empty = !chosen;

  return (
    <View style={styles.group}>
      <Type variant="caption" style={styles.label}>{label}</Type>

      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        aria-disabled={disabled}
        accessibilityLabel={`${label}. ${chosen ? chosen.label : placeholder}`}
        accessibilityHint="Opens the answers"
        disabled={disabled || options.length === 0}
        onPress={() => setOpen(true)}
        {...pressableFeedback(theme.color.kola["50"])}
        style={({ pressed }) => [
          styles.trigger,
          open ? styles.triggerOpen : null,
          disabled ? styles.dim : null,
          pressed ? { backgroundColor: PRESSED } : null,
        ]}
      >
        <Type
          variant={empty ? "body" : "bodyStrong"}
          numberOfLines={1}
          style={[styles.value, empty ? styles.placeholder : null]}
        >
          {options.length === 0 ? "Loading…" : chosen ? chosen.label : placeholder}
        </Type>
        <Ionicons name="chevron-down" size={18} color={open ? KOLA : theme.color.ink["500"]} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={label}
        closeLabel={`Close ${label.toLocaleLowerCase("en-GH")}`}
      >
        <View style={styles.sheetBody}>
          <RecordPanel>
            <View accessibilityRole="radiogroup" accessibilityLabel={label}>
              {options.map((option, index) => (
                <Option
                  key={option.value}
                  first={index === 0}
                  option={option}
                  selected={option.value === value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                />
              ))}
            </View>
          </RecordPanel>
        </View>
      </BottomSheet>
    </View>
  );
}

function Option<T extends string>({
  first,
  option,
  selected,
  onPress,
}: {
  first: boolean;
  option: SelectOption<T>;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-selected={selected}
      accessibilityLabel={option.detail ? `${option.label}. ${option.detail}` : option.label}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["100"])}
      style={({ pressed }) => [
        styles.option,
        first ? null : styles.ruled,
        selected ? styles.optionOn : null,
        pressed ? { backgroundColor: theme.color.field["100"] } : null,
      ]}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={19}
        color={selected ? KOLA : theme.color.ink["300"]}
        style={styles.mark}
      />
      <View style={styles.optionBody}>
        <Type
          variant={selected ? "bodyStrong" : "body"}
          style={[styles.optionLabel, selected ? styles.optionLabelOn : null]}
        >
          {option.label}
        </Type>
        {option.detail ? (
          <Type variant="caption" numberOfLines={2} style={styles.optionDetail}>{option.detail}</Type>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: space[2],
  },
  label: {
    color: theme.color.ink["700"],
  },
  /** The same frame a `Field` wears, so a form reads as one set of controls. */
  trigger: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.color.field["300"],
    backgroundColor: theme.color.field["0"],
  },
  triggerOpen: {
    borderWidth: 2,
    borderColor: KOLA,
    backgroundColor: theme.color.kola["50"],
  },
  dim: {
    opacity: 0.55,
  },
  value: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  placeholder: {
    color: theme.color.ink["300"],
  },
  sheetBody: {
    gap: space[4],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  option: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  optionOn: {
    backgroundColor: theme.color.kola["50"],
  },
  mark: {
    marginTop: 1,
  },
  optionBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  optionLabelOn: {
    color: KOLA_DEEP,
  },
  optionDetail: {
    fontSize: 13,
    lineHeight: 17,
    color: MUTED,
  },
});
