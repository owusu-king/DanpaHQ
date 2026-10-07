import Ionicons from "@expo/vector-icons/Ionicons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { MUTED } from "@/components/portfolio/PortfolioList";
import { Type } from "@/components/ui";
import {
  maintenanceStops,
  type MaintenanceRequest,
  type MaintenanceTone,
} from "@/maintenance";
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
