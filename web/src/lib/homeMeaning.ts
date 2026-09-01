/**
 * What a tenant's front door should say today.
 *
 * Home answers four questions and nothing else: *does anything need me, what
 * am I renting, where does my rent and agreement stand, and what is coming
 * next.* Everything here exists to answer one of those; anything that could not
 * change what somebody does today is not in this file.
 *
 * Two rules shaped it. **Home adapts to the lifecycle** — a tenant with no
 * tenancy is shown no Rent, Agreement or Home cards, because empty modules are
 * not information. And **nothing is merged across homes**: `rentLine` and
 * `agreementLine` take one tenancy and answer for that tenancy, because a
 * single "you owe GH₵2,050" across two landlords is a number nobody can act on.
 *
 * Deliberately self-contained — no imports — so the mirror can be compared
 * byte for byte. The two predicates it would otherwise duplicate (whether a
 * viewing or an application is waiting on you) are passed in by the caller,
 * already decided by `viewingMeaning` and `applicationMeaning`, so there is
 * still one answer to each question.
 *
 * The twin of `mobile/src/homeMeaning.ts`; a mirror test keeps the two
 * identical below the header comment.
 */

export type AttentionKind =
  | "rent_overdue"
  | "agreement_offered"
  | "viewing"
  | "application"
  | "join_rejected";

export type Destination = "agreements" | "viewings" | "applications" | "tenancy" | "rentals";

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  /** What is wrong or waiting, in one line. */
  title: string;
  /** Which place, so the line can be acted on when there are several. */
  place: string;
  /** The one thing to do about it. */
  action: string;
  destination: Destination;
  /** Set when the destination needs to know which record. */
  targetId?: string;
};

/* --- the shapes this module reads --------------------------------------- */

export type TenancyLike = {
  id: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  property: { title: string; locality: string; district: string };
  space: { unit_label: string; bed_label: string | null; space_type_label?: string | null };
  photo_url?: string | null;
  lease: {
    status: string;
    status_display: string;
    rent_formatted: string | null;
    rent_period: string;
    ends_on: string | null;
  } | null;
  rent: {
    outstanding_count: number;
    overdue_count: number;
    next_due: {
      kind_display: string;
      due_on: string;
      amount_formatted: string | null;
      is_overdue: boolean;
    } | null;
  } | null;
};

export type OfferedLease = {
  id: string;
  status: string;
  property_title: string;
  unit_label: string;
  landlord_name: string;
};

/** A viewing or application the caller has already decided is waiting on you. */
export type WaitingItem = { id: string; headline: string; action: string };

export type JoinRequestLike = {
  id: string;
  status: string;
  property_title: string;
  unit_label: string | null;
  locality_name: string | null;
  decision_note: string;
};

/* --- attention ----------------------------------------------------------- */

/** Where a home is, said once. */
export function homeWhere(tenancy: TenancyLike): string {
  return [tenancy.property.locality, tenancy.property.district].filter(Boolean).join(", ");
}

/** Which space inside the property. */
export function homeSpace(tenancy: TenancyLike): string {
  const named = [tenancy.space.unit_label, tenancy.space.bed_label].filter(Boolean).join(" · ");
  return named || tenancy.space.space_type_label || "";
}

/** Short enough to name a home inside a one-line attention item. */
export function homeShort(tenancy: TenancyLike): string {
  const space = homeSpace(tenancy);
  return space ? `${tenancy.property.title} · ${space}` : tenancy.property.title;
}

/**
 * Everything genuinely waiting on this person, most consequential first.
 *
 * Late money leads because it is the only item with a cost that grows. An
 * empty result is the normal case and means the section is not rendered at all
 * — there is no permanent "Attention" heading.
 */
export function attention(input: {
  tenancies: TenancyLike[];
  offeredLeases: OfferedLease[];
  viewingsWaiting: WaitingItem[];
  applicationsWaiting: WaitingItem[];
  joinRequests: JoinRequestLike[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const tenancy of input.tenancies) {
    const due = tenancy.rent?.next_due;
    if (!due?.is_overdue) continue;
    items.push({
      id: `rent-${tenancy.id}`,
      kind: "rent_overdue",
      title: `Rent overdue${due.amount_formatted ? ` · ${due.amount_formatted}` : ""}`,
      place: homeShort(tenancy),
      action: "View rent",
      destination: "tenancy",
      targetId: tenancy.id,
    });
  }

  for (const lease of input.offeredLeases) {
    items.push({
      id: `lease-${lease.id}`,
      kind: "agreement_offered",
      title: "Agreement ready to review",
      place: [lease.property_title, lease.unit_label].filter(Boolean).join(" · "),
      action: "Review",
      destination: "agreements",
      targetId: lease.id,
    });
  }

  for (const viewing of input.viewingsWaiting) {
    items.push({
      id: `viewing-${viewing.id}`,
      kind: "viewing",
      title: viewing.action,
      place: viewing.headline,
      action: "Open",
      destination: "viewings",
      targetId: viewing.id,
    });
  }

  for (const application of input.applicationsWaiting) {
    items.push({
      id: `application-${application.id}`,
      kind: "application",
      title: application.action,
      place: application.headline,
      action: "Open",
      destination: "applications",
      targetId: application.id,
    });
  }

  // An access request that was turned down used to be silent on every screen:
  // no notification is emitted for the decision, and until now the requester
  // could not read their own request at all.
  for (const request of input.joinRequests) {
    if (request.status !== "rejected") continue;
    items.push({
      id: `join-${request.id}`,
      kind: "join_rejected",
      title: "Access request was not approved",
      place: [request.property_title, request.unit_label].filter(Boolean).join(" · "),
      action: request.decision_note ? "See why" : "Try another code",
      destination: "rentals",
    });
  }

  return items;
}

/* --- rent ---------------------------------------------------------------- */

export type RentLine = {
  tone: "overdue" | "due" | "clear";
  label: string;
  amount: string | null;
  when: string | null;
};

/**
 * One home's rent, as a summary rather than a ledger.
 *
 * Never a total across homes. Never a transaction list — Home says what is
 * owed next, and Rent keeps the history.
 */
export function rentLine(tenancy: TenancyLike): RentLine | null {
  if (!tenancy.lease) return null;
  const due = tenancy.rent?.next_due ?? null;
  if (!due) return { tone: "clear", label: "Rent", amount: "Nothing due", when: null };
  return {
    tone: due.is_overdue ? "overdue" : "due",
    label: due.is_overdue ? "Rent overdue" : "Next rent",
    amount: due.amount_formatted,
    when: due.due_on,
  };
}

/* --- agreement ----------------------------------------------------------- */

/** The agreement in one line. The terms themselves live in Agreements. */
export function agreementLine(tenancy: TenancyLike): { text: string; needsYou: boolean } | null {
  const lease = tenancy.lease;
  if (!lease) {
    return tenancy.status === "pending_lease"
      ? { text: "Waiting for your agreement", needsYou: false }
      : null;
  }
  if (lease.status === "offered") return { text: "Ready to review", needsYou: true };
  if (lease.status === "awaiting_activation") return { text: "Accepted — starting soon", needsYou: false };
  return { text: lease.status_display, needsYou: false };
}

/* --- what is coming next ------------------------------------------------- */

export type UpcomingEntry = {
  id: string;
  /** ISO date or datetime. */
  when: string;
  what: string;
  place: string;
};

/** A lease end is only news when it is close enough to plan around. */
const ENDING_SOON_DAYS = 60;

/**
 * Genuinely upcoming rental activity, soonest first.
 *
 * Not a calendar of lifecycle events: only a confirmed viewing, the next rent
 * that is not already late, a tenancy that has not started yet, and an
 * agreement ending soon enough to act on.
 */
export function comingUp(
  input: {
    tenancies: TenancyLike[];
    viewings: { id: string; listing_headline: string; confirmed_starts_at: string | null }[];
  },
  now: Date = new Date(),
): UpcomingEntry[] {
  const entries: UpcomingEntry[] = [];
  const today = now.toISOString().slice(0, 10);

  for (const viewing of input.viewings) {
    if (!viewing.confirmed_starts_at) continue;
    if (new Date(viewing.confirmed_starts_at) < now) continue;
    entries.push({
      id: `viewing-${viewing.id}`,
      when: viewing.confirmed_starts_at,
      what: "Viewing",
      place: viewing.listing_headline,
    });
  }

  for (const tenancy of input.tenancies) {
    const due = tenancy.rent?.next_due;
    // Overdue rent is attention, not a calendar entry.
    if (due && !due.is_overdue) {
      entries.push({
        id: `rent-${tenancy.id}`,
        when: due.due_on,
        what: `${due.kind_display} due${due.amount_formatted ? ` · ${due.amount_formatted}` : ""}`,
        place: homeShort(tenancy),
      });
    }
    if (tenancy.status === "upcoming" && tenancy.starts_on && tenancy.starts_on >= today) {
      entries.push({
        id: `start-${tenancy.id}`,
        when: tenancy.starts_on,
        what: "Tenancy starts",
        place: homeShort(tenancy),
      });
    }
    const ends = tenancy.lease?.ends_on ?? tenancy.ends_on;
    if (ends && ends >= today && daysBetween(today, ends) <= ENDING_SOON_DAYS) {
      entries.push({
        id: `end-${tenancy.id}`,
        when: ends,
        what: "Agreement ends",
        place: homeShort(tenancy),
      });
    }
  }

  return entries.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 4);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Morning, afternoon or evening, by the reader's own clock. */
export function greeting(name: string, now: Date = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
