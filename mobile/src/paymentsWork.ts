/**
 * A Portfolio's money, read as work (owner, 2026-10-06).
 *
 * Payments was four lists — rent due, records, payouts, expenses — behind one
 * Filter sheet. A landlord opens it to know how this month's rent is coming
 * in, who is behind, which tenant claims they must confirm, and what money is
 * still on its way to them. So the page is this month first, then what needs
 * them, then what is in flight, and the history folds away.
 *
 * Tenant payment and provider settlement stay different facts: money awaiting
 * settlement is never counted as money that arrived.
 */

import type { PortfolioSummary } from "@/organizations";

type Tenant = PortfolioSummary["tenants"][number];
type Payment = PortfolioSummary["recent_payments"][number];
type Settlement = PortfolioSummary["recent_settlements"][number];

/**
 * This month's rent: what was received, and what is still outstanding against
 * charges due this month. Outstanding is a current balance by due month, not a
 * reconstruction — the card says "still outstanding" for that reason.
 */
export function thisMonth(summary: Pick<PortfolioSummary, "rent_collection">, now = new Date()): {
  label: string;
  collected: number;
  outstanding: number;
  share: number;
} | null {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const row = summary.rent_collection.monthly.find((entry) => entry.period === key);
  if (!row) return null;
  const total = row.collected_minor + row.outstanding_minor;
  return {
    label: now.toLocaleDateString("en-GH", { month: "long" }),
    collected: row.collected_minor,
    outstanding: row.outstanding_minor,
    share: total > 0 ? row.collected_minor / total : 0,
  };
}

export type MoneyWork = {
  overdue: Tenant[];
  due: Tenant[];
  toReview: Payment[];
  recent: Payment[];
  /** Paid by a tenant, not yet settled to the provider. */
  onTheWay: Settlement[];
  /** A payout that failed or was reversed: not settled until reconciled. */
  attention: Settlement[];
  paidOut: Settlement[];
};

export function moneyWork(summary: Pick<PortfolioSummary, "tenants" | "recent_payments" | "recent_settlements">): MoneyWork {
  const payout = (settlement: Settlement) => settlement.status === "settled" ? "paid" : settlement.status === "failed" || settlement.status === "reversed" ? "attention" : "way";
  return {
    overdue: summary.tenants.filter((tenant) => tenant.rent.status === "overdue").sort((a, b) => b.rent.overdue_minor - a.rent.overdue_minor),
    due: summary.tenants.filter((tenant) => tenant.rent.status === "outstanding").sort((a, b) => (a.rent.next_due_on ?? "9999").localeCompare(b.rent.next_due_on ?? "9999")),
    toReview: summary.recent_payments.filter((payment) => payment.awaiting_you),
    recent: summary.recent_payments.filter((payment) => !payment.awaiting_you).sort((a, b) => b.paid_on.localeCompare(a.paid_on)),
    onTheWay: summary.recent_settlements.filter((row) => payout(row) === "way"),
    attention: summary.recent_settlements.filter((row) => payout(row) === "attention"),
    paidOut: summary.recent_settlements.filter((row) => payout(row) === "paid").sort((a, b) => (b.settled_at ?? "").localeCompare(a.settled_at ?? "")),
  };
}

/** How a recorded payment stands, in the record's own words. */
export function paymentStatus(payment: Pick<Payment, "evidence" | "awaiting_you" | "status">): string {
  if (payment.evidence === "PSP_CONFIRMED") return "Processor confirmed";
  if (payment.awaiting_you) return "Review needed";
  if (payment.status === "confirmed") return "Confirmed by both";
  if (payment.status === "disputed") return "Disputed";
  return "Waiting for tenant";
}
