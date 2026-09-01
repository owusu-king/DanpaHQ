import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, View } from "react-native";

import { Type, space } from "@/components/ui";
import { StatusLine, spaceStatus } from "@/components/property/WorkspacePatterns";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import type { Unit } from "@/provider";

/** Two across on every handset in use. Three would be thumbnails, not tiles. */
export const UNIT_COLUMNS = 2;

/** The gap between tiles, and the gap between rows of them. */
export const UNIT_TILE_GAP = space[3];

/**
 * A Unit as a tile, two to a row.
 *
 * A row put one Unit per line with a 64pt square beside it, and a hostel's
 * fortieth room was a long scroll away. Units are told apart by sight before
 * they are told apart by name, so the photograph leads and takes the full width
 * of the tile instead of a thumbnail's worth of it.
 *
 * Type is a step down from the row's — 15/13 against 16/14 — because half a
 * phone is a narrow column and a Unit label that wraps to three lines reads
 * worse than one that is slightly smaller. Nothing drops below 13pt, which is
 * the floor this product sets for anything a person has to read rather than
 * glance at.
 *
 * `maxWidth` is what keeps a lone tile on an odd last row at half width. With
 * `flex: 1` alone it stretches across the screen and the grid appears to break
 * on exactly the counts a real portfolio produces.
 */
export function UnitTile({
  unit,
  meta,
  onOpen,
}: {
  unit: Unit;
  /** The second line. Which fact identifies a Unit depends on where you are:
   *  inside a Property it is what kind of space it is, and across a Portfolio
   *  it is which building it sits in. */
  meta: string;
  onOpen: () => void;
}) {
  const status = spaceStatus(unit);
  const photo = unit.primary_photo?.download_url ?? null;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${unit.label || "Unnamed Unit"}. ${meta}. ${status.label}.`}
      onPress={onOpen}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        flex: 1,
        maxWidth: "50%",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.color.field["200"],
        backgroundColor: theme.color.field["0"],
        overflow: "hidden",
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <View
        style={{
          aspectRatio: 4 / 3,
          backgroundColor: theme.color.field["100"],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photo ? (
          <Image
            source={{ uri: photo }}
            accessible={false}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <Ionicons name="image-outline" size={22} color={theme.color.ink["300"]} />
        )}
      </View>

      <View style={{ padding: space[3], gap: space[1] }}>
        <Type
          variant="bodyStrong"
          numberOfLines={1}
          style={{ fontSize: 15, lineHeight: 20 }}
        >
          {unit.label || "Unnamed Unit"}
        </Type>
        <Type variant="caption" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>
          {meta}
        </Type>
        <StatusLine label={status.label} tone={status.tone} compact />
      </View>
    </Pressable>
  );
}
