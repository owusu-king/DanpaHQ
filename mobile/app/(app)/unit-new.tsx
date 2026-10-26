import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { PropertyChoices, usePropertyChoices } from "@/components/property/AddUnitSheet";
import { INK, KOLA } from "@/components/record/RecordSurfaces";
import { Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";

/**
 * The same choice the Units tab now asks in a sheet (`useAddUnit`), for the
 * entry points that arrive as a screen. Nothing is created here; it chooses,
 * then hands over to `space-new`. Coming from a Property it never appears.
 */
export default function AddUnitScreen() {
  const pageBottom = useSafeBottom(space[8]);
  const choices = usePropertyChoices();
  const { load } = choices;

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} keyboardShouldPersistTaps="handled">
      <View style={styles.title}>
        <Type variant="label" style={styles.eyebrow}>NEW UNIT</Type>
        <Type variant="title2" accessibilityRole="header" style={styles.heading}>Which Property?</Type>
      </View>
      <PropertyChoices choices={choices} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[3],
  },
  title: {
    gap: space[1],
    paddingHorizontal: 2,
  },
  eyebrow: {
    color: KOLA,
  },
  heading: {
    fontSize: 19,
    lineHeight: 25,
    color: INK,
  },
});
