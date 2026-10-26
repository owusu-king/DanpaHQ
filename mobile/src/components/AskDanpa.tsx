import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { space, Type } from "@/components/ui";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/** A threshold, seen in perspective: a place to bring housing into focus. */
export function AskDanpaMark({ size = 24, onChrome = false }: { size?: number; onChrome?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none" accessible={false}>
      <Path d="M6 27V14a10 10 0 0 1 20 0v13M12 27V14a4 4 0 0 1 8 0v13" stroke={onChrome ? shell.onChrome : theme.color.kola["800"]} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M3 27h26" stroke={onChrome ? theme.color.gold["300"] : theme.color.gold["600"]} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

/** Presentation only. No composer, account data, network requests or AI service. */
export function AskDanpaSurface({ onSupport }: { onSupport?: () => void } = {}) {
  const { height, width } = useWindowDimensions();
  const compact = height < 620 || width < 350;

  return (
    <View style={[styles.surface, compact ? styles.surfaceCompact : null]}>
      <View style={styles.identity}>
        <View style={styles.brand}>
          <AskDanpaMark size={32} />
          <Text accessibilityRole="header" style={styles.brandName}>Danpa Intel</Text>
        </View>
        <Text style={styles.status}>Coming soon</Text>
      </View>

      <View style={[styles.introduction, compact ? styles.introductionCompact : null]}>
        <Text style={styles.eyebrow}>HOUSING INTELLIGENCE</Text>
        <Type variant="title1" style={styles.headline}>A clearer view of your housing.</Type>
        <Type variant="body" style={styles.description}>
          Danpa HQ’s future housing intelligence. A place to make sense of your housing information and consider what comes next.
        </Type>
      </View>

      <View style={styles.directions}>
        <Text style={styles.directionLabel}>LOOKING AHEAD</Text>
        <View accessible style={styles.direction}>
          <Ionicons name="reader-outline" size={20} color={theme.color.kola["800"]} accessible={false} />
          <View style={styles.directionText}>
            <Type variant="bodyStrong" style={styles.directionTitle}>Understand the details</Type>
            <Type variant="body" style={styles.directionBody}>Clearer context for the housing information you keep here.</Type>
          </View>
        </View>
        <View accessible style={[styles.direction, styles.directionRuled]}>
          <Ionicons name="navigate-outline" size={20} color={theme.color.kola["800"]} accessible={false} />
          <View style={styles.directionText}>
            <Type variant="bodyStrong" style={styles.directionTitle}>Find the next step</Type>
            <Type variant="body" style={styles.directionBody}>Thoughtful help with relevant housing tasks.</Type>
          </View>
        </View>
      </View>
      {onSupport ? <Pressable accessibilityRole="button" accessibilityLabel="Support Tickets" onPress={onSupport} style={({ pressed }) => [styles.support, pressed ? styles.pressedPaper : null]}>
        <Ionicons name="headset-outline" size={22} color={theme.color.kola["800"]} accessible={false} />
        <View style={styles.directionText}><Type variant="bodyStrong">Support Tickets</Type><Type variant="caption" style={styles.directionBody}>Get help from Management. View your tickets and replies.</Type></View>
        <Ionicons name="chevron-forward" size={18} color={theme.color.kola["800"]} accessible={false} />
      </Pressable> : null}
    </View>
  );
}

/** The same entry point in tenant/provider headers and the provider's Menu. */
export function AskDanpaButton({ placement = "inline", tone = "chrome" }: {
  placement?: "inline" | "leading";
  tone?: "chrome" | "paper";
}) {
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const compact = width <= 360 || fontScale > 1.3;
  const paper = tone === "paper";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Danpa Intel"
        accessibilityHint="Learn about Danpa HQ’s future housing intelligence. Coming soon."
        onPress={() => router.push("/(app)/enquiries")}
        hitSlop={4}
        style={({ pressed }) => [styles.button, paper ? styles.buttonPaper : null,
          placement === "leading" ? styles.leading : null,
          pressed ? (paper ? styles.pressedPaper : styles.pressed) : null]}
      >
        {!compact ? <AskDanpaMark size={21} onChrome={!paper} /> : null}
        <Text numberOfLines={1} maxFontSizeMultiplier={1.25} style={[styles.buttonLabel, paper ? styles.buttonLabelPaper : null]}>Danpa Intel</Text>
      </Pressable>

    </>
  );
}

const styles = StyleSheet.create({
  support: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[6], padding: space[4], borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.field["300"], borderRadius: 8, backgroundColor: theme.color.field["50"] },
  button: {
    minHeight: 40, flexShrink: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: space[2], paddingHorizontal: space[3], borderRadius: 20,
    backgroundColor: alpha(theme.color.kola["900"], 0.4), borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(shell.onChrome, 0.2),
  },
  buttonPaper: { backgroundColor: theme.color.field["0"], borderColor: alpha(theme.color.kola["900"], 0.14) },
  buttonLabel: { color: shell.onChrome, fontSize: 15, lineHeight: 20, fontWeight: "500", flexShrink: 1 },
  buttonLabelPaper: { color: theme.color.kola["800"] },
  leading: { marginLeft: space[4] },
  pressed: { backgroundColor: alpha(theme.color.kola["900"], 0.58) },
  pressedPaper: { backgroundColor: theme.color.kola["50"] },
  surface: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: space[2], paddingTop: space[3], paddingBottom: space[6] },
  surfaceCompact: { paddingTop: space[2], paddingBottom: space[4] },
  identity: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  brand: { flexDirection: "row", alignItems: "center", gap: space[2] },
  brandName: { color: theme.color.ink["900"], fontSize: 20, lineHeight: 28, fontWeight: "600" },
  status: { color: theme.color.gold["700"], fontSize: 12, lineHeight: 18, fontWeight: "500", backgroundColor: theme.color.gold["50"], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: 6 },
  introduction: { paddingTop: space[8], paddingBottom: space[6], gap: space[3] },
  introductionCompact: { paddingTop: space[5], paddingBottom: space[5] },
  eyebrow: { color: theme.color.kola["800"], fontSize: 10, lineHeight: 16, fontWeight: "600", letterSpacing: 1.2 },
  headline: { color: theme.color.ink["900"], fontSize: 26, lineHeight: 33, fontWeight: "500", letterSpacing: -0.5, maxWidth: 310 },
  description: { color: theme.color.ink["700"], lineHeight: 24 },
  directions: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.color.field["300"], paddingTop: space[4] },
  directionLabel: { color: theme.color.ink["700"], fontSize: 10, lineHeight: 16, fontWeight: "600", letterSpacing: 1.1, marginBottom: space[1] },
  direction: { flexDirection: "row", alignItems: "flex-start", gap: space[3], paddingVertical: space[4] },
  directionRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.color.field["200"], paddingBottom: 0 },
  directionText: { flex: 1, gap: space[1] },
  directionTitle: { color: theme.color.ink["900"], fontSize: 15 },
  directionBody: { color: theme.color.ink["700"], fontSize: 14, lineHeight: 21 },
});
