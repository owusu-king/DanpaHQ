import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, StyleSheet, View } from "react-native";

import {
  CHEVRON,
  EDGE,
  FAINT,
  GLASS,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PANEL_RADIUS,
} from "@/components/portfolio/PortfolioList";
import { Type, space } from "@/components/ui";
import { isAndroid, pressableFeedback } from "@/platform";
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
 *
 * Refined on review (2026-09-21). One combined status — "Verified · Public ·
 * Available" — was three facts in one string, and in half a phone's width it
 * was cut after the first. They are separated: whether somebody lives there
 * rides on the photograph, where it stands in review is the line under the
 * name, and being on Explore is a mark rather than a word.
 */

/** Which ground the tile is standing on. */
export type UnitTileSurface = "paper" | "glass";

/** Whether somebody lives there — the fact a provider scans a Portfolio for. */
function occupancyOf(unit: Unit): { label: string; ink: string } {
  if (unit.availability.state === "occupied") return { label: "Occupied", ink: INK };
  if (unit.availability.state === "expired") return { label: "Expired", ink: LATERITE };
  return { label: "Vacant", ink: KOLA_DEEP };
}

/** Where it stands in review, with nothing about letting or Explore in it. */
function reviewOf(unit: Unit): { label: string; tone: string } {
  const { state, state_label } = unit.verification;
  if (state === "verified") return { label: "Verified", tone: KOLA };
  if (["changes_requested", "rejected", "suspended", "expired"].includes(state)) {
    return { label: state_label, tone: LATERITE };
  }
  if (state === "submitted" || state === "under_review") return { label: "In review", tone: HARMATTAN };
  return { label: state_label, tone: MUTED };
}

export function UnitTile({
  unit,
  meta,
  surface = "paper",
  onOpen,
}: {
  unit: Unit;
  /** The second line. Which fact identifies a Unit depends on where you are:
   *  inside a Property it is what kind of space it is, and across a Portfolio
   *  it is which building it sits in. */
  meta: string;
  /** Paper on the warm Property screen, glass on the green Units list. */
  surface?: UnitTileSurface;
  onOpen: () => void;
}) {
  const photo = unit.primary_photo?.download_url ?? null;
  const occupancy = occupancyOf(unit);
  const review = reviewOf(unit);
  const published = unit.publication.state === "published" && unit.publication.listing_status === "active";
  const glass = surface === "glass";

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${unit.label || "Unnamed Unit"}. ${meta}. ${occupancy.label}. ${review.label}.${published ? " On Explore." : ""}`}
      onPress={onOpen}
      {...pressableFeedback(glass ? theme.color.kola["50"] : theme.color.field["200"])}
      style={({ pressed }) => [
        styles.tile,
        glass ? styles.glass : styles.paper,
        pressed && !isAndroid ? { opacity: 0.82 } : null,
      ]}
    >
      <View style={styles.frame}>
        {photo ? (
          <Image source={{ uri: photo }} accessible={false} style={styles.photo} resizeMode="cover" />
        ) : (
          <Ionicons name="image-outline" size={22} color={CHEVRON} />
        )}

        {/* Whether it is let rides on the photograph, where the eye already is. */}
        <View style={styles.chip}>
          {/* Centred against one line, unlike the status dot below, which has
              to sit against the first of two. */}
          <View style={[styles.dot, styles.chipDot, { backgroundColor: occupancy.ink }]} />
          <Type variant="captionStrong" numberOfLines={1} style={[styles.chipText, { color: occupancy.ink }]}>
            {occupancy.label}
          </Type>
        </View>

        {/* On Explore is a mark, not a third word competing for the same line. */}
        {published ? (
          <View style={styles.public} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="earth" size={12} color={theme.color.field["0"]} />
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Type variant="bodyStrong" numberOfLines={1} style={styles.label}>
          {unit.label || "Unnamed Unit"}
        </Type>
        <Type variant="caption" numberOfLines={1} style={styles.meta}>{meta}</Type>
        <View style={styles.standing}>
          <View style={[styles.dot, { backgroundColor: review.tone }]} />
          {/* Half a phone is about seventeen characters at this size, and
              "Changes requested" is exactly eighteen. A status wraps rather
              than being cut to "Changes reque…". */}
          <Type variant="captionStrong" numberOfLines={2} style={[styles.standingText, { color: review.tone }]}>
            {review.label}
          </Type>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    maxWidth: "50%",
    overflow: "hidden",
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
  },
  paper: {
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["0"],
  },
  glass: {
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  frame: {
    aspectRatio: 4 / 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  chip: {
    position: "absolute",
    left: space[2],
    bottom: space[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: "90%",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    // Legible over any photograph, and over the empty well behind one.
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  chipText: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  public: {
    position: "absolute",
    right: space[2],
    top: space[2],
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: KOLA,
  },
  body: {
    padding: space[3],
    gap: 2,
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  meta: {
    fontSize: 13,
    lineHeight: 17,
    color: FAINT,
  },
  standing: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    paddingTop: 2,
  },
  dot: {
    width: 7,
    height: 7,
    marginTop: 5,
    borderRadius: 3.5,
  },
  chipDot: {
    marginTop: 0,
  },
  standingText: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 17,
  },
});
