"use client";

/**
 * Where somebody is in a guided setup, and what is left.
 *
 * Extracted from the space flow rather than written twice. The space flow's
 * steps are strictly sequential — a space has to exist before a photograph has
 * anywhere to go — while a property's are not: the documents, the photographs
 * and the amenities are three independent piles of work on a record that
 * already exists, and a provider who has the indenture to hand but is not at the
 * building should be able to do that one first.
 *
 * So this renders **status**, not position. Each step says whether it is done,
 * started, or untouched, and every one of them is reachable. That is the
 * difference between a wizard, which is right when order is forced, and a
 * checklist, which is right when it is not.
 *
 * Nothing here decides completeness. The caller works that out from what the
 * server says, because every one of these steps is server-side state — which is
 * also what makes leaving and coming back lose nothing.
 */

import type { ReactNode } from "react";

import {
  CheckpointJourney,
  type CreationCheckpoint,
} from "@/components/creation/CheckpointJourney";

export type StepStatus = "done" | "started" | "todo";

export type SetupStep = {
  key: string;
  title: string;
  /** What this step is for, in one line. Shown while it is the current one. */
  summary: string;
  status: StepStatus;
  /** Said instead of a tick when a step is finished — "3 photos", "Borehole". */
  detail?: string;
  /** True where the flow is complete without it. */
  optional?: boolean;
  /** The last step, which is an action rather than a piece of data. It is drawn
   *  with its number and never a tick — see `propertySetup.ts`. */
  terminal?: boolean;
};

const MARK: Record<StepStatus, { glyph: string; ink: string; ground: string }> = {
  done: { glyph: "✓", ink: "var(--color-kola-600)", ground: "var(--color-kola-50)" },
  started: {
    glyph: "…",
    ink: "var(--color-harmattan-600)",
    ground: "var(--color-harmattan-100)",
  },
  todo: { glyph: "", ink: "var(--color-ink-500)", ground: "var(--color-field-100)" },
};

export function SetupSteps({
  steps,
  current,
  onSelect,
}: {
  steps: SetupStep[];
  current: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Setup steps">
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid" }}>
        {steps.map((step, index) => {
          const here = step.key === current;
          // A terminal step keeps its number whatever its status: "Review" is
          // something you do, and a tick on it before you have been there reads
          // as finished work that has not happened.
          const mark = step.terminal ? MARK.todo : MARK[step.status];
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => onSelect(step.key)}
                aria-current={here ? "step" : undefined}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  textAlign: "left",
                  padding: "var(--space-3)",
                  minHeight: "var(--target-min)",
                  cursor: "pointer",
                  background: here ? "var(--color-field-100)" : "transparent",
                  border: "none",
                  borderLeft: `var(--border-stamp) solid ${
                    here ? "var(--color-kola-600)" : "transparent"
                  }`,
                  borderTop:
                    index === 0
                      ? "none"
                      : "var(--border-hairline) solid var(--color-field-200)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: "0 0 auto",
                    width: 24,
                    height: 24,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "var(--radius-stamp)",
                    background: mark.ground,
                    color: mark.ink,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {step.terminal ? index + 1 : mark.glyph || index + 1}
                </span>

                <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
                  <span
                    className="type-body-strong"
                    style={{ color: here ? "var(--color-ink-900)" : "var(--color-ink-700)" }}
                  >
                    {step.title}
                    {step.optional ? (
                      <span
                        className="type-caption"
                        style={{ color: "var(--color-ink-500)", fontWeight: 400 }}
                      >
                        {" "}
                        · optional
                      </span>
                    ) : null}
                  </span>
                  {/* State, never a description. A row falling back to
                      `summary` put an explanatory sentence under every step
                      nobody had reached yet — five of them stacked in a
                      navigation list, which is exactly what §10.1 forbids:
                      a row that names its destination needs nothing under it.
                      The panel it opens says what the step is for. */}
                  {step.detail ?? (step.status === "done" ? "Done" : null) ? (
                    <span className="type-caption" style={{ color: mark.ink }}>
                      {step.detail ?? "Done"}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * How far along the whole thing is.
 *
 * Counts only what is required. An optional step left undone is not progress
 * missing — saying "4 of 5" to somebody who has finished everything that
 * matters is how a product invents an obligation it does not have. The terminal
 * step goes with them: it never becomes "done", so counting it would cap the
 * bar one short and a finished property would read as unfinished forever.
 *
 * Drawn as a named journey of every meaningful stage rather than a single
 * filling bar. The accessible completion value still counts only required
 * work, while the visible current position keeps optional and review stages in
 * their proper place. Each checkpoint carries its own state, so work needing
 * attention is not averaged into a percentage.
 *
 * The last checkpoint clearing changes what this says, not just how much of it
 * is filled. "Setting up" becoming "Ready to review" is the moment worth
 * marking, and a bar that merely reached its end leaves somebody to work out
 * that it did.
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
  basics: "properties",
  details: "details",
  documents: "applications",
  photos: "photos",
  amenities: "amenities",
  review: "verification",
};

export function SetupProgress({
  steps,
  current,
}: {
  steps: SetupStep[];
  current?: string;
}) {
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
      ariaLabel="Property creation checkpoints"
      valueNow={done}
      valueMax={required.length}
    />
  );
}

/**
 * A step's own frame.
 *
 * `summary` is optional because most steps do not need one. §10.1: a heading
 * that names the task needs nothing under it, and "Photos" over a checklist
 * naming every required shot was explained twice.
 */
export function StepPanel({
  title,
  summary,
  children,
  footer,
}: {
  title: string;
  /** Only where the heading genuinely leaves something unsaid. */
  summary?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      style={{
        display: "grid",
        gap: "var(--space-5)",
        padding: "var(--space-6)",
        background: "var(--color-field-0)",
        border: "var(--border-hairline) solid var(--color-field-200)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <h2 className="type-title-2" style={{ margin: 0 }}>
          {title}
        </h2>
        {summary ? (
          <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
            {summary}
          </p>
        ) : null}
      </div>
      {children}
      {footer}
    </section>
  );
}
