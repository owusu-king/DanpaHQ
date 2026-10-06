import Ionicons from "@expo/vector-icons/Ionicons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { MUTED, PRESSED, rowStyles } from "@/components/portfolio/PortfolioList";
import { Type, space } from "@/components/ui";
import {
  categoryIcon,
  maintenanceStatusLabel,
  maintenanceStops,
  maintenanceTone,
  type MaintenanceRequest,
  type MaintenanceTone,
} from "@/maintenance";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The parts both maintenance screens are drawn from, in the record vocabulary
 * (`RecordSurfaces`) and the list vocabulary (`PortfolioList`).
 *
 * One colour per stage, the same as on the web and on both sides —
 *   new / sent        harmattan
 *   in progress       lagoon
 *   confirm the fix   kola
 *   completed         kola, quieter
 *   reopened          laterite
 */
export const STAGE: Record<MaintenanceTone, { ink: string; wash: string; icon: keyof typeof Ionicons.glyphMap }> = {
  waiting: { ink: theme.color.harmattan["600"], wash: theme.color.harmattan["100"], icon: "time-outline" },
  working: { ink: theme.color.lagoon["600"], wash: theme.color.lagoon["100"], icon: "construct-outline" },
  asking: { ink: theme.color.kola["800"], wash: theme.color.kola["50"], icon: "help-circle-outline" },
  done: { ink: theme.color.kola["600"], wash: theme.color.field["100"], icon: "checkmark-done-outline" },
  reopened: { ink: theme.color.laterite["600"], wash: theme.color.laterite["100"], icon: "refresh-outline" },
};

export function dateLabel(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

/** A dot and the stage's name, in its colour. Colour is never the only cue. */
export function StageChip({ request, side }: { request: MaintenanceRequest; side: "tenant" | "provider" }) {
  const stage = STAGE[maintenanceTone(request.status)];
  return (
    <View style={[styles.chip, { backgroundColor: stage.wash }]}>
      <View style={[styles.chipDot, { backgroundColor: stage.ink }]} />
      <Type variant="captionStrong" numberOfLines={1} style={{ color: stage.ink }}>{maintenanceStatusLabel(request.status, side)}</Type>
    </View>
  );
}

/**
 * One request in a list: the photograph (or the category's glyph), what kind of
 * problem, where — and for a provider, whose — and where it stands.
 */
export function RequestRow({
  request,
  side,
  onPress,
}: {
  request: MaintenanceRequest;
  side: "tenant" | "provider";
  onPress: () => void;
}) {
  const stage = STAGE[maintenanceTone(request.status)];
  const where = [side === "provider" ? request.tenant.name : null, request.place.unit_label, request.place.property_title].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${request.category_display}. ${where}. ${maintenanceStatusLabel(request.status, side)}. Open request.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.thumb, { backgroundColor: stage.wash }]}>
        {request.photo ? (
          <Image source={{ uri: request.photo.url }} style={styles.thumbImage} accessibilityIgnoresInvertColors />
        ) : (
          <Ionicons name={categoryIcon(request.category) as never} size={20} color={stage.ink} />
        )}
        {request.video ? (
          <View style={styles.thumbVideo}><Ionicons name="videocam" size={10} color="#fff" /></View>
        ) : null}
      </View>
      <View style={rowStyles.rowBody}>
        <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{request.category_display}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{where}</Type>
        <View style={styles.rowFoot}>
          <StageChip request={request} side={side} />
          <Type variant="caption" style={styles.rowDate}>{dateLabel(request.status_changed_at)}</Type>
        </View>
      </View>
    </Pressable>
  );
}

/** Reported → in progress → fixed → confirmed, as four bars. */
export function Tracker({ request }: { request: MaintenanceRequest }) {
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={`Progress: ${maintenanceStops(request).filter((stop) => stop.state === "done").map((stop) => stop.label).join(", ") || "just reported"}`}>
      {maintenanceStops(request).map((stop) => (
        <View key={stop.key} style={styles.trackStop}>
          <View style={[styles.trackBar, stop.state === "done" ? styles.trackDone : null]}>
            {stop.state === "now" ? <View style={styles.trackNow} /> : null}
          </View>
          <Type variant="captionStrong" numberOfLines={1} style={[styles.trackLabel, stop.state !== "todo" ? styles.trackLabelOn : null]}>{stop.label}</Type>
          <Type variant="caption" numberOfLines={1} style={styles.trackWhen}>
            {stop.state === "done" ? dateLabel(stop.at) : stop.state === "now" ? "Now" : " "}
          </Type>
        </View>
      ))}
    </View>
  );
}

/**
 * The clip, and only the clip. A file the phone cut is the clip already; one
 * that carries a window (picked on Android) starts at its start and stops at its
 * end, looping back the way a five-second clip would.
 */
export function ClipPlayer({ uri, startMs, endMs, height = 200 }: { uri: string; startMs: number | null; endMs: number | null; height?: number }) {
  const windowed = startMs !== null && endMs !== null;
  const player = useVideoPlayer(uri, (created) => {
    created.loop = !windowed;
    created.timeUpdateEventInterval = 0.2;
    if (windowed) created.currentTime = startMs / 1000;
  });

  useEffect(() => {
    if (!windowed) return;
    const subscription = player.addListener("timeUpdate", ({ currentTime }) => {
      if (currentTime >= endMs / 1000 || currentTime < startMs / 1000 - 0.25) {
        player.pause();
        player.currentTime = startMs / 1000;
      }
    });
    return () => subscription.remove();
  }, [endMs, player, startMs, windowed]);

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="cover"
      style={[styles.clip, { height }]}
      accessibilityLabel="Clip of the problem"
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbVideo: {
    position: "absolute",
    right: 3,
    bottom: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 24, 20, 0.62)",
  },
  rowFoot: { flexDirection: "row", alignItems: "center", gap: space[2], marginTop: 4 },
  rowDate: { color: MUTED, fontVariant: ["tabular-nums"] },
  track: { flexDirection: "row", gap: 4 },
  trackStop: { flex: 1, gap: 4 },
  trackBar: { height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: theme.color.field["200"] },
  trackDone: { backgroundColor: theme.color.kola["600"] },
  trackNow: { width: "45%", height: "100%", backgroundColor: theme.color.kola["600"] },
  trackLabel: { color: MUTED, fontSize: 12 },
  trackLabelOn: { color: theme.color.ink["900"] },
  trackWhen: { color: MUTED, fontSize: 11, fontVariant: ["tabular-nums"] },
  clip: { width: "100%", borderRadius: 16, overflow: "hidden", backgroundColor: "#0f1814" },
});
