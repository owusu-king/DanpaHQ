import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, View } from "react-native";

import { Type, space } from "@/components/ui";
import { formatMinor, type Listing } from "@/listings";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * One rental, as a tenant scans it.
 *
 * The photograph does the recognizing and the rent does the comparing, so those
 * two get the room and everything else is one line. Advance has a line of its
 * own because in Ghana it is often what decides whether a place is possible at
 * all.
 *
 * Verification is reassurance, not the headline: one quiet mark when both the
 * identity and the property checks passed, rather than a row of stamps beside
 * the price. The card used to carry two full stamps and no price hierarchy.
 *
 * Shared by Explore, the tenant home and Saved, so it lives here rather than
 * being exported from whichever screen happened to define it.
 */
export function ListingCard({
  listing,
  onPress,
  saved = false,
  onSave,
}: {
  listing: Listing;
  onPress: () => void;
  saved?: boolean;
  /** The heart appears only where saving is offered. */
  onSave?: () => void;
}) {
  // Campaign media is optional and usually empty; the Unit's photographs are
  // where a listing's pictures actually live.
  const cover = listing.cover_url
    ?? listing.media.find((item) => item.is_cover)?.download_url
    ?? listing.media[0]?.download_url;
  const where = [listing.locality_name, listing.district_name].filter(Boolean).join(", ");
  const facts = [
    listing.bedrooms === 0 ? "Single room" : listing.bedrooms ? `${listing.bedrooms} bed` : null,
    listing.is_furnished ? "Furnished" : null,
  ].filter(Boolean).join(" · ");
  const verified = listing.trust_stamps?.identity.state === "verified"
    && listing.trust_stamps?.property.state === "verified";
  const rent = listing.rent_formatted ?? formatMinor(listing.rent_minor ?? 0);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${listing.headline}. ${rent} a month. ${where}. ${listing.advance_label} advance.${verified ? " Verified." : ""}`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({ gap: space[2], opacity: pressed ? 0.9 : 1 })}
    >
      <View
        style={{
          aspectRatio: 4 / 3,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: theme.color.field["100"],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {cover ? (
          <Image source={{ uri: cover }} accessible={false} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <Ionicons name="image-outline" size={28} color={theme.color.ink["300"]} />
        )}
        {onSave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: saved }}
            accessibilityLabel={saved ? `Remove ${listing.headline} from saved` : `Save ${listing.headline}`}
            onPress={onSave}
            hitSlop={8}
            style={{
              position: "absolute",
              top: space[2],
              right: space[2],
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.88)",
            }}
          >
            <Ionicons
              name={saved ? "heart" : "heart-outline"}
              size={20}
              color={saved ? theme.color.laterite["600"] : theme.color.ink["900"]}
            />
          </Pressable>
        ) : null}
      </View>

      <View
  style={{
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: space[3],
  }}
>
  {/* Left: primary listing information */}
  <View style={{ flex: 1, gap: 2 }}>
    <Type variant="title2">
      {rent}
      <Type variant="caption"> / month</Type>
    </Type>

    <Type variant="bodyStrong">{listing.headline}</Type>

    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Ionicons
        name="location-outline"
        size={14}
        color={theme.color.ink["300"]}
      />

      <Type variant="caption">
        {where || "Ghana"}
      </Type>
    </View>

    {facts ? (
      <Type variant="caption">{facts}</Type>
    ) : null}
  </View>

  {/* Right: rental term + trust */}
  <View
    style={{
      alignItems: "flex-end",
      gap: 5,
      paddingTop: 3,
      flexShrink: 0,
    }}
  >
    {verified ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Ionicons
          name="shield-checkmark"
          size={14}
          color={theme.color.kola["600"]}
        />

        <Type
          variant="caption"
          style={{
            color: theme.color.kola["600"],
            fontWeight: "600",
          }}
        >
          Verified
        </Type>
      </View>
    ) : null}
    <Type variant="caption">
      {listing.advance_label} advance
    </Type>

  </View>
</View>
    </Pressable>
  );
}
