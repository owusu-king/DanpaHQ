import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";

import { Type, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";

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
  onGoTo,
  skipAhead = false,
}: {
  checkpoints: CreationCheckpoint[];
  label: string;
  accessibilityLabel: string;
  /** Optional domain-specific completion value (for example required setup work). */
  valueNow?: number;
  valueMax?: number;
  /**
   * Makes the journey the way back.
   *
   * Without it the strip is a picture of where you are, and the only way to a
   * step already done was to finish the flow and re-enter it. With it each
   * checkpoint but the current one is a button.
   */
  onGoTo?: (key: string) => void;
  /** Whether a step not yet reached may be jumped to. Property setup says the
   *  steps can be done in any order; Unit creation cannot, because each step
   *  writes to a record the one before it created. */
  skipAhead?: boolean;
}) {
  const currentIndex = Math.max(
    0,
    checkpoints.findIndex((checkpoint) => checkpoint.state === "current"),
  );
  const start = Math.max(0, Math.min(currentIndex - 1, checkpoints.length - 3));
  const nearby = checkpoints.slice(start, Math.min(checkpoints.length, Math.max(3, currentIndex + 2)));
  const complete = checkpoints.filter((checkpoint) => checkpoint.state === "completed").length;
  const entrance = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReduceMotion();
  const currentKey = checkpoints[currentIndex]?.key;

  useEffect(() => {
    entrance.setValue(reduceMotion ? 1 : 0.94);
    Animated.timing(entrance, {
      toValue: 1,
      duration: reduceMotion ? 0 : 180,
      useNativeDriver: true,
    }).start();
  }, [currentKey, entrance, reduceMotion]);

  // A progressbar that collapses its children is right until the children are
  // the way back. Interactive, the role and the value stay for the reader that
  // wants them, but each checkpoint is reachable on its own.
  const interactive = Boolean(onGoTo);
  const reachable = (checkpoint: CreationCheckpoint) =>
    interactive && checkpoint.state !== "current" && (skipAhead || checkpoint.state !== "upcoming");

  return (
    <View
      accessible={!interactive}
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
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? "auto" : "no-hide-descendants"}
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
              <Pressable
                accessibilityRole={reachable(checkpoint) ? "button" : undefined}
                accessibilityLabel={reachable(checkpoint) ? `Go to ${checkpoint.label}` : undefined}
                aria-selected={checkpoint.state === "current" ? true : undefined}
                disabled={!reachable(checkpoint)}
                onPress={() => onGoTo?.(checkpoint.key)}
                hitSlop={space[1]}
                style={({ pressed }) => ({
                  width: 84,
                  alignItems: "center",
                  gap: space[2],
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Animated.View
                  style={{
                    width: checkpoint.state === "current" ? 30 : 28,
                    height: checkpoint.state === "current" ? 30 : 28,
                    borderRadius: 4,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: palette.ground,
                    borderWidth: checkpoint.state === "current" ? 2 : 1,
                    borderColor: palette.rule,
                    transform: [{ scale: checkpoint.state === "current" ? entrance : 1 }],
                  }}
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
                    color: palette.label,
                    fontWeight: checkpoint.state === "current" ? "600" : "500",
                    letterSpacing: 0,
                    textTransform: "none",
                  }}
                >
                  {checkpoint.label}
                </Type>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * `ink` is the glyph *inside* the disc; `label` is the word under it.
 *
 * They are not the same colour and were being used as if they were. A
 * completed checkpoint fills its disc with kola and draws a white tick on it —
 * white being right on the disc and invisible on the ivory page below. The
 * label read as a blank space, which mattered little while the strip was a
 * picture and matters a great deal now that each one is a button.
 */
function checkpointPalette(state: CheckpointState) {
  if (state === "completed") {
    return {
      ink: theme.color.field["0"],
      label: theme.color.kola["800"],
      ground: theme.color.kola["600"],
      rule: theme.color.kola["600"],
    };
  }
  if (state === "current") {
    return {
      ink: theme.color.kola["600"],
      label: theme.color.ink["900"],
      ground: theme.color.field["0"],
      rule: theme.color.kola["600"],
    };
  }
  if (state === "attention") {
    return {
      ink: theme.color.harmattan["600"],
      label: theme.color.harmattan["600"],
      ground: theme.color.harmattan["100"],
      rule: theme.color.harmattan["500"],
    };
  }
  return {
    ink: theme.color.ink["300"],
    label: theme.color.ink["500"],
    ground: theme.color.field["0"],
    rule: theme.color.field["300"],
  };
}
