import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from "react-native";

import { QuietAct, Pill } from "@/components/record/RecordSurfaces";
import { Type, space } from "@/components/ui";
import { MAX_CLIP_MS, seconds } from "@/maintenance";
import { theme } from "@/theme";

/**
 * Choosing five seconds of a longer video.
 *
 * The phone has no way to cut a file without a native editor this app does not
 * carry, so the choice travels with the upload instead: the whole video goes up
 * with the window to play (`video_clip_start_ms`, `video_clip_end_ms`), which
 * the backend holds to five seconds with a check constraint, and every player
 * plays only that window. iOS never gets here from the library — its own
 * trimmer is capped at five seconds — only Android, and any camera app that
 * ignored the five-second limit.
 *
 * The window is dragged along the track (the touch is claimed at its start and
 * never handed back mid-drag, as the rent range in Explore's filters does), and
 * the preview loops through exactly what will be kept.
 */
export function ClipTrimmer({
  uri,
  durationMs,
  onDone,
  onCancel,
}: {
  uri: string;
  durationMs: number;
  onDone: (window: { startMs: number; endMs: number }) => void;
  onCancel: () => void;
}) {
  const span = Math.min(MAX_CLIP_MS, durationMs);
  const latest = Math.max(0, durationMs - span);
  const [startMs, setStartMs] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  // What the gesture and the player read between renders.
  const live = useRef({ startMs: 0, trackWidth: 0 });
  useEffect(() => { live.current = { startMs, trackWidth }; }, [startMs, trackWidth]);
  const endMs = startMs + span;

  const player = useVideoPlayer(uri, (created) => {
    created.muted = true;
    created.timeUpdateEventInterval = 0.2;
    created.play();
  });

  // Keep the preview inside the window as it moves and as it plays.
  useEffect(() => { seek(player, startMs, true); }, [player, startMs]);
  useEffect(() => {
    const subscription = player.addListener("timeUpdate", ({ currentTime }) => {
      const { startMs: from } = live.current;
      if (currentTime >= (from + span) / 1000) seek(player, from, false);
    });
    return () => subscription.remove();
  }, [player, span]);

  const responder = useMemo(() => dragResponder(live, durationMs, latest, setStartMs), [durationMs, latest]);

  const adjust = (event: AccessibilityActionEvent) => {
    const step = event.nativeEvent.actionName === "increment" ? 500 : -500;
    setStartMs((current) => Math.min(latest, Math.max(0, current + step)));
  };

  const left = trackWidth * (startMs / durationMs);
  const width = trackWidth * (span / durationMs);

  return (
    <View style={styles.outer}>
    <View style={styles.frame}>
      <VideoView player={player} nativeControls={false} contentFit="cover" style={styles.preview} accessibilityLabel="Preview of the part you are keeping" />
      <View style={styles.body}>
        <Type variant="captionStrong" style={styles.light}>
          Choose 5 seconds of {Math.round(durationMs / 1000)}s
        </Type>
        <View
          style={styles.track}
          onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Where the five seconds start"
          accessibilityValue={{ text: `${clock(startMs)} to ${clock(endMs)}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={adjust}
          {...responder.panHandlers}
        >
          <View style={[styles.window, { left, width: Math.max(width, 24) }]} />
        </View>
        <View style={styles.times}>
          <Type variant="caption" style={styles.faint}>{clock(0)}</Type>
          <Type variant="captionStrong" style={styles.light}>{clock(startMs)} – {clock(endMs)} · {seconds(span)}s</Type>
          <Type variant="caption" style={styles.faint}>{clock(durationMs)}</Type>
        </View>
      </View>
    </View>
      {/* On the page, not the dark frame: the shared acts are drawn for paper. */}
      <View style={styles.actions}>
        <Pill grow icon="cut-outline" label="Use these 5 seconds" onPress={() => onDone({ startMs, endMs })} />
        <QuietAct label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

/**
 * Dragging the window. The touch is claimed at its start and never handed back
 * mid-drag; the origin lives in this closure, not in render state.
 */
function dragResponder(
  live: { current: { startMs: number; trackWidth: number } },
  durationMs: number,
  latest: number,
  setStartMs: (ms: number) => void,
) {
  let origin = 0;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      const { startMs: from, trackWidth: width } = live.current;
      origin = (from / durationMs) * width;
    },
    onPanResponderMove: (_, gesture) => {
      const width = Math.max(1, live.current.trackWidth);
      const at = Math.round(((origin + gesture.dx) / width) * durationMs / 100) * 100;
      setStartMs(Math.min(latest, Math.max(0, at)));
    },
    // A window keeps its drag, however far the finger strays from the track.
    onPanResponderTerminationRequest: () => false,
  });
}

/** Move the player; kept outside the component, where the player is not render state. */
function seek(player: VideoPlayer, ms: number, play: boolean) {
  player.currentTime = ms / 1000;
  if (play) player.play();
}

function clock(ms: number) {
  const total = Math.round(ms / 100) / 10;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toLocaleString("en-GH", { minimumFractionDigits: 1, maximumFractionDigits: 1, minimumIntegerDigits: 2 })}`;
}

const styles = StyleSheet.create({
  outer: { gap: space[3] },
  frame: { overflow: "hidden", borderRadius: 16, backgroundColor: "#0f1814" },
  preview: { width: "100%", height: 200 },
  body: { gap: space[2], padding: space[3] },
  light: { color: "#fff" },
  faint: { color: "rgba(255,255,255,0.6)", fontVariant: ["tabular-nums"] },
  track: { height: 40, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.12)", justifyContent: "center" },
  window: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.color.kola["50"],
    backgroundColor: "rgba(27,107,79,0.55)",
  },
  times: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
