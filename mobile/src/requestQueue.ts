/**
 * What a tenancy request means to the provider: whose move it is, what that
 * move is, and what the decision turns on.
 *
 * The Requests screen used to file each request under a status and let a Filter
 * sheet slice the pile. A property manager does not open it to browse records;
 * they open it to answer "what needs me, and what do I need to know to do it?"
 * So every request resolves here to one place in the leasing journey, one owner
 * of the next step, the step itself, and the few facts the decision rests on.
 *
 * Both sources are read the same way — an application against a public listing,
 * and a direct request from somebody holding a Unit's access code — because they
 * are the same question. Only the evidence differs.
 *
 * Nothing here is invented: every date is one the records carry, and a viewing
 * is linked to an application only where the same tenant asked to see the same
 * listing.
 */

import type { RentalApplication } from "@/applications";
import type { Lease } from "@/leases";
import type { PortfolioSummary } from "@/organizations";
import type { Viewing } from "@/viewings";

export type PrivateRequest = PortfolioSummary["tenancy_requests"][number];

export type RequestItem =
  | { key: string; kind: "application"; application: RentalApplication; lease: Lease | null; viewing: ViewingLink }
  | { key: string; kind: "private"; request: PrivateRequest; organizationId: string };

/** Where a request is in the leasing journey. The first four are live. */
export type Phase = "decide" | "agreement" | "tenant" | "moving" | "settled";

/** The journey as the provider walks it, and who each step waits on. */
export const JOURNEY: readonly { phase: Exclude<Phase, "settled">; label: string; short: string; owner: "you" | "them" }[] = [
  { phase: "decide", label: "Decide", short: "Decide", owner: "you" },
  { phase: "agreement", label: "Agreement", short: "Agreement", owner: "you" },
  { phase: "tenant", label: "With tenant", short: "Tenant", owner: "them" },
  { phase: "moving", label: "Moving in", short: "Moving", owner: "them" },
];

/** A decision that has waited this many days is stalled. */
export const STALLED_DAYS = 3;

type LeaseStatus = Lease["status"];

export function leaseStatusOf(item: RequestItem): LeaseStatus | null {
  return item.kind === "application" ? item.lease?.status ?? null : item.request.lease_status;
}

export function leaseIdOf(item: RequestItem): string | null {
  return item.kind === "application" ? item.lease?.id ?? null : item.request.lease_id;
}

export function createdAt(item: RequestItem): string {
  return item.kind === "application" ? item.application.created_at : item.request.created_at;
}

export function whoOf(item: RequestItem): string {
  return item.kind === "application" ? item.application.applicant_name : item.request.requester_display;
}

/** The exact space asked for: Property and Unit, down to the bed for a direct request. */
export function placeOf(item: RequestItem): string {
  return item.kind === "application"
    ? [item.application.property_title, item.application.unit_label].filter(Boolean).join(" · ") || item.application.listing_headline
    : [item.request.property_title, item.request.unit_label, item.request.bed_label].filter(Boolean).join(" · ");
}

/** The agreement's own progress, once there is one, decides everything after acceptance. */
function phaseAfterAcceptance(lease: LeaseStatus | null): Phase {
  if (!lease || lease === "draft" || lease === "ready") return "agreement";
  if (lease === "offered") return "tenant";
  if (lease === "tenant_accepted" || lease === "awaiting_activation") return "moving";
  return "settled";
}

export function phaseOf(item: RequestItem): Phase {
  if (item.kind === "application") {
    const { status, concluded_at } = item.application;
    if (concluded_at) return "settled";
    if (status === "submitted" || status === "under_review") return "decide";
    if (status !== "accepted") return "settled";
    return phaseAfterAcceptance(item.lease?.status ?? null);
  }
  if (item.request.status === "pending") return "decide";
  return phaseAfterAcceptance(item.request.lease_status);
}

/**
 * Whether the next step is the provider's. A tenant who has accepted the
 * agreement is waiting on the provider to confirm it, so that step is theirs
 * even though the request is otherwise moving in.
 */
export function isYourMove(item: RequestItem): boolean {
  const phase = phaseOf(item);
  return phase === "decide" || phase === "agreement" || leaseStatusOf(item) === "tenant_accepted";
}

/** A direct request may only be answered by an Owner, Admin or its assigned manager. */
export function canAct(item: RequestItem): boolean {
  return item.kind === "private" ? item.request.can_manage : true;
}

/** The one thing to do next, where it is the provider's to do. */
export type NextStep =
  | { kind: "decide" }
  | { kind: "prepare"; label: "Prepare agreement" }
  | { kind: "lease"; label: "Send agreement" | "Confirm move-in"; leaseId: string };

export function nextStep(item: RequestItem): NextStep | null {
  if (!canAct(item)) return null;
  const phase = phaseOf(item);
  if (phase === "decide") return { kind: "decide" };
  const lease = leaseStatusOf(item);
  const leaseId = leaseIdOf(item);
  if (phase === "agreement") {
    return leaseId && (lease === "draft" || lease === "ready")
      ? { kind: "lease", label: "Send agreement", leaseId }
      : { kind: "prepare", label: "Prepare agreement" };
  }
  if (lease === "tenant_accepted" && leaseId) return { kind: "lease", label: "Confirm move-in", leaseId };
  return null;
}

/**
 * Since when the request has waited on whoever holds it: the date the records
 * know for the step it is on, falling back to when it arrived.
 */
export function waitingSince(item: RequestItem): string {
  const lease = item.kind === "application" ? item.lease : null;
  const phase = phaseOf(item);
  if (phase === "decide") return createdAt(item);
  if (leaseStatusOf(item) === "tenant_accepted" && lease?.tenant_accepted_at) return lease.tenant_accepted_at;
  if (lease) return lease.created_at;
  if (item.kind === "application" && item.application.decided_at) return item.application.decided_at;
  return createdAt(item);
}

export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** A short age, the way a phone says it: today, 1d, 5d, 3w. */
export function shortAge(days: number): string {
  if (days < 1) return "Today";
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** Where it stands, in one line, for a request whose next step is somebody else's or done. */
export function standingLine(item: RequestItem): string {
  const lease = leaseStatusOf(item);
  const phase = phaseOf(item);
  if (phase === "decide") return canAct(item) ? "Waiting for your decision" : "Needs an Owner, Admin or its manager";
  if (phase === "agreement") return lease === "draft" || lease === "ready" ? "Agreement drafted, not sent" : "Accepted — no agreement yet";
  if (lease === "offered") return "Tenant is reviewing the agreement";
  if (lease === "tenant_accepted") return "Tenant accepted — confirm to start";
  if (lease === "awaiting_activation") {
    const requirement = item.kind === "application" ? item.lease?.activation_requirement : null;
    return requirement === "initial_payment" ? "Waiting for the first payment" : "Waiting for activation";
  }
  if (lease === "active") return "Moved in";
  if (lease === "declined") return "Tenant declined the agreement";
  if (lease === "cancelled") return "Agreement withdrawn";
  if (lease === "ended") return "Tenancy ended";
  if (item.kind === "application") {
    if (item.application.status === "rejected") return "You declined";
    if (item.application.status === "withdrawn") return "They withdrew";
  }
  return "Closed";
}

/** Settled the good way, or closed without a tenancy. */
export function movedIn(item: RequestItem): boolean {
  const lease = leaseStatusOf(item);
  return lease === "active" || lease === "ended";
}

/* --- viewings ----------------------------------------------------------- */

export type ViewingLink =
  | { state: "none" }
  | { state: "requested" }
  | { state: "upcoming"; at: string }
  | { state: "viewed"; at: string | null };

const VIEWED = new Set(["checked_in", "attendance_pending", "completed"]);
const same = (left: string, right: string) => left.trim().toLocaleLowerCase("en-GH") === right.trim().toLocaleLowerCase("en-GH");

/**
 * The viewing behind an application, where the same person asked to see the same
 * listing. A confirmed visit still ahead wins; then one that took place; then a
 * request still waiting for a time.
 */
export function viewingFor(application: Pick<RentalApplication, "listing_id" | "applicant_name">, viewings: readonly Viewing[]): ViewingLink {
  const theirs = viewings.filter((row) => row.listing_id === application.listing_id && same(row.tenant_name, application.applicant_name));
  const upcoming = theirs
    .filter((row) => row.status === "confirmed" && row.is_upcoming && row.confirmed_starts_at)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))[0];
  if (upcoming?.confirmed_starts_at) return { state: "upcoming", at: upcoming.confirmed_starts_at };
  const viewed = theirs
    .filter((row) => VIEWED.has(row.status))
    .sort((a, b) => (b.checked_in_at ?? b.confirmed_starts_at ?? "").localeCompare(a.checked_in_at ?? a.confirmed_starts_at ?? ""))[0];
  if (viewed) return { state: "viewed", at: viewed.checked_in_at ?? viewed.confirmed_starts_at };
  if (theirs.some((row) => row.status === "requested" || row.status === "offered")) return { state: "requested" };
  return { state: "none" };
}

/* --- evidence ----------------------------------------------------------- */

export type Evidence = { icon: "wallet-outline" | "eye-outline" | "calendar-outline" | "key-outline" | "time-outline"; text: string; tone: "good" | "caution" | "info" | "quiet" };

/**
 * The few facts a decision turns on, said on the row so it can be made from the
 * list: whether the advance offered meets the advance asked, and whether they
 * have seen the place. Only while a decision is open — afterwards the outcome
 * says more than the evidence did.
 */
export function evidenceFor(item: RequestItem, formatWhen: (iso: string) => string): Evidence[] {
  if (phaseOf(item) !== "decide") return [];
  if (item.kind === "private") return [{ icon: "key-outline", text: "Holds the Unit's access code", tone: "quiet" }];
  const application = item.application;
  const out: Evidence[] = [];
  const asked = application.advance_months_asked;
  out.push(application.meets_advance
    ? { icon: "wallet-outline", text: `Meets ${asked}-month advance`, tone: "good" }
    : { icon: "wallet-outline", text: `Offers ${application.advance_months_offered} of ${asked} months`, tone: "caution" });
  const viewing = item.viewing;
  if (viewing.state === "upcoming") out.push({ icon: "calendar-outline", text: `Viewing ${formatWhen(viewing.at)}`, tone: "info" });
  else if (viewing.state === "viewed") out.push({ icon: "eye-outline", text: viewing.at ? `Viewed ${formatWhen(viewing.at)}` : "Has viewed", tone: "good" });
  else if (viewing.state === "requested") out.push({ icon: "calendar-outline", text: "Viewing requested", tone: "quiet" });
  else out.push({ icon: "eye-outline", text: "Not viewed yet", tone: "quiet" });
  return out;
}

/**
 * Whether the decision can be made from the list: the evidence that usually
 * decides it is already in. An application that meets the advance from someone
 * who has seen the place; or a direct request, whose holder the provider gave
 * the code to. Anything short of that is worth opening first, so its row offers
 * no Accept to tap past the gap.
 */
export function readyToDecide(item: RequestItem): boolean {
  if (phaseOf(item) !== "decide" || !canAct(item)) return false;
  if (item.kind === "private") return true;
  return item.application.meets_advance && item.viewing.state === "viewed";
}

export function searchText(item: RequestItem): string {
  return item.kind === "application"
    ? `${item.application.applicant_name} ${item.application.listing_headline} ${item.application.property_title} ${item.application.unit_label} ${item.application.locality_name ?? ""}`
    : `${item.request.requester_display} ${item.request.property_title} ${item.request.unit_label} ${item.request.bed_label ?? ""}`;
}

/* --- the queue ---------------------------------------------------------- */

export type Queue = {
  /** The provider's next steps, longest-waiting first. */
  yours: RequestItem[];
  /** Live, but somebody else's move, longest-waiting first. */
  theirs: RequestItem[];
  /** Done either way, newest first. */
  settled: RequestItem[];
  counts: Record<Exclude<Phase, "settled">, number>;
};

export function queue(items: readonly RequestItem[]): Queue {
  const byWait = (a: RequestItem, b: RequestItem) => waitingSince(a).localeCompare(waitingSince(b));
  const live = items.filter((item) => phaseOf(item) !== "settled");
  const counts = { decide: 0, agreement: 0, tenant: 0, moving: 0 };
  for (const item of live) counts[phaseOf(item) as keyof typeof counts] += 1;
  return {
    yours: live.filter(isYourMove).sort(byWait),
    theirs: live.filter((item) => !isYourMove(item)).sort(byWait),
    settled: items.filter((item) => phaseOf(item) === "settled").sort((a, b) => createdAt(b).localeCompare(createdAt(a))),
    counts,
  };
}

/** Arrived since the provider last looked. Never on a first visit: everything would be. */
export function isNew(item: RequestItem, seenBefore: string | null): boolean {
  return Boolean(seenBefore) && createdAt(item) > (seenBefore as string);
}
