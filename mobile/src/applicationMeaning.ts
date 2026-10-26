/**
 * What an application means to the person who sent it.
 *
 * A tenant opening this list is asking four questions: where did I apply, where
 * does it stand, is anything needed from me, and what happens next. A status
 * word answers one of them. So each application resolves to a single line that
 * is the status *and* the next step, plus an action when there genuinely is one.
 *
 * The lifecycle is unchanged — `submitted → under_review → accepted | rejected`,
 * withdrawable by the applicant at any time. What acceptance leads to lives in
 * the lease, so the leases the tenant can already read are joined in here rather
 * than guessed at: "Accepted" alone never tells anyone whether an agreement is
 * waiting for them.
 *
 * The twin of `web/src/lib/applicationMeaning.ts`; a mirror test keeps the two
 * identical below the header comment.
 */

export type ApplicationStage = "action" | "open" | "past";

export type ApplicationFilter = "all" | "action" | "open" | "approved" | "past";
export type ApplicationBucket = Exclude<ApplicationFilter, "all">;

export const applicationFilters: readonly { id: ApplicationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "action", label: "Needs you" },
  { id: "open", label: "In progress" },
  { id: "approved", label: "Approved" },
  { id: "past", label: "Past" },
];

/** Only the lease fields this join needs, so both clients can pass their own. */
export type LeaseLink = { id: string; status: string; application: string | null };

export type ApplicationStanding = {
  stage: ApplicationStage;
  /** One line: where it stands and what follows. Never repeated elsewhere. */
  line: string;
  /** The agreement this application became, once it became one. */
  leaseId: string | null;
};

export function standing(
  application: { id: string; status: string },
  leases: readonly LeaseLink[],
): ApplicationStanding {
  const lease = leases.find((row) => row.application === application.id) ?? null;
  const leaseId = lease?.id ?? null;

  switch (application.status) {
    case "submitted":
      return { stage: "open", line: "Waiting for the landlord", leaseId };
    case "under_review":
      return { stage: "open", line: "Being considered", leaseId };
    case "rejected":
      return { stage: "past", line: "Not accepted", leaseId };
    case "withdrawn":
      return { stage: "past", line: "You withdrew this", leaseId };
    case "accepted":
      break;
    default:
      return { stage: "past", line: "Closed", leaseId };
  }

  switch (lease?.status) {
    case "offered":
      return { stage: "action", line: "Agreement ready for you", leaseId };
    case "awaiting_activation":
      return { stage: "open", line: "Accepted — waiting to start", leaseId };
    case "active":
      return { stage: "past", line: "You live here now", leaseId };
    case "declined":
      return { stage: "past", line: "You declined the agreement", leaseId };
    case "cancelled":
      return { stage: "past", line: "The agreement was cancelled", leaseId };
    case "ended":
      return { stage: "past", line: "That tenancy has ended", leaseId };
    default:
      return { stage: "open", line: "Agreement being prepared", leaseId };
  }
}

/**
 * The one history bucket an application belongs to.
 *
 * This is deliberately separate from `standing()`. Standing answers what is
 * happening next; this answers where the record belongs when somebody filters
 * their history. An active tenancy, for example, has finished its application
 * journey but remains an approved application — not a refusal hidden among
 * past outcomes.
 */
export function applicationBucket(
  application: { id: string; status: string; concluded_at?: string | null },
  leases: readonly LeaseLink[],
): ApplicationBucket {
  const lease = leases.find((row) => row.application === application.id) ?? null;

  if (application.concluded_at) return "past";
  if (["rejected", "withdrawn"].includes(application.status)) return "past";
  if (["submitted", "under_review"].includes(application.status)) return "open";
  if (application.status !== "accepted") return "past";

  if (lease?.status === "offered") return "action";
  if (["declined", "cancelled", "ended"].includes(lease?.status ?? "")) return "past";
  return "approved";
}

export function matchesApplicationFilter(
  bucket: ApplicationBucket,
  filter: ApplicationFilter,
): boolean {
  return filter === "all" || bucket === filter;
}

/**
 * Whether this application is still a live claim on its Unit.

 * Two callers ask this: the apply gate on a listing, and the count of what a
 * tenant has in flight. Both had it written out by hand — the same three
 * statuses, hardcoded four times — and when the backend learned that an accepted
 * application stops being live once its tenancy ends, none of the copies heard.
 * The backend fix worked and the button still said "Application sent".
 *
 * The lifecycle rule, in the one place both clients read from. It was written
 * out by hand on the web listing page and again on the mobile one — the same
 * three statuses, hardcoded twice — and when the backend learned that an
 * accepted application stops being a live claim once its tenancy ends, neither
 * copy heard about it. The fix worked and the button still said "Application
 * sent".
 *
 * `concluded_at` is what the backend sets when the agreement behind an
 * application is declined, cancelled or ended. The status stays `accepted`,
 * because it was; only its standing changes.
 */
export function isLive(application: {
  status: string;
  concluded_at?: string | null;
}): boolean {
  if (application.concluded_at) return false;
  return ["submitted", "under_review", "accepted"].includes(application.status);
}

/* --- the journey -------------------------------------------------------- */

export type TimelineState =
  /** Behind us, and it happened. */
  | "done"
  /** Where this application actually is right now. Exactly one, or none. */
  | "current"
  /** Ahead of us, and still expected. */
  | "waiting"
  /** Behind us, and it ended here. Nothing follows a stopped step. */
  | "stopped";

export type TimelineStep = {
  id: string;
  label: string;
  state: TimelineState;
  /** The day it happened, where the record actually knows. Never guessed. */
  when: string | null;
};

/**
 * The application as a journey rather than a status word.
 *
 * A tenant reading "Being considered" knows where it stands and not how it got
 * there or what is left. This is the same lifecycle `standing()` collapses into
 * one line, opened out: what has happened, what is happening, what is still to
 * come — and, when it ended early, that nothing follows.
 *
 * Deliberately short. Four steps at most, and a withdrawn application has two,
 * because a journey nobody completed should not be drawn as a row of grey
 * placeholders implying they failed at each one.
 *
 * Wording is shared with `standing()` on purpose: the row and the record must
 * never describe the same application differently.
 *
 * Dates come only from `created_at` and `decided_at`, which are the two the
 * record actually carries. A step with no date shows none rather than an
 * invented one.
 */
export function timeline(
  application: { id: string; status: string; created_at: string; decided_at: string | null },
  leases: readonly LeaseLink[],
): TimelineStep[] {
  const applied: TimelineStep = {
    id: "applied",
    label: "You applied",
    state: "done",
    when: application.created_at,
  };

  if (application.status === "withdrawn") {
    // Two steps, not four. They stopped this themselves; drawing the review and
    // the decision they never reached would read as a list of failures.
    return [
      applied,
      { id: "withdrawn", label: "You withdrew this", state: "stopped", when: application.decided_at },
    ];
  }

  if (application.status === "rejected") {
    return [
      applied,
      { id: "review", label: "The landlord read it", state: "done", when: null },
      { id: "decision", label: "Not accepted", state: "stopped", when: application.decided_at },
    ];
  }

  if (application.status === "submitted" || application.status === "under_review") {
    return [
      applied,
      {
        id: "review",
        label:
          application.status === "submitted" ? "Waiting for the landlord" : "Being considered",
        state: "current",
        when: null,
      },
      { id: "decision", label: "Their decision", state: "waiting", when: null },
    ];
  }

  if (application.status !== "accepted") {
    return [applied, { id: "closed", label: "Closed", state: "stopped", when: application.decided_at }];
  }

  const accepted: TimelineStep[] = [
    applied,
    { id: "review", label: "The landlord read it", state: "done", when: null },
    { id: "decision", label: "Accepted", state: "done", when: application.decided_at },
  ];

  const lease = leases.find((row) => row.application === application.id) ?? null;
  switch (lease?.status) {
    case "offered":
      return [...accepted, { id: "agreement", label: "Agreement ready for you", state: "current", when: null }];
    case "awaiting_activation":
      return [...accepted, { id: "agreement", label: "Waiting for the tenancy to start", state: "current", when: null }];
    case "active":
      return [...accepted, { id: "agreement", label: "You live here now", state: "done", when: null }];
    case "declined":
      return [...accepted, { id: "agreement", label: "You declined the agreement", state: "stopped", when: null }];
    case "cancelled":
      return [...accepted, { id: "agreement", label: "The agreement was cancelled", state: "stopped", when: null }];
    case "ended":
      return [...accepted, { id: "agreement", label: "That tenancy has ended", state: "stopped", when: null }];
    default:
      return [...accepted, { id: "agreement", label: "Agreement being prepared", state: "current", when: null }];
  }
}

/** Where this place is, said once, in the terms the Unit is named in. */
export function placeOf(application: {
  property_title: string;
  unit_label: string;
  locality_name: string | null;
}): string {
  return [application.property_title, application.unit_label, application.locality_name]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The shortfall, only where it still predicts something.
 *
 * Once a decision has been made the number explains nothing the outcome does not
 * already say, so it belongs in the record rather than on the row.
 */
export function shortfallNote(application: {
  status: string;
  advance_shortfall_months: number;
}): string | null {
  if (!["submitted", "under_review"].includes(application.status)) return null;
  if (application.advance_shortfall_months <= 0) return null;
  const months = application.advance_shortfall_months;
  return `${months} month${months === 1 ? "" : "s"} below the advance they asked for`;
}
