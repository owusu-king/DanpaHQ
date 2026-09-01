/**
 * The tenant's tenancies.
 *
 * Replaces the client-side stitching that produced the single-tenancy bug:
 * occupancies from one call, leases from another, charges from a third, joined
 * in the browser and then collapsed with `find(active) ?? [0] ?? null`. A
 * tenant renting two places saw one of them and could not reach the other.
 *
 * There is deliberately no `currentTenancy` here and no helper that picks one.
 * Choosing a tenancy is navigation — a route parameter — never ambient state
 * another screen can silently inherit. That inheritance is exactly how the bug
 * happened, and a `current…` helper would reintroduce it the first time
 * somebody reached for the convenient thing.
 */

import { authedFetch } from "./auth";

export type TenancyLease = {
  id: string;
  status: string;
  status_display: string;
  rent_formatted: string | null;
  rent_period: string;
  starts_on: string | null;
  ends_on: string | null;
};

export type TenancyRent = {
  outstanding_count: number;
  overdue_count: number;
  /** Everything unpaid on this tenancy, in minor units. Money is added in
   *  integers or not at all — a client cannot sum `amount_formatted`. */
  outstanding_minor: number;
  outstanding_currency: string;
  outstanding_formatted: string;
  next_due: {
    id: string;
    kind_display: string;
    due_on: string;
    amount_minor: number;
    amount_currency: string;
    amount_formatted: string | null;
    is_overdue: boolean;
  } | null;
};

/** Upcoming is agreed but not yet begun — see `apps/tenancy/models.py`. */
export type TenancyStatus = "pending_lease" | "upcoming" | "active" | "ended";

export type Tenancy = {
  id: string;
  /** Null while a tenancy has no live allocation — agreed, nobody moved in yet. */
  occupancy_id: string | null;
  status: TenancyStatus;
  status_display: string;
  starts_on: string | null;
  ends_on: string | null;
  property: { id: string; title: string; locality: string; district: string };
  space: {
    unit_id: string;
    unit_label: string;
    space_type_label: string;
    bed_id: string | null;
    bed_label: string | null;
  };
  /** The Unit's own primary photograph, when it has one. */
  photo_url: string | null;
  lease: TenancyLease | null;
  rent: TenancyRent | null;
};

export function listMyTenancies(includeEnded = false) {
  return authedFetch<Tenancy[]>(`/me/tenancies/${includeEnded ? "?include_ended=1" : ""}`);
}

/** One tenancy by id, from a list already loaded. Route-driven, never implicit. */
export function findTenancy(tenancies: Tenancy[], id: string): Tenancy | null {
  return tenancies.find((row) => row.id === id) ?? null;
}

/** Where a tenancy is: "Adenta Flat · Main" or with the bed for a hostel. */
export function tenancyLabel(tenancy: Tenancy): string {
  const parts = [tenancy.space.unit_label];
  if (tenancy.space.bed_label) parts.push(tenancy.space.bed_label);
  return parts.filter(Boolean).join(" · ");
}

/** When it runs, phrased for whether it has begun.
 *
 * P8 made `upcoming` reachable: a tenancy agreed in July to start in September
 * is a real arrangement in August, and describing it as having started "since
 * 1 September" would be wrong on the tenant's own screen.
 */
export function tenancyTiming(tenancy: Tenancy, formatDate: (d: string) => string): string {
  if (!tenancy.starts_on) return "";
  return tenancy.status === "upcoming"
    ? `from ${formatDate(tenancy.starts_on)}`
    : `since ${formatDate(tenancy.starts_on)}`;
}


/**
 * Whether anything on this tenancy wants the person's attention today.
 *
 * Only overdue money qualifies. A future charge is not attention — it is a
 * calendar entry — and marking it as such would make the signal worthless on
 * the portfolio view where several tenancies compete for it.
 */
export function needsAttention(tenancy: Tenancy): boolean {
  return (tenancy.rent?.overdue_count ?? 0) > 0;
}
