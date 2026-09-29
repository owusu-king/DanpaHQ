import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Type, radius, space } from "@/components/ui";
import { formatMinor, type Listing } from "@/listings";
import { isAndroid, pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The shared recognition card for Explore, Saved and tenant recommendations.
 *
 * Image → rent and advance → name → place → essentials → trust (owner,
 * 2026-09-28: reorganised for a premium read). The photograph is taller and
 * carries only the save mark and where you are in its photos; below it the rent
 * leads in large type, with the advance as a chip beside it because in Ghana the
 * advance often decides whether a place is possible at all. The name and place
 * follow, then the essentials as glyphs rather than a dotted run of words, and
 * trust closes the card rather than competing with the photograph.
 *
 * Photos page by swiping, and the dots say where you are: on a phone the swipe
 * is the control. The swipe is off wherever another gesture owns the same
 * direction — inside a horizontal related-rentals rail, and in Explore's results
 * sheet until it fills the screen.
 */
export function ListingCard({
  listing,
  onPress,
  saved = false,
  onSave,
  photoSwipe = true,
  compact = false,
}: {
  listing: Listing;
  onPress: () => void;
  saved?: boolean;
  /** The save mark appears only where saving is offered. */
  onSave?: () => void;
  photoSwipe?: boolean;
  /** Explore's list: a shorter photograph, so more of the list is in view. */
  compact?: boolean;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const photos = cardPhotos(listing);
  const [mediaWidth, setMediaWidth] = useState(Math.max(1, viewportWidth - space[10]));
  const [activePhoto, setActivePhoto] = useState(0);
  const where = [listing.locality_name, listing.district_name].filter(Boolean).join(", ");
  const facts = essentialFacts(listing);
  const verified = listing.trust_stamps?.identity.state === "verified"
    && listing.trust_stamps?.property.state === "verified";
  const rent = listing.rent_formatted ?? formatMinor(listing.rent_minor ?? 0);
  const period = rentPeriod(listing.rent_period);
  const advance = advanceTerm(listing.advance_label);
  const accessibleSummary = [
    listing.headline,
    `${rent} per ${period}`,
    advance,
    where || "Ghana",
    facts.map(([fact]) => fact).join(", "),
    verified ? "Verified rental" : "",
  ].filter(Boolean).join(". ");

  // A card that stops swiping shows its first photograph, so its dots start there again.
  useEffect(() => {
    if (!photoSwipe) setActivePhoto(0);
  }, [photoSwipe]);

  function updatePhoto(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!mediaWidth) return;
    const next = Math.max(0, Math.min(photos.length - 1, Math.round(event.nativeEvent.contentOffset.x / mediaWidth)));
    setActivePhoto((current) => current === next ? current : next);
  }

  return (
    <View style={styles.lift}>
      <View style={styles.card}>
        <View
          style={[styles.media, compact ? styles.mediaCompact : null]}
          onLayout={(event) => {
            const nextWidth = Math.round(event.nativeEvent.layout.width);
            if (nextWidth > 0 && nextWidth !== mediaWidth) setMediaWidth(nextWidth);
          }}
        >
          {photos.length ? (
            photoSwipe && photos.length > 1 ? (
              <ScrollView
                horizontal
                pagingEnabled
                snapToInterval={mediaWidth}
                disableIntervalMomentum
                nestedScrollEnabled
                directionalLockEnabled
                decelerationRate="fast"
                showsHorizontalScrollIndicator={false}
                onScroll={updatePhoto}
                onMomentumScrollEnd={updatePhoto}
                scrollEventThrottle={16}
                style={styles.image}
              >
                {photos.map((photo) => (
                  <Pressable
                    key={photo.file_id}
                    accessible={false}
                    onPress={onPress}
                    {...pressableFeedback("rgba(255,255,255,0.18)")}
                    style={{ width: mediaWidth, height: "100%" }}
                  >
                    <Image source={{ uri: photo.download_url }} accessible={false} style={styles.image} resizeMode="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Pressable
                accessible={false}
                onPress={onPress}
                {...pressableFeedback("rgba(255,255,255,0.18)")}
                style={styles.image}
              >
                <Image source={{ uri: photos[0]!.download_url }} accessible={false} style={styles.image} resizeMode="cover" />
              </Pressable>
            )
          ) : (
            <Pressable
              accessible={false}
              onPress={onPress}
              {...pressableFeedback(theme.color.field["200"])}
              style={styles.photoPending}
            >
              <Ionicons name="image-outline" size={24} color={theme.color.ink["300"]} />
              <Type variant="caption">Photo pending</Type>
            </Pressable>
          )}

          {photoSwipe && photos.length > 1 ? (
            <View style={styles.photoDotsPosition} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.photoDots}>
                {photos.map((photo, index) => (
                  <View key={photo.file_id} style={[styles.photoDot, index === activePhoto && styles.photoDotActive]} />
                ))}
              </View>
            </View>
          ) : null}

          {onSave ? (
            <Pressable
              accessibilityRole="button"
              aria-selected={saved}
              accessibilityLabel={saved ? `Remove ${listing.headline} from saved` : `Save ${listing.headline}`}
              onPress={onSave}
              hitSlop={6}
              {...pressableFeedback(theme.color.field["200"])}
              style={({ pressed }) => [styles.save, pressed && styles.savePressed]}
            >
              <Ionicons
                name={saved ? "bookmark" : "bookmark-outline"}
                size={19}
                color={saved ? theme.color.kola["800"] : theme.color.ink["900"]}
              />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={accessibleSummary}
          onPress={onPress}
          {...pressableFeedback(theme.color.field["100"])}
          style={({ pressed }) => [styles.body, pressed && styles.bodyPressed]}
        >
          <View style={styles.priceRow}>
            <Type
              variant="title2"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.84}
              style={styles.price}
            >
              {rent}<Type variant="caption" style={styles.period}> / {period}</Type>
            </Type>
            <View style={styles.advance}>
              <Type variant="captionStrong" numberOfLines={1} style={styles.advanceText}>{advance}</Type>
            </View>
          </View>

          <Type variant="bodyStrong" numberOfLines={2} style={styles.headline}>{listing.headline}</Type>

          <View style={styles.location}>
            <Ionicons name="location-outline" size={14} color={theme.color.ink["500"]} />
            <Type variant="caption" numberOfLines={1} style={styles.locationText}>{where || "Ghana"}</Type>
          </View>

          {facts.length ? (
            <View style={styles.facts}>
              {facts.map(([fact, icon]) => (
                <View key={fact} style={styles.fact}>
                  <Ionicons name={icon} size={14} color={theme.color.kola["800"]} />
                  <Type variant="captionStrong" numberOfLines={1} style={styles.factText}>{fact}</Type>
                </View>
              ))}
            </View>
          ) : null}

          {verified ? (
            <View style={styles.trust}>
              <View style={styles.verifiedRow}>
                <View style={styles.shield}>
                  <Ionicons name="shield-checkmark" size={13} color={theme.color.kola["800"]} />
                </View>
                <Type variant="captionStrong" style={styles.verified}>Verified rental</Type>
              </View>
              {listing.provider_label ? (
                <Type variant="caption" numberOfLines={1} style={styles.provider}>{listing.provider_label}</Type>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

function cardPhotos(listing: Listing) {
  const photos = listing.card_media?.filter((item) => Boolean(item.download_url)) ?? [];
  if (photos.length || !listing.cover_url) return photos;
  return [{ file_id: `cover-${listing.id}`, caption: "", download_url: listing.cover_url }];
}

/** The essentials a tenant compares on, each with the glyph that says it at a glance. */
function essentialFacts(listing: Listing): [string, IconName][] {
  return ([
    listing.bedrooms === 0
      ? ["Single room", "bed-outline"]
      : typeof listing.bedrooms === "number"
        ? [`${listing.bedrooms} bed${listing.bedrooms === 1 ? "" : "s"}`, "bed-outline"]
        : null,
    typeof listing.bathrooms === "number" && listing.bathrooms > 0
      ? [`${listing.bathrooms} bath${listing.bathrooms === 1 ? "" : "s"}`, "water-outline"]
      : null,
    typeof listing.is_furnished === "boolean"
      ? [listing.is_furnished ? "Furnished" : "Unfurnished", "cube-outline"]
      : null,
  ] as ([string, IconName] | null)[]).filter((fact): fact is [string, IconName] => Boolean(fact));
}

/** The lump sum on day one, named beside the rent wherever a rental is summarised. */
export function advanceTerm(label: string): string {
  if (!label || label.toLocaleLowerCase("en-GH").startsWith("no advance")) return "No advance";
  return `${label} advance`;
}

export function rentPeriod(period: string): string {
  return ({ monthly: "month", yearly: "year", weekly: "week", daily: "day" } as Record<string, string>)[period]
    ?? period.replaceAll("_", " ");
}

const CARD_RADIUS = 20;

const styles = StyleSheet.create({
  // The shadow lives outside the card's clip, soft and in kola rather than grey.
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
    position: "relative",
    width: "100%",
    aspectRatio: 4 / 3,
  },
  // Explore's cards (owner, 2026-09-29): a wider, shorter frame.
  mediaCompact: {
    aspectRatio: 16 / 9,
    overflow: "hidden",
    backgroundColor: theme.color.field["100"],
  },
  image: { width: "100%", height: "100%" },
  photoPending: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[2] },
  // Frosted white over the photograph, with a thin white rim.
  save: {
    position: "absolute",
    top: space[3],
    right: space[3],
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.86)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.95)",
    borderRadius: 20,
  },
  savePressed: { opacity: 0.78, transform: [{ scale: 0.94 }] },
  photoDotsPosition: {
    position: "absolute",
    bottom: space[3],
    left: 0,
    right: 0,
    alignItems: "center",
  },
  photoDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: "rgba(22,17,14,0.42)",
    borderRadius: radius.pill,
  },
  photoDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.6)" },
  photoDotActive: { width: 14, borderRadius: radius.pill, backgroundColor: theme.color.field["0"] },
  body: { gap: space[2], paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[4] },
  bodyPressed: { opacity: 0.9 },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  price: { flex: 1, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: theme.color.ink["950"], fontVariant: ["tabular-nums"] },
  period: { color: theme.color.ink["500"], fontWeight: "400", letterSpacing: 0 },
  // The advance, as a chip: its own shape beside the rent, not a footnote to it.
  advance: {
    flexShrink: 0,
    maxWidth: "46%",
    minHeight: 26,
    justifyContent: "center",
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  advanceText: { color: theme.color.kola["800"], fontSize: 12, lineHeight: 16 },
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
    minWidth: 0,
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
  provider: { flex: 1, textAlign: "right", fontSize: 12, color: theme.color.ink["500"] },
});
