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
import { pressableFeedback, surfaceElevation } from "@/platform";
import { theme } from "@/theme";

/**
 * The shared recognition card for Explore, Saved and tenant recommendations.
 *
 * Image → rent/advance → identity → place → essentials → trust. Photos page by
 * swiping, and the dots say where you are: on a phone the swipe is the control,
 * and arrows drawn over a small photograph only got in the thumb's way. The
 * swipe is off wherever another gesture owns the same direction — inside a
 * horizontal related-rentals rail, and in Explore's results sheet until it
 * fills the screen.
 */
export function ListingCard({
  listing,
  onPress,
  saved = false,
  onSave,
  photoSwipe = true,
}: {
  listing: Listing;
  onPress: () => void;
  saved?: boolean;
  /** The heart appears only where saving is offered. */
  onSave?: () => void;
  photoSwipe?: boolean;
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
    facts.join(", "),
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
    <View style={[styles.card, surfaceElevation]}>
      <View
        style={styles.media}
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
            accessibilityState={{ selected: saved }}
            accessibilityLabel={saved ? `Remove ${listing.headline} from saved` : `Save ${listing.headline}`}
            onPress={onSave}
            hitSlop={6}
            {...pressableFeedback(theme.color.field["200"])}
            style={({ pressed }) => [styles.save, pressed && styles.savePressed]}
          >
            <Ionicons
              name={saved ? "heart" : "heart-outline"}
              size={20}
              color={saved ? theme.color.laterite["600"] : theme.color.ink["900"]}
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
          <Type variant="captionStrong" numberOfLines={1} style={styles.advance}>{advance}</Type>
        </View>

        <Type variant="bodyStrong" numberOfLines={2} style={styles.headline}>{listing.headline}</Type>

        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={14} color={theme.color.ink["300"]} />
          <Type variant="caption" numberOfLines={1} style={styles.location}>{where || "Ghana"}</Type>
        </View>

        {facts.length ? <Type variant="caption" style={styles.facts}>{facts.join("  ·  ")}</Type> : null}

        {verified ? (
          <View style={styles.trustRow}>
            <View style={styles.verifiedRow}>
              <Ionicons name="shield-checkmark" size={15} color={theme.color.kola["600"]} />
              <Type variant="captionStrong" style={styles.verified}>Verified rental</Type>
            </View>
            {listing.provider_label ? (
              <Type variant="caption" numberOfLines={1} style={styles.provider}>{listing.provider_label}</Type>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function cardPhotos(listing: Listing) {
  const photos = listing.card_media?.filter((item) => Boolean(item.download_url)) ?? [];
  if (photos.length || !listing.cover_url) return photos;
  return [{ file_id: `cover-${listing.id}`, caption: "", download_url: listing.cover_url }];
}

function essentialFacts(listing: Listing): string[] {
  return [
    listing.bedrooms === 0
      ? "Single room"
      : typeof listing.bedrooms === "number"
        ? `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}`
        : null,
    typeof listing.bathrooms === "number" && listing.bathrooms > 0
      ? `${listing.bathrooms} bath${listing.bathrooms === 1 ? "" : "s"}`
      : null,
    typeof listing.is_furnished === "boolean"
      ? listing.is_furnished ? "Furnished" : "Unfurnished"
      : null,
  ].filter((fact): fact is string => Boolean(fact));
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

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    backgroundColor: theme.color.field["0"],
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    borderRadius: radius.lg,
  },
  media: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 10,
    overflow: "hidden",
    backgroundColor: theme.color.field["100"],
  },
  image: { width: "100%", height: "100%" },
  photoPending: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[2] },
  save: {
    position: "absolute",
    top: space[3],
    right: space[3],
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(230,224,215,0.82)",
    borderRadius: 21,
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
    backgroundColor: "rgba(22,17,14,0.48)",
    borderRadius: radius.pill,
  },
  photoDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.58)" },
  photoDotActive: { width: 11, borderRadius: radius.pill, backgroundColor: theme.color.field["0"] },
  body: { gap: space[2], padding: space[4] },
  bodyPressed: { opacity: 0.88, transform: [{ scale: 0.997 }] },
  priceRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space[3] },
  price: { flex: 1, color: theme.color.ink["950"], fontVariant: ["tabular-nums"] },
  period: { color: theme.color.ink["500"], fontWeight: "400" },
  advance: { flexShrink: 0, color: theme.color.ink["700"], fontSize: 12 },
  headline: { color: theme.color.ink["900"], lineHeight: 22, marginTop: 2 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: -2 },
  location: { flex: 1 },
  facts: { color: theme.color.ink["700"], fontSize: 13, marginTop: 2 },
  trustRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    marginTop: 2,
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: theme.color.field["200"],
  },
  verifiedRow: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  verified: { color: theme.color.kola["600"], fontSize: 12 },
  provider: { flex: 1, textAlign: "right", fontSize: 12 },
});
