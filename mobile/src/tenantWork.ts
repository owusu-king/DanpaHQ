/**
 * A Portfolio's tenancies, read as the people living in its homes (owner,
 * 2026-10-06).
 *
 * The Tenants tab was a list of relationships behind a Filter sheet of statuses
 * and a second "view" for private access. A landlord opens it to know who is
 * behind on rent, whose paperwork is unfinished, who is about to move in or out
 * — and, for everyone else, who lives where. So each tenancy resolves to one
 * lane, and the settled ones are grouped by the Property they live in.
 */

import type { PortfolioSummary } from "@/organizations";

export type Tenant = PortfolioSummary["tenants"][number];
export type TenantLane = "overdue" | "paperwork" | "due" | "moving_in" | "ending" | "settled";

/** Ending within this many days is a renewal to plan, as on Agreements. */
export const ENDING_DAYS = 60;

const DAY = 86_400_000;

function daysUntil(date: string | null, now: number): number | null {
  if (!date) return null;
  return Math.ceil((new Date(`${date.slice(0, 10)}T12:00:00`).getTime() - now) / DAY);
}

export function laneOf(tenant: Tenant, now = Date.now()): TenantLane {
  if (tenant.rent.status === "overdue") return "overdue";
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return "paperwork";
  if (tenant.rent.status === "outstanding") return "due";
  if (tenant.tenancy_status === "upcoming") return "moving_in";
  const left = daysUntil(tenant.lease_ends_on, now);
  if (tenant.tenancy_status === "active" && left !== null && left <= ENDING_DAYS) return "ending";
  return "settled";
}

/** The three lanes that wait on the landlord, in the order they cost money. */
export const NEEDS_YOU: readonly TenantLane[] = ["overdue", "paperwork", "due"];

export function endsIn(tenant: Tenant, now = Date.now()): number | null {
  return daysUntil(tenant.lease_ends_on, now);
}

export function startsIn(tenant: Tenant, now = Date.now()): number | null {
  return daysUntil(tenant.lease_starts_on, now);
}

/** How far through its agreement a tenancy is, 0 to 1; null without both dates. */
export function termShare(tenant: Tenant, now = Date.now()): number | null {
  if (!tenant.lease_starts_on || !tenant.lease_ends_on) return null;
  const start = new Date(`${tenant.lease_starts_on.slice(0, 10)}T12:00:00`).getTime();
  const end = new Date(`${tenant.lease_ends_on.slice(0, 10)}T12:00:00`).getTime();
  return end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : null;
}

/** Rent per month, so a yearly tenancy reads on the same scale as a monthly one. */
export function monthlyRent(tenant: Tenant): number | null {
  if (tenant.lease_rent_minor === null) return null;
  return tenant.lease_rent_period === "yearly" ? Math.round(tenant.lease_rent_minor / 12) : tenant.lease_rent_minor;
}

export type TenantWork = {
  needsYou: Tenant[];
  movingIn: Tenant[];
  ending: Tenant[];
  /** Everyone settled, by the Property they live in, Properties A to Z. */
  byProperty: { property: string; tenants: Tenant[] }[];
  overdueMinor: number;
  count: Record<TenantLane, number>;
};

export function tenantWork(tenants: readonly Tenant[], now = Date.now()): TenantWork {
  const count = { overdue: 0, paperwork: 0, due: 0, moving_in: 0, ending: 0, settled: 0 } as Record<TenantLane, number>;
  const lanes = new Map<TenantLane, Tenant[]>();
  for (const tenant of tenants) {
    const lane = laneOf(tenant, now);
    count[lane] += 1;
    lanes.set(lane, [...(lanes.get(lane) ?? []), tenant]);
  }
  const get = (lane: TenantLane) => lanes.get(lane) ?? [];
  const byName = (a: Tenant, b: Tenant) => a.name.localeCompare(b.name, "en-GH");
  const needsYou = [
    ...get("overdue").sort((a, b) => b.rent.overdue_minor - a.rent.overdue_minor),
    ...get("paperwork").sort(byName),
    ...get("due").sort((a, b) => (a.rent.next_due_on ?? "9999").localeCompare(b.rent.next_due_on ?? "9999")),
  ];
  const groups = new Map<string, Tenant[]>();
  for (const tenant of get("settled")) groups.set(tenant.property_title, [...(groups.get(tenant.property_title) ?? []), tenant]);
  return {
    needsYou,
    movingIn: get("moving_in").sort((a, b) => (a.lease_starts_on ?? "").localeCompare(b.lease_starts_on ?? "")),
    ending: get("ending").sort((a, b) => (a.lease_ends_on ?? "").localeCompare(b.lease_ends_on ?? "")),
    byProperty: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "en-GH"))
      .map(([property, list]) => ({ property, tenants: list.sort((a, b) => a.unit_label.localeCompare(b.unit_label, "en-GH", { numeric: true })) })),
    overdueMinor: get("overdue").reduce((sum, tenant) => sum + tenant.rent.overdue_minor, 0),
    count,
  };
}
