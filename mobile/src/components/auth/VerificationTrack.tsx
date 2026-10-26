import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";

import { PendingPulse } from "@/components/auth/AuthMotion";
import { Type, space } from "@/components/ui";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * The way to operating as a provider, as four stops on one line.
 *
 * Drawn the same on the welcome and on the provider's Home, so the step that
 * was "next" a minute ago is recognisably the same step now. A stop is done
 * (kola, ticked), the one in hand (lagoon ring), waiting on Danpa HQ (gold,
 * breathing — the review is in somebody else's hands), needing attention
 * (laterite), or still ahead (grey).
 */

export type TrackState = "done" | "next" | "waiting" | "attention" | "later";

export type TrackStop = { label: string; detail?: string; state: TrackState };

const KOLA = theme.color.kola["600"];
const LAGOON = theme.color.lagoon["600"];
const GOLD = theme.color.gold["600"];
const ALERT = theme.color.laterite["600"];

export function VerificationTrack({ stops }: { stops: TrackStop[] }) {
  return (
    <View accessibilityRole="list">
      {stops.map((stop, index) => (
        <Stop key={stop.label} stop={stop} last={index === stops.length - 1} />
      ))}
    </View>
  );
}

function Stop({ stop, last }: { stop: TrackStop; last: boolean }) {
  const { state, label, detail } = stop;
  const spoken = { done: "done", next: "to do now", waiting: "in progress", attention: "needs attention", later: "not yet" }[state];

  return (
    <View style={styles.stop} accessible accessibilityLabel={`${label}, ${spoken}${detail ? `. ${detail}` : ""}`}>
      <View style={styles.rail}>
        {state === "waiting" ? (
          <View style={[styles.dot, { borderColor: alpha(GOLD, 0.5) }]}>
            <PendingPulse color={GOLD} />
          </View>
        ) : (
          <View
            style={[
              styles.dot,
              state === "done" ? { backgroundColor: KOLA, borderColor: KOLA } : null,
              state === "next" ? { borderColor: LAGOON, borderWidth: 2 } : null,
              state === "attention" ? { backgroundColor: ALERT, borderColor: ALERT } : null,
            ]}
          >
            {state === "done" ? <Ionicons name="checkmark" size={12} color={theme.color.field["0"]} /> : null}
            {state === "attention" ? <Ionicons name="alert" size={12} color={theme.color.field["0"]} /> : null}
            {state === "next" ? <View style={[styles.core, { backgroundColor: LAGOON }]} /> : null}
          </View>
        )}
        {last ? null : <View style={[styles.line, state === "done" ? { backgroundColor: alpha(KOLA, 0.5) } : null]} />}
      </View>
      <View style={[styles.text, last ? null : { paddingBottom: space[3] }]}>
        <Type
          variant={state === "next" || state === "waiting" || state === "attention" ? "bodyStrong" : "body"}
          style={state === "later" ? { color: theme.color.ink["500"] } : state === "attention" ? { color: ALERT } : null}
        >
          {label}
        </Type>
        {detail ? (
          <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
            {detail}
          </Type>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stop: {
    flexDirection: "row",
    gap: space[3],
  },
  rail: {
    alignItems: "center",
    width: 20,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: alpha(theme.color.kola["900"], 0.2),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["0"],
  },
  core: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  line: {
    flex: 1,
    minHeight: 12,
    width: 2,
    marginVertical: 2,
    borderRadius: 1,
    backgroundColor: alpha(theme.color.kola["900"], 0.1),
  },
  text: {
    flex: 1,
    gap: 1,
  },
});
