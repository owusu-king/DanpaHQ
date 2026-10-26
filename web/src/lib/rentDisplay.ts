/**
 * How a rent position reads.
 *
 * Split out of the payments page when the rent account stopped being a modal
 * and became a page of its own: the list and the record it opens both say what
 * a payment's state is, and two copies of that sentence would eventually
 * disagree about what "confirmed" means.
 *
 * Nothing here decides anything. The server owns `status`, `awaiting_you` and
 * `verification_source`; these only choose the words.
 */

import type { OrganizationPortfolio, ProviderTenant } from "@/lib/console";
import type { RentPayment } from "@/lib/tenant";

export type RecentPayment = OrganizationPortfolio["recent_payments"][number];

/** Overdue first, then merely outstanding — the order somebody works in. */
export function rentPriority(tenant: ProviderTenant) {
  return tenant.rent.status === "overdue" ? 0 : tenant.rent.status === "outstanding" ? 1 : 2;
}

export function rentStatus(tenant: ProviderTenant) {
  return tenant.rent.status === "overdue"
    ? "Overdue"
    : tenant.rent.status === "outstanding"
      ? "Payment due"
      : "Current";
}

/**
 * A record in the Portfolio's recent list.
 *
 * "Waiting for tenant" and "Review needed" are the same fact seen from two
 * sides, and which one it is decides whether the provider has anything to do.
 */
export function recentPaymentStatus(payment: RecentPayment) {
  return payment.evidence === "PSP_CONFIRMED"
    ? "Processor confirmed"
    : payment.awaiting_you
      ? "Review needed"
      : payment.status === "confirmed"
        ? "Confirmed by both"
        : payment.status === "disputed"
          ? "Disputed"
          : "Waiting for tenant";
}

/**
 * The same record inside a rent account, where who recorded it is known — so
 * "waiting" can name the side it is waiting on.
 */
export function paymentStatus(payment: RentPayment) {
  return payment.evidence === "PSP_CONFIRMED"
    ? "Processor confirmed"
    : payment.awaiting_you
      ? "Review needed"
      : payment.status === "confirmed"
        ? "Confirmed by both"
        : payment.status === "disputed"
          ? "Disputed"
          : payment.recorded_by_tenant
            ? "Waiting for provider"
            : "Waiting for tenant";
}

/** Midday, so a date-only value cannot slip a day across a timezone. */
export function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
