import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";

import type { ArtisanCard } from "@/artisan";
import { Type, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * The fact chips an artisan listing and profile share. Facts only — ID checked,
 * certificates verified, jobs done here, reviews — and never a score.
 */

const LAGOON = theme.color.lagoon["600"];

/** The facts a listing states, in the same order everywhere. Never a score. */
export function Facts({ artisan }: { artisan: ArtisanCard }) {
  return (
    <View style={styles.facts}>
      {artisan.id_checked ? <Fact icon="shield-checkmark-outline" tone={{ ink: theme.color.kola["800"], wash: theme.color.kola["50"] }} text="ID checked" /> : null}
      {artisan.certified_trades.map((trade) => (
        <Fact key={trade} icon="ribbon-outline" tone={{ ink: LAGOON, wash: theme.color.lagoon["100"] }} text={`${trade} certificate verified`} />
      ))}
      <Fact icon="construct-outline" text={`${artisan.jobs_completed} job${artisan.jobs_completed === 1 ? "" : "s"} on Danpa HQ`} />
      <Fact icon="star-outline" text={artisan.reviews_count ? `${artisan.reviews_count} review${artisan.reviews_count === 1 ? "" : "s"}` : "No reviews yet"} />
    </View>
  );
}

function Fact({ icon, text, tone }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: { ink: string; wash: string } }) {
  const ink = tone?.ink ?? theme.color.ink["700"];
  return (
    <View style={[styles.fact, { backgroundColor: tone?.wash ?? theme.color.field["100"] }]}>
      <Ionicons name={icon} size={12} color={ink} />
      <Type variant="caption" style={{ color: ink, fontSize: 12, lineHeight: 16 }}>{text}</Type>
    </View>
  );
}

export function shortDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  fact: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, paddingHorizontal: space[2], borderRadius: 999 },
});
