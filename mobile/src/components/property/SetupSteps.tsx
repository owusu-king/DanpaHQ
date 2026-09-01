/**
 * Where somebody is in a guided setup, and what is left — on a phone.
 *
 * The web puts this in a sticky sidebar beside the panel. A phone has no room
 * for a sidebar, so the same information sits above the active step and scrolls
 * with it. That is the divergence ADR 0014 asks for: colour, type and spacing
 * come from the shared tokens and are identical; the *interaction* is the
 * platform's own.
 *
 * Status, not position. Each row says done, started or untouched, and every one
 * is tappable — a property's steps are three independent piles of work on a
 * record that already exists, so the order is a suggestion rather than a rail.
 */

import { Pressable, View } from "react-native";

import { Type, space } from "@/components/ui";
import {
  CheckpointJourney,
  type CreationCheckpoint,
} from "@/components/creation/CheckpointJourney";
import type { SetupStep, StepStatus } from "@/propertySetup";
import { theme } from "@/theme";

const MARK: Record<StepStatus, { glyph: string; ink: string; ground: string }> = {
  done: { glyph: "✓", ink: theme.color.kola["600"], ground: theme.color.kola["50"] },
  started: {
    glyph: "…",
    ink: theme.color.harmattan["600"],
    ground: theme.color.harmattan["100"],
  },
  todo: { glyph: "", ink: theme.color.ink["500"], ground: theme.color.field["100"] },
};

export function SetupSteps({
  steps,
  current,
  onSelect,
}: {
  steps: SetupStep[];
  current: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.color.field["200"],
        backgroundColor: theme.color.field["0"],
        overflow: "hidden",
      }}
    >
      {steps.map((step, index) => {
        const here = step.key === current;
        // A terminal step keeps its number whatever its status: "Review" is
        // something you do, and a tick on it before you have been there reads as
        // finished work that has not happened.
        const mark = step.terminal ? MARK.todo : MARK[step.status];
        return (
          <Pressable
            key={step.key}
            onPress={() => onSelect?.(step.key)}
            disabled={!onSelect}
            accessibilityRole="tab"
            accessibilityState={{ selected: here }}
            accessibilityLabel={`${step.title}: ${step.detail ?? step.status}`}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space[3],
              // 48dp, the Android minimum the design system enforces.
              minHeight: 48,
              paddingVertical: space[3],
              paddingHorizontal: space[3],
              backgroundColor: here ? theme.color.field["100"] : "transparent",
              borderLeftWidth: 3,
              borderLeftColor: here ? theme.color.kola["600"] : "transparent",
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.color.field["200"],
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: mark.ground,
              }}
            >
              <Type variant="label" style={{ color: mark.ink }}>
                {step.terminal ? String(index + 1) : mark.glyph || String(index + 1)}
              </Type>
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <Type
                variant="bodyStrong"
                style={{ color: here ? theme.color.ink["900"] : theme.color.ink["700"] }}
              >
                {step.title}
                {step.optional ? (
                  <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
                    {"  · optional"}
                  </Type>
                ) : null}
              </Type>
              <Type variant="caption" style={{ color: mark.ink }}>
                {step.detail ?? (step.status === "done" ? "Done" : step.summary)}
              </Type>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * How far along the whole thing is.
 *
 * Counts only what is required. An optional step left undone is not progress
 * missing — saying "4 of 5" to somebody who has finished everything that matters
 * is how a product invents an obligation it does not have. The terminal step
 * goes with them: it never becomes "done", so counting it would cap the bar one
 * short and a finished property would read as unfinished forever.
 *
 * Drawn as a named journey of every meaningful stage rather than a single
 * filling bar. The accessible completion value still counts only required
 * work, while the visible current position keeps optional and review stages in
 * their proper place. Each checkpoint carries its own state, so work needing
 * attention is not averaged into a percentage.
 *
 * The last checkpoint clearing changes what this says, not just how much of it
 * is filled: a bar that merely reached its end leaves somebody to work out that
 * it did.
 */
const CHECKPOINT_LABELS: Record<string, string> = {
  basics: "Basics",
  details: "Details",
  documents: "Documents",
  photos: "Photos",
  amenities: "Amenities",
  review: "Review",
};

const CHECKPOINT_ICONS: Record<string, CreationCheckpoint["icon"]> = {
  basics: "property",
  details: "details",
  documents: "documents",
  photos: "photos",
  amenities: "amenities",
  review: "review",
};

export function SetupProgress({ steps, current }: { steps: SetupStep[]; current?: string }) {
  const required = steps.filter((step) => !step.optional && !step.terminal);
  const done = required.filter((step) => step.status === "done").length;
  const complete = required.length > 0 && done === required.length;
  const currentKey = current
    ?? required.find((step) => step.status !== "done")?.key
    ?? steps.find((step) => step.terminal)?.key
    ?? steps[0]?.key;
  const checkpoints: CreationCheckpoint[] = steps.map((step) => ({
    key: step.key,
    label: CHECKPOINT_LABELS[step.key] ?? step.title,
    icon: CHECKPOINT_ICONS[step.key] ?? "details",
    state: step.key === currentKey
      ? "current"
      : step.status === "done"
        ? "completed"
        : step.status === "started"
          ? "attention"
          : "upcoming",
  }));

  return (
    <CheckpointJourney
      checkpoints={checkpoints}
      label={complete ? "READY TO REVIEW" : "BUILDING PROPERTY"}
      accessibilityLabel="Property creation checkpoints"
      valueNow={done}
      valueMax={required.length}
    />
  );
}
