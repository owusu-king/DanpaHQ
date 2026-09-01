"use client";

/**
 * Where a rentable space stands, on all three of its axes at once.
 *
 * A space is checked, or not. It is offered publicly, or not. It can be taken,
 * or not. Those change at different times for different reasons, and a single
 * pill saying "Live" answers one of the three questions while implying answers
 * to the other two — which is how a provider comes to believe a verified room
 * is advertised, or that taking an advertisement down un-verified it.
 *
 * So three marks, drawn the same way, always all three. "Not checked" is drawn
 * as plainly as "Verified" for the reason the design system gives: an absent
 * stamp lets the interface imply a check that never happened.
 *
 * Nothing here decides anything. Every state comes from the backend, which is
 * also what enforces the gates the states describe.
 */

import type { SpaceAvailability, SpacePublication, SpaceVerification } from "@/lib/console";

type Tone = "good" | "waiting" | "attention" | "neutral";

const TONES: Record<Tone, { ink: string; ground: string }> = {
  good: { ink: "var(--color-kola-600)", ground: "var(--color-kola-50)" },
  waiting: { ink: "var(--color-harmattan-600)", ground: "var(--color-harmattan-100)" },
  attention: { ink: "var(--color-laterite-600)", ground: "var(--color-laterite-100)" },
  neutral: { ink: "var(--color-ink-500)", ground: "var(--color-field-100)" },
};

const VERIFICATION_TONE: Record<SpaceVerification["state"], Tone> = {
  draft: "neutral",
  ready_for_submission: "waiting",
  submitted: "waiting",
  under_review: "waiting",
  verified: "good",
  changes_requested: "attention",
  rejected: "attention",
  suspended: "attention",
  expired: "attention",
};

const PUBLICATION_TONE: Record<SpacePublication["state"], Tone> = {
  private: "neutral",
  published: "good",
  withdrawn: "neutral",
};

const AVAILABILITY_TONE: Record<SpaceAvailability["state"], Tone> = {
  available: "good",
  occupied: "neutral",
  expired: "attention",
};

function Mark({ what, says, tone }: { what: string; says: string; tone: Tone }) {
  const { ink, ground } = TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 2,
        padding: "var(--space-2) var(--space-3)",
        background: ground,
        // Square, with a rule down one side. The design system's print mark,
        // not a rounded chip.
        borderLeft: `var(--border-stamp) solid ${ink}`,
        borderRadius: "var(--radius-stamp)",
        minWidth: "7rem",
      }}
    >
      <span
        className="type-label"
        style={{ color: "var(--color-ink-500)", textTransform: "uppercase" }}
      >
        {what}
      </span>
      <span className="type-caption" style={{ color: ink, fontWeight: 600 }}>
        {says}
      </span>
    </span>
  );
}

export function SpaceLifecycle({
  verification,
  publication,
  availability,
}: {
  verification: SpaceVerification;
  publication: SpacePublication;
  availability: SpaceAvailability;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
      <Mark
        what="Check"
        says={verification.state_label}
        tone={VERIFICATION_TONE[verification.state] ?? "neutral"}
      />
      <Mark
        what="Listing"
        says={publication.label}
        tone={PUBLICATION_TONE[publication.state] ?? "neutral"}
      />
      <Mark
        what="Availability"
        says={availability.label}
        tone={AVAILABILITY_TONE[availability.state] ?? "neutral"}
      />
    </div>
  );
}

/**
 * The one thing to do next about the check, given where it stands.
 *
 * Returns null when there is nothing to offer — verified, or already with a
 * reviewer — so a screen renders no button rather than a disabled one nobody
 * can explain.
 */
export function nextCheckAction(state: SpaceVerification["state"]): string | null {
  switch (state) {
    case "draft":
      return "Add the photos";
    case "ready_for_submission":
      return "Send for checking";
    case "changes_requested":
      return "See what was asked for";
    case "rejected":
    case "expired":
      return "Send it again";
    default:
      return null;
  }
}
