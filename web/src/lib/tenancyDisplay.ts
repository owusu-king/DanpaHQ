/**
 * How a tenancy reads, for the provider's Tenants cards and the tenancy modal.
 *
 * Split out of the Tenants page when the card started opening a modal: both say
 * where a tenancy stands and where its rent is, and two copies would drift.
 * Derived only from the record the Portfolio endpoint returns.
 */

import type { ProviderTenant } from "@/lib/console";
import { formatMoney } from "@/lib/money";

/** How close to its end a lease has to be before the card says so. */
export const ENDING_SOON_DAYS = 60;

export type TenancyState = { key: "active" | "ending" | "pending" | "upcoming" | "inactive"; label: string };

/** The tenancy's state as a manager would say it. */
export function tenancyState(tenant: ProviderTenant): TenancyState {
  if (tenant.ended_at || tenant.tenancy_status === "ended") return { key: "inactive", label: "Moved out" };
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return { key: "pending", label: "Pending agreement" };
  if (tenant.tenancy_status === "upcoming") return { key: "upcoming", label: "Upcoming" };
  if (tenant.lease_ends_on) {
    const ends = new Date(`${tenant.lease_ends_on}T00:00:00`).getTime();
    const days = (ends - Date.now()) / 86_400_000;
    if (days >= 0 && days <= ENDING_SOON_DAYS) return { key: "ending", label: "Lease ending soon" };
  }
  return { key: "active", label: "Active" };
}

/** Where the rent stands, in a few words: "Paid up", or what is owed and how. */
export function paymentHeadline(tenant: ProviderTenant) {
  if (tenant.rent.status === "current") return "Paid up";
  const amount = tenant.rent.status === "overdue" ? tenant.rent.overdue_minor : tenant.rent.outstanding_minor;
  const money = formatMoney({ minor: amount, currency: tenant.lease_rent_currency ?? "GHS" });
  return `${tenant.rent.status === "overdue" ? "Overdue" : "Outstanding"} · ${money}`;
}

/** The Unit, and the bed inside it when a bed is let. */
export function tenantHome(tenant: ProviderTenant) {
  return `${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`;
}

/**
 * How far through its term a lease is, for a timeline: the share elapsed and
 * the whole months left. Null without both dates.
 */
export function leaseProgress(tenant: ProviderTenant, now = Date.now()) {
  if (!tenant.lease_starts_on || !tenant.lease_ends_on) return null;
  const start = new Date(`${tenant.lease_starts_on}T00:00:00`).getTime();
  const end = new Date(`${tenant.lease_ends_on}T00:00:00`).getTime();
  if (!(end > start)) return null;
  const share = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const monthsLeft = Math.max(0, Math.round((end - now) / (86_400_000 * 30.44)));
  return { share, monthsLeft, started: now >= start, ended: now > end };
}

export function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** A date-only value, with the year only when it is not this one. */
export function shortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GH", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
