/**
 * A viewing, read as an appointment rather than a state machine.
 *
 * The backend already answers "what may this person do" precisely —
 * `actions`, `check_in`, `attendance` and `post_viewing` are all computed
 * per-reader on the server. This module does not re-derive any of that. It
 * decides two things the clients kept deciding differently: which of the three
 * lists a viewing belongs in, and what the one sentence about it should say.
 *
 * Twelve statuses, and only a handful of them mean anything to a tenant
 * standing at a junction wondering whether to get in a taxi. What they want is
 * the day, the time, and whether something is waiting on them.
 *
 * The twin of `mobile/src/viewingMeaning.ts`; a mirror test keeps the two
 * identical below the header comment.
 */

export type ViewingGroup = "upcoming" | "action" | "past";
export type ViewingFilter = "all" | ViewingGroup;

export const viewingFilters: readonly { id: ViewingFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "action", label: "Needs you" },
  { id: "past", label: "Past" },
];

export function matchesViewingFilter(group: ViewingGroup, filter: ViewingFilter): boolean {
  return filter === "all" || group === filter;
}

export type ViewingStanding = {
  group: ViewingGroup;
  /** One line: where it stands and what follows. */
  line: string;
  /** The single thing to do, when the lifecycle offers one. */
  callToAction: string | null;
};

/** The fields this module reads. Both clients' `Viewing` types satisfy it. */
export type ViewingLike = {
  status: string;
  confirmed_starts_at: string | null;
  is_upcoming: boolean;
  check_in: { state: string };
  attendance: { state: string; can_report: boolean; can_respond: boolean };
  post_viewing: { available: boolean; selected_action: string | null };
  actions: { can_confirm_slot?: boolean };
  cancelled_by?: string | null;
};

/**
 * Where a viewing belongs, and what it says.
 *
 * Order of the checks is the priority order: anything waiting on the tenant is
 * an action wherever it sits in the lifecycle, and only then does the schedule
 * reading apply.
 */
export function standing(viewing: ViewingLike): ViewingStanding {
  // --- waiting on this tenant ---------------------------------------------
  if (viewing.status === "offered" && viewing.actions.can_confirm_slot) {
    return { group: "action", line: "Times offered — pick one", callToAction: "Choose a time" };
  }
  if (viewing.attendance.can_respond) {
    return {
      group: "action",
      line: "Someone reported you did not attend",
      callToAction: "Respond",
    };
  }
  if (viewing.attendance.can_report) {
    return { group: "action", line: "Did this viewing happen?", callToAction: "Say what happened" };
  }
  if (viewing.post_viewing.available) {
    return { group: "action", line: "You saw the place", callToAction: "What next?" };
  }

  // --- still ahead ---------------------------------------------------------
  switch (viewing.status) {
    case "requested":
      return { group: "upcoming", line: "Waiting for the landlord to offer times", callToAction: null };
    case "offered":
      return { group: "upcoming", line: "Waiting for the landlord to confirm", callToAction: null };
    case "confirmed":
      if (viewing.check_in.state === "ready") {
        return { group: "upcoming", line: "Check in when you arrive", callToAction: "Open check-in" };
      }
      return { group: "upcoming", line: "Confirmed", callToAction: null };
    case "checked_in":
      return { group: "upcoming", line: "You are checked in", callToAction: null };

    // --- finished ----------------------------------------------------------
    case "completed":
      return { group: "past", line: "You saw the place", callToAction: null };
    case "declined":
      return { group: "past", line: "The landlord could not offer a time", callToAction: null };
    case "withdrawn":
      return { group: "past", line: "You withdrew this", callToAction: null };
    case "cancelled":
      return {
        group: "past",
        line: viewing.cancelled_by === "tenant" ? "You cancelled this" : "The landlord cancelled",
        callToAction: null,
      };
    case "tenant_no_show":
      return { group: "past", line: "Recorded as not attended", callToAction: null };
    case "host_no_show":
      return { group: "past", line: "The landlord did not attend", callToAction: null };
    case "disputed":
      return { group: "past", line: "Attendance is disputed", callToAction: null };
    default:
      return { group: "past", line: "Closed", callToAction: null };
  }
}

/**
 * When, as somebody with a day to plan reads it.
 *
 * "Today · 3:30 PM" is what makes this a schedule. A full timestamp on every
 * row makes it a table.
 */
export function whenLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const time = at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  const days = calendarDaysBetween(now, at);
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  if (days === -1) return `Yesterday · ${time}`;

  const day = at.toLocaleDateString("en-GH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day} · ${time}`;
}

/** Whole calendar days from `from` to `to`, ignoring the clock. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Where the place is, before the exact address is released. */
export function placeOf(viewing: {
  locality_name: string | null;
  landmark: string | null;
}): string {
  return [viewing.locality_name, viewing.landmark].filter(Boolean).join(" · ");
}

/**
 * Soonest first, and anything without a time after everything with one.
 *
 * A schedule sorted by when the *request* was made is not a schedule.
 */
export function bySoonest(a: ViewingLike, b: ViewingLike): number {
  const left = a.confirmed_starts_at;
  const right = b.confirmed_starts_at;
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}
