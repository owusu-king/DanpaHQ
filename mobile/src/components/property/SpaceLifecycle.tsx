/**
 * Where a rentable space stands, on all three of its axes at once.
 *
 * The web component of the same name, said in React Native. Three marks, always
 * all three: a space is checked or not, offered publicly or not, takeable or
 * not, and those change at different times for different reasons. One pill
 * saying "Live" answers one of the three and implies answers to the other two,
 * which is how a provider comes to believe a verified room is advertised.
 *
 * "Not checked" is drawn as plainly as "Verified", per the design system: an
 * absent mark lets the interface imply a check that never happened.
 */

import { View } from "react-native";

import { Type, space } from "@/components/ui";
import type { SpaceAvailability, SpacePublication, SpaceVerification } from "@/provider";
import { theme } from "@/theme";

type Tone = "good" | "waiting" | "attention" | "neutral";

const TONES: Record<Tone, { ink: string; ground: string }> = {
  good: { ink: theme.color.kola["600"], ground: theme.color.kola["50"] },
  waiting: { ink: theme.color.harmattan["600"], ground: theme.color.harmattan["100"] },
  attention: { ink: theme.color.laterite["600"], ground: theme.color.laterite["100"] },
  neutral: { ink: theme.color.ink["500"], ground: theme.color.field["100"] },
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
    <View
      accessible
      accessibilityLabel={`${what}: ${says}`}
      style={{
        gap: 2,
        paddingVertical: space[2],
        paddingHorizontal: space[3],
        backgroundColor: ground,
        borderLeftWidth: 3,
        borderLeftColor: ink,
        borderRadius: 4,
        minWidth: 108,
      }}
    >
      <Type variant="label" style={{ color: theme.color.ink["500"] }}>
        {what.toUpperCase()}
      </Type>
      <Type variant="caption" style={{ color: ink, fontWeight: "500" }}>
        {says}
      </Type>
    </View>
  );
}

export function SpaceLifecycle({
  verification,
  publication,
  availability,
  compact = false,
}: {
  verification: SpaceVerification;
  publication: SpacePublication;
  availability: SpaceAvailability;
  compact?: boolean;
}) {
  if (compact) {
    const label = availability.state === "occupied"
      ? "Occupied"
      : verification.state === "verified"
        ? publication.state === "published" ? "Verified · Public · Available" : "Verified · Available"
        : verification.state === "submitted" || verification.state === "under_review"
          ? "Verification in progress"
          : verification.state_label;
    const tone: Tone = availability.state === "occupied"
      ? "neutral"
      : verification.state === "verified"
        ? "good"
        : ["changes_requested", "rejected", "suspended", "expired"].includes(verification.state)
          ? "attention"
          : verification.state === "submitted" || verification.state === "under_review"
            ? "waiting"
            : "neutral";
    return <Type variant="caption" style={{ color: TONES[tone].ink, fontWeight: "500" }}>{label}</Type>;
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
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
    </View>
  );
}

/**
 * The one thing to do next about the check.
 *
 * Null when there is nothing to offer — verified, or already with a reviewer —
 * so a screen renders no button rather than a disabled one nobody can explain.
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
