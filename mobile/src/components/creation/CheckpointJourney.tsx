import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { Type, space } from "@/components/ui";
import { duration, enter } from "@/motion";
import { theme } from "@/theme";

export type CheckpointState = "completed" | "current" | "upcoming" | "attention";
export type CheckpointIcon = "property" | "unit" | "details" | "documents" | "photos" | "amenities" | "review";

export type CreationCheckpoint = {
  key: string;
  label: string;
  icon: CheckpointIcon;
  state: CheckpointState;
};

const ICONS: Record<CheckpointIcon, keyof typeof Ionicons.glyphMap> = {
  property: "business-outline",
  unit: "cube-outline",
  details: "options-outline",
  documents: "document-text-outline",
  photos: "images-outline",
  amenities: "leaf-outline",
  review: "shield-checkmark-outline",
};

/** Current checkpoint with immediate context; the full list never gets crushed. */
export function CheckpointJourney({
  checkpoints,
  label,
  accessibilityLabel,
  valueNow,
  valueMax,
}: {
  checkpoints: CreationCheckpoint[];
  label: string;
  accessibilityLabel: string;
  /** Optional domain-specific completion value (for example required setup work). */
  valueNow?: number;
  valueMax?: number;
}) {
  const currentIndex = Math.max(
    0,
    checkpoints.findIndex((checkpoint) => checkpoint.state === "current"),
  );
  const start = Math.max(0, Math.min(currentIndex - 1, checkpoints.length - 3));
  const nearby = checkpoints.slice(start, Math.min(checkpoints.length, Math.max(3, currentIndex + 2)));
  const complete = checkpoints.filter((checkpoint) => checkpoint.state === "completed").length;
  const entrance = useSharedValue(1);
  const currentKey = checkpoints[currentIndex]?.key;

  /* The step that just became current pushes off from 0.94, so reaching a
     checkpoint is something you see happen rather than something that has
     already happened by the time you look.

     The duration was a bare `180` — between `fast` and `base` and belonging to
     neither. It is `fast` now, which is what an acknowledgement should be, and
     the curve decelerates so the box settles rather than stopping dead.
     Reduce Motion is answered inside `enter`, so the step is simply at its
     full size. */
  useEffect(() => {
    entrance.value = 0.94;
    entrance.value = withTiming(1, enter(duration.fast));
  }, [currentKey, entrance]);

  const currentStyle = useAnimatedStyle(() => ({ transform: [{ scale: entrance.value }] }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: valueMax ?? checkpoints.length,
        now: valueNow ?? complete,
      }}
      accessibilityLabel={`${accessibilityLabel}. ${label}. ${currentIndex + 1} of ${checkpoints.length}, ${checkpoints[currentIndex]?.label}.`}
      style={{ gap: space[4] }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space[3] }}>
        <Type variant="label">{label}</Type>
        <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
          {currentIndex + 1} of {checkpoints.length}
        </Type>
      </View>

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row", alignItems: "flex-start" }}
      >
        {nearby.map((checkpoint, index) => {
          const previous = nearby[index - 1];
          const connectorComplete = previous?.state === "completed"
            && (checkpoint.state === "completed" || checkpoint.state === "current");
          const palette = checkpointPalette(checkpoint.state);
          return (
            <View key={checkpoint.key} style={{ flex: index ? 1 : 0, flexDirection: "row", alignItems: "flex-start" }}>
              {index ? (
                <View
                  style={{
                    flex: 1,
                    height: connectorComplete ? 2 : 1,
                    marginTop: 14,
                    backgroundColor: connectorComplete ? theme.color.kola["600"] : theme.color.field["300"],
                  }}
                />
              ) : null}
              <View style={{ width: 84, alignItems: "center", gap: space[2] }}>
                <Animated.View
                  style={[
                    {
                      width: checkpoint.state === "current" ? 30 : 28,
                      height: checkpoint.state === "current" ? 30 : 28,
                      borderRadius: 4,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: palette.ground,
                      borderWidth: checkpoint.state === "current" ? 2 : 1,
                      borderColor: palette.rule,
                    },
                    // Only the step being reached moves. The ones on either
                    // side of it are context and holding still is their job.
                    checkpoint.state === "current" ? currentStyle : null,
                  ]}
                >
                  <Ionicons
                    name={
                      checkpoint.state === "completed"
                        ? "checkmark"
                        : checkpoint.state === "attention"
                          ? "alert"
                          : ICONS[checkpoint.icon]
                    }
                    size={15}
                    color={palette.ink}
                  />
                </Animated.View>
                <Type
                  variant="label"
                  numberOfLines={2}
                  style={{
                    textAlign: "center",
                    color: checkpoint.state === "current" ? theme.color.ink["900"] : palette.ink,
                    fontWeight: checkpoint.state === "current" ? "700" : "600",
                    letterSpacing: 0,
                    textTransform: "none",
                  }}
                >
                  {checkpoint.label}
                </Type>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function checkpointPalette(state: CheckpointState) {
  if (state === "completed") {
    return { ink: theme.color.field["0"], ground: theme.color.kola["600"], rule: theme.color.kola["600"] };
  }
  if (state === "current") {
    return { ink: theme.color.kola["600"], ground: theme.color.field["0"], rule: theme.color.kola["600"] };
  }
  if (state === "attention") {
    return { ink: theme.color.harmattan["600"], ground: theme.color.harmattan["100"], rule: theme.color.harmattan["500"] };
  }
  return { ink: theme.color.ink["300"], ground: theme.color.field["0"], rule: theme.color.field["300"] };
}
