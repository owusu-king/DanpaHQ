// Keep in sync with mobile/src/propertyCard.ts.
type PropertyCardState = {
  verification: { state: string; review_state: string };
  permitted_actions: {
    edit?: { allowed: boolean };
    submit_for_verification?: { allowed: boolean };
  };
};

export function propertyCardPresentation({ verification, permitted_actions: actions }: PropertyCardState) {
  const review = verification.review_state;
  if (review === "verified") return { badge: "Verified", tone: "good", action: "view" } as const;
  if (review === "pending_verification") return { badge: "Under review", tone: "waiting", action: "details" } as const;
  if (["changes_required", "rejected", "suspended", "expired"].includes(review)) {
    return { badge: "Needs attention", tone: "attention", action: "details" } as const;
  }
  if (review === "withdrawn") {
    return { badge: "Withdrawn", tone: "neutral", action: actions.submit_for_verification?.allowed ? "submit" : "details" } as const;
  }
  if (verification.state === "ready_for_submission") {
    return { badge: "Ready for review", tone: "neutral", action: actions.submit_for_verification?.allowed ? "submit" : "details" } as const;
  }
  return { badge: "Draft", tone: "neutral", action: actions.edit?.allowed ? "continue" : "details" } as const;
}

export const propertyCardActionLabels = {
  view: "View",
  details: "View details",
  submit: "Submit for review",
  continue: "Continue setup",
} as const;
