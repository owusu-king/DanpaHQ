import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";

import type { TimelineStep } from "@/applicationMeaning";
import { Type, radius, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * Where an application has got to, drawn as the journey it is.
 *
 * The record said "Being considered" and left the tenant to infer the rest.
 * That is where it stands; this is how it got there and what is still to come,
 * which is the difference between a status word and knowing where you are.
 *
 * Three signals per step, never colour alone: the glyph changes (a filled tick,
 * a ring, an empty dot, a cross), the weight changes, and the rail below the
 * dot stops at a step that ended things. Somebody who cannot separate the green
 * from the grey still reads it correctly.
 */
export function ApplicationTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <View
      accessible
      accessibilityLabel={`Progress: ${steps.map((step) => step.label).join(", then ")}.`}
      style={{ gap: 0 }}
    >
      {steps.map((step, index) => {
        const tone = toneOf(step.state);
        const last = index === steps.length - 1;
        return (
          <View key={step.id} style={{ flexDirection: "row", gap: space[3] }}>
            <View style={{ alignItems: "center", width: 20 }}>
              <Ionicons name={glyphOf(step.state)} size={18} color={tone} />
              {/* The rail stops after a step that ended things: nothing follows
                  a withdrawal or a refusal, and a line trailing into empty
                  space would suggest otherwise. */}
              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    marginVertical: 2,
                    borderRadius: radius.sm,
                    backgroundColor:
                      step.state === "done" ? theme.color.kola["300"] : theme.color.field["200"],
                  }}
                />
              ) : null}
            </View>

            <View style={{ flex: 1, paddingBottom: last ? 0 : space[4], gap: 2 }}>
              <Type
                variant={step.state === "current" ? "bodyStrong" : "body"}
                style={{
                  fontSize: 15,
                  color: step.state === "waiting" ? theme.color.ink["500"] : theme.color.ink["900"],
                }}
              >
                {step.label}
              </Type>
              {step.when ? <Type variant="caption">{onDate(step.when)}</Type> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function glyphOf(state: TimelineStep["state"]): keyof typeof Ionicons.glyphMap {
  if (state === "done") return "checkmark-circle";
  if (state === "current") return "radio-button-on";
  if (state === "stopped") return "close-circle";
  return "ellipse-outline";
}

function toneOf(state: TimelineStep["state"]): string {
  if (state === "done") return theme.color.kola["600"];
  if (state === "current") return theme.color.kola["600"];
  if (state === "stopped") return theme.color.laterite["600"];
  return theme.color.ink["300"];
}

function onDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
