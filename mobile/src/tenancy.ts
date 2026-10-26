import { apiFetch } from "@/api";

/**
 * The tenant's tenancies.
 *
 * Mirrors `web/src/lib/tenancy.ts` against the same endpoint, deliberately:
 * the home screen collapsed a list of occupancies to one with
 * `find(active) ?? [0] ?? null`, so a tenant renting two places saw one of them
 * and had no way to reach the other. Both clients had the same bug because
 * both did the same stitching.
 *
 * There is no `currentTenancy` here and no helper that picks one. Choosing a
 * tenancy is navigation — a route parameter — not ambient state a later screen
 * inherits.
 */

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
  /**
   * Everything still open on this tenancy, as integer minor units.
   *
   * Carried so a screen showing several tenancies can add them up without
   * parsing "GH₵1,500.00" back into a number. Money is summed as integers or
   * not at all — see ADR 0006.
   */
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
  return apiFetch<Tenancy[]>(`/me/tenancies/${includeEnded ? "?include_ended=1" : ""}`);
}

/** Where a tenancy is: the unit, plus the bed when it is a hostel. */
export function tenancyLabel(tenancy: Tenancy): string {
  return [tenancy.space.unit_label, tenancy.space.bed_label]
    .filter(Boolean)
    .join(" · ");
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
 * Whether this tenancy wants attention today.
 *
 * Only overdue money counts. A future charge is a calendar entry, and treating
 * it as attention makes the signal useless once several homes compete for it.
 */
export function needsAttention(tenancy: Tenancy): boolean {
  return (tenancy.rent?.overdue_count ?? 0) > 0;
}

/** An access request this person sent, as they read it. */
export type MyJoinRequest = {
  id: string;
  property_id: string;
  property_title: string;
  locality_name: string | null;
  unit_id: string;
  unit_label: string | null;
  bed_label: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  status_display: string;
  decision_note: string;
  decided_at: string | null;
  lease_id: string | null;
  lease_status: string | null;
  created_at: string;
};

/**
 * The access requests this person sent.
 *
 * Until now the only read was provider-scoped, so somebody who quoted an access
 * code got a success message and then silence: an approval eventually surfaced
 * as a lease offer, and a rejection surfaced as nothing at all.
 */
export function listMyJoinRequests() {
  return apiFetch<MyJoinRequest[]>("/me/join-requests/");
}
