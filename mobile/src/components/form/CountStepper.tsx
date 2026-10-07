import { Pressable, StyleSheet, View } from "react-native";

import { EDGE, INK, KOLA, PAPER } from "@/components/record/RecordSurfaces";
import { Type, radius, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * A small count with − and +: bedrooms, bathrooms, a floor. Three of these sit
 * on one line where three number boxes and a keyboard took a screenful
 * (owner, 2026-10-05: "smaller input fields that can nicely be arranged").
 */
export function CountStepper({
  label,
  value,
  onChange,
  min = 0,
  max = 20,
  format,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** How the number reads, e.g. 0 → "Ground". */
  format?: (value: number) => string;
}) {
  const shown = format ? format(value) : String(value);
  return (
    <View
      style={styles.box}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: shown }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") onChange(Math.min(max, value + 1));
        if (event.nativeEvent.actionName === "decrement") onChange(Math.max(min, value - 1));
      }}
    >
      <Type variant="caption" style={styles.label}>{label}</Type>
      <View style={styles.row}>
        <Round glyph="−" disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} />
        <Type variant="bodyStrong" style={styles.value} numberOfLines={1}>{shown}</Type>
        <Round glyph="+" disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} />
      </View>
    </View>
  );
}

/** A yes/no question a count would overstate: "Own bathroom?" */
export function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.box}>
      <Type variant="caption" style={styles.label}>{label}</Type>
      <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {([true, false] as const).map((option) => {
          const on = value === option;
          return (
            <Pressable
              key={String(option)}
              accessibilityRole="radio"
              aria-checked={on}
              onPress={() => onChange(option)}
              style={({ pressed }) => [styles.half, on ? styles.halfOn : null, pressed && !on ? styles.pressed : null]}
            >
              <Type variant="caption" style={[styles.halfText, on ? styles.halfTextOn : null]}>
                {option ? "Yes" : "No"}
              </Type>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Round({ glyph, disabled, onPress }: { glyph: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      importantForAccessibility="no"
      accessibilityElementsHidden
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.round, disabled ? styles.roundOff : null, pressed ? styles.pressed : null]}
    >
      <Type variant="bodyStrong" style={[styles.glyph, disabled ? styles.glyphOff : null]}>{glyph}</Type>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexGrow: 1,
    flexBasis: 140,
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: PAPER,
  },
  label: { color: theme.color.ink["700"] },
  // Tight enough that "Ground" fits in half a phone's width (two to a row).
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[1] },
  value: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 22, color: INK, textAlign: "center" },
  round: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  roundOff: { backgroundColor: theme.color.field["100"] },
  glyph: { fontSize: 18, lineHeight: 22, color: KOLA },
  glyphOff: { color: theme.color.ink["300"] },
  pressed: { opacity: 0.7 },
  track: {
    flexDirection: "row",
    gap: 4,
    padding: 3,
    borderRadius: 999,
    backgroundColor: theme.color.field["100"],
  },
  half: { flex: 1, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  halfOn: { backgroundColor: KOLA },
  halfText: { fontWeight: "500", color: theme.color.ink["700"] },
  halfTextOn: { color: PAPER },
});
