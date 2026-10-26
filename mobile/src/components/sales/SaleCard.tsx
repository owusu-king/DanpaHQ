import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { Type, radius, space } from "@/components/ui";
import { isAndroid, pressableFeedback } from "@/platform";
import { saleFacts, type SaleCard as Sale } from "@/sales";
import { theme } from "@/theme";

const CARD_RADIUS = 20;

/**
 * A property for sale in the Buy list — the rental card's frame (photograph,
 * price, headline, where, a line of facts, one trust line) so Buy and Rent read
 * as one Explore. What differs is what the facts are: a house's rooms, a
 * commercial building's use and area, land's size. Twin of the web `SaleCard`.
 */
export function SaleCard({
  sale,
  onPress,
  compact = false,
}: {
  sale: Sale;
  onPress: () => void;
  /** Explore's list: a shorter photograph, as the rental cards beside it. */
  compact?: boolean;
}) {
  const where = [sale.locality_name, sale.district_name].filter(Boolean).join(", ");
  const facts = saleFacts(sale);
  // Each fact wears its own mark: rooms, baths, floor area, or the land itself.
  const glyphFor = (fact: string): keyof typeof Ionicons.glyphMap =>
    /bed/.test(fact) ? "bed-outline"
      : /bath/.test(fact) ? "water-outline"
      : /m²/.test(fact) ? "resize-outline"
      : sale.kind === "land" ? "map-outline"
      : "storefront-outline";

  return (
    <View style={styles.lift}>
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${sale.headline || sale.kind_label}. ${sale.price_formatted ?? "Price on request"}. ${where}.`}
          onPress={onPress}
          {...pressableFeedback(theme.color.field["100"])}
          style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}
        >
          <View style={[styles.media, compact ? styles.mediaCompact : null]}>
            {sale.cover_url ? (
              <Image source={{ uri: sale.cover_url }} accessible={false} style={styles.image} resizeMode="cover" />
            ) : (
              <View style={styles.pending}>
                <Ionicons name="image-outline" size={26} color={theme.color.ink["300"]} />
                <Type variant="caption">Photo pending</Type>
              </View>
            )}
            <View style={styles.kind}>
              <Type variant="captionStrong" style={styles.kindText}>For sale · {sale.kind_label}</Type>
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.priceRow}>
              <Type variant="title2" numberOfLines={1} style={styles.price}>
                {sale.price_formatted ?? "Price on request"}
              </Type>
              {sale.price_negotiable || sale.tenure_label ? (
                <View style={styles.term}>
                  <Type variant="captionStrong" numberOfLines={1} style={styles.termText}>
                    {sale.price_negotiable ? "Negotiable" : sale.tenure_label}
                  </Type>
                </View>
              ) : null}
            </View>

            <Type variant="bodyStrong" numberOfLines={2} style={styles.headline}>
              {sale.headline || `${sale.kind_label} for sale`}
            </Type>

            <View style={styles.location}>
              <Ionicons name="location-outline" size={14} color={theme.color.ink["500"]} />
              <Type variant="caption" numberOfLines={1} style={styles.locationText}>{where || "Ghana"}</Type>
            </View>

            {facts.length ? (
              <View style={styles.facts}>
                {facts.map((fact) => (
                  <View key={fact} style={styles.fact}>
                    <Ionicons name={glyphFor(fact)} size={14} color={theme.color.kola["800"]} />
                    <Type variant="captionStrong" numberOfLines={1} style={styles.factText}>{fact}</Type>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.trust}>
              <View style={styles.verifiedRow}>
                <View style={styles.shield}>
                  <Ionicons name="shield-checkmark" size={13} color={theme.color.kola["800"]} />
                </View>
                <Type variant="captionStrong" style={styles.verified}>Verified for sale</Type>
              </View>
              {sale.seller_label ? (
                <Type variant="caption" numberOfLines={1} style={styles.seller}>{sale.seller_label}</Type>
              ) : null}
            </View>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lift: isAndroid
    ? { borderRadius: CARD_RADIUS, elevation: 3, backgroundColor: theme.color.field["0"] }
    : {
      borderRadius: CARD_RADIUS,
      shadowColor: theme.color.kola["900"],
      shadowOpacity: 0.08,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
  card: {
    overflow: "hidden",
    backgroundColor: theme.color.field["0"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.field["200"],
    borderRadius: CARD_RADIUS,
  },
  media: {
    width: "100%",
    aspectRatio: 4 / 3,
  },
  mediaCompact: {
    aspectRatio: 16 / 9,
    backgroundColor: theme.color.field["100"],
  },
  image: { width: "100%", height: "100%" },
  pending: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[2] },
  kind: {
    position: "absolute",
    top: space[3],
    left: space[3],
    paddingHorizontal: space[3],
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(22,17,14,0.66)",
  },
  kindText: { color: theme.color.field["0"], fontSize: 12 },
  body: { gap: space[2], padding: space[4] },
  // A price in the hundreds of thousands is never cut: the chip beside it drops below instead.
  priceRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  price: { flexGrow: 1, flexShrink: 0, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: theme.color.ink["950"], fontVariant: ["tabular-nums"] },
  term: {
    flexShrink: 0,
    maxWidth: "46%",
    minHeight: 26,
    justifyContent: "center",
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  termText: { color: theme.color.kola["800"], fontSize: 12, lineHeight: 16 },
  headline: { fontSize: 16, color: theme.color.ink["900"], lineHeight: 22 },
  location: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: -4 },
  locationText: { flex: 1, color: theme.color.ink["700"] },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: 2 },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 28,
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: theme.color.field["50"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.field["200"],
  },
  factText: { color: theme.color.ink["900"], fontSize: 12.5, lineHeight: 16 },
  trust: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    marginTop: space[1],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["200"],
  },
  verifiedRow: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  shield: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  verified: { color: theme.color.kola["800"], fontSize: 12.5 },
  seller: { flex: 1, textAlign: "right", fontSize: 12, color: theme.color.ink["500"] },
});
