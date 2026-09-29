import Ionicons from "@expo/vector-icons/Ionicons";
import { createContext, useContext, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { Sheen } from "@/components/Sheen";
import { Type, radius, space } from "@/components/ui";
import { isAndroid } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * What every sheet is made of, so all of them read as one kind of thing (owner,
 * 2026-09-27, after WhatsApp's call sheet): a quiet grey sheet, its content on
 * white rounded cards with rules only between rows, and two pill actions at its
 * foot — a glass one for the quiet act and a deep kola one for the act that
 * finishes the job.
 */

/** The grey the sheet is, and the white its cards are. */
export const SHEET_GROUND = theme.color.field["100"];
export const SHEET_CARD = theme.color.field["0"];
export const SHEET_CARD_RADIUS = 20;
/** The act that finishes the job: kola, deep enough to carry the weight WhatsApp gives black. */
export const SHEET_PRIMARY = theme.color.kola["800"];

/**
 * Whether a component is inside a sheet. The panels and lists that pages draw as
 * paper held by a hairline read this and become the sheet's borderless white
 * cards, so a sheet needs no special parts to look like one.
 */
const InSheet = createContext(false);

export function SheetScope({ children }: { children: ReactNode }) {
  return <InSheet.Provider value>{children}</InSheet.Provider>;
}

export function useInSheet() {
  return useContext(InSheet);
}

/** How a panel looks when it stands on the sheet rather than on a page. */
export const sheetCardStyle = {
  overflow: "hidden",
  borderRadius: SHEET_CARD_RADIUS,
  borderWidth: 0,
  backgroundColor: SHEET_CARD,
  shadowOpacity: 0,
  elevation: 0,
} as const;

/**
 * A white card of rows on the sheet. Each row may draw its own rule above it; the
 * card pulls its first row up by a hairline and clips, so rules fall only between
 * rows.
 */
export function SheetCard({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  return (
    <View style={[styles.card, padded ? styles.cardPadded : null]}>
      <View style={styles.cardRows}>{children}</View>
    </View>
  );
}

/**
 * The quiet act: frosted glass on the grey. A translucent white, brighter at the
 * top where the light would catch it, with a white rim and a soft shadow under it.
 */
export function SheetGlassButton({
  label,
  icon,
  onPress,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const ink = disabled ? theme.color.ink["300"] : theme.color.ink["900"];
  return (
    <View style={[styles.frame, styles.glassLift]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.pill, styles.glass, pressed ? styles.pressed : null]}
      >
        <Sheen from={0.95} to={0.35} />
        {icon ? <Ionicons name={icon} size={18} color={ink} /> : null}
        <Type variant="bodyStrong" numberOfLines={1} style={[styles.text, { color: ink }]}>{label}</Type>
      </Pressable>
    </View>
  );
}

/** The act that finishes the job: deep kola under the same glass — a sheen along its top and a thin white rim. */
export function SheetPrimaryButton({
  label,
  icon,
  onPress,
  busy = false,
  busyLabel,
  disabled = false,
  tone = "kola",
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  /** Laterite for an act that removes or ends something. */
  tone?: "kola" | "danger";
  accessibilityLabel?: string;
}) {
  const inactive = busy || disabled;
  const fill = tone === "danger" ? theme.color.laterite["600"] : SHEET_PRIMARY;
  return (
    <View style={[styles.frame, isAndroid ? null : { shadowColor: fill, shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? busyLabel ?? label : accessibilityLabel ?? label}
        aria-disabled={inactive}
        aria-busy={busy}
        disabled={inactive}
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          styles.primaryRim,
          { backgroundColor: fill },
          inactive ? styles.inactive : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <Sheen from={0.22} to={0} />
        {busy ? (
          <ActivityIndicator size="small" color={theme.color.field["0"]} />
        ) : icon ? (
          <Ionicons name={icon} size={18} color={theme.color.field["0"]} />
        ) : null}
        <Type variant="bodyStrong" numberOfLines={1} style={[styles.text, { color: theme.color.field["0"] }]}>
          {busy ? busyLabel ?? label : label}
        </Type>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: sheetCardStyle,
  cardPadded: {
    paddingHorizontal: space[4],
  },
  cardRows: {
    marginTop: -StyleSheet.hairlineWidth,
  },
  // The frame carries the shadow and the width; the pill inside it clips.
  frame: {
    flex: 1,
    borderRadius: radius.pill,
  },
  // Android draws elevation under a translucent fill as a smudge, so there the
  // rim alone lifts the glass.
  glassLift: isAndroid
    ? {}
    : {
      shadowColor: theme.color.ink["900"],
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
  pill: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    overflow: "hidden",
    borderRadius: radius.pill,
  },
  glass: {
    borderWidth: 1,
    borderColor: alpha(theme.color.field["0"], 0.95),
    backgroundColor: alpha(theme.color.field["0"], 0.55),
  },
  // The thin white outline both pills share, so the solid one reads as glass too.
  primaryRim: {
    borderWidth: 1,
    borderColor: alpha(theme.color.field["0"], 0.34),
  },
  text: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.82,
  },
  inactive: {
    opacity: 0.5,
  },
});
