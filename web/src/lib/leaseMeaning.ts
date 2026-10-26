/**
 * What an agreement is, and where it has got to.
 *
 * Split out of the leases page when the record it opens became a page of its
 * own. The list and the record both say what an agreement's state is, and two
 * copies of that would eventually disagree.
 *
 * The frozen agreement record is the truth where it exists: `lease.agreement`
 * holds the terms as both parties accepted them, and the fields on the lease
 * itself are what an older agreement — made before those records existed — has
 * instead. Every reader here prefers the frozen terms and falls back, so a
 * tenancy signed last year still renders.
 *
 * **Web-only, and deliberately not mirrored.** This is the provider's reading of
 * the lease vocabulary; `agreementMeaning.ts` is the mirrored module the phone
 * shares for the tenant's side.
 */

import type { Lease } from "@/lib/console";
import { formatMoney } from "@/lib/money";

/** Where an agreement has got to, which is also the order somebody works in. */
export type ProviderLeaseStage = "send" | "current" | "history";

export type LeaseFilter = "all" | ProviderLeaseStage;

export const LEASE_FILTERS: LeaseFilter[] = ["all", "send", "current", "history"];

export function leaseFilterLabel(filter: LeaseFilter) {
  return filter === "all"
    ? "All"
    : filter === "send"
      ? "To send"
      : filter === "current"
        ? "Current"
        : "History";
}

export function providerLeaseStage(lease: Lease): ProviderLeaseStage {
  return ["draft", "ready"].includes(lease.status)
    ? "send"
    : ["offered", "tenant_accepted", "awaiting_activation", "active"].includes(lease.status)
      ? "current"
      : "history";
}

export function providerLeaseStatus(lease: Lease) {
  return (
    {
      draft: "Ready to send",
      ready: "Ready to send",
      offered: "Waiting for tenant",
      tenant_accepted: "Confirm agreement",
      awaiting_activation: "Awaiting activation",
      active: "Active tenancy",
      declined: "Declined",
      cancelled: "Withdrawn",
      ended: "Ended",
    } as Record<Lease["status"], string>
  )[lease.status];
}

export function providerLeaseTone(lease: Lease) {
  return lease.status === "active"
    ? "good"
    : ["draft", "tenant_accepted"].includes(lease.status)
      ? "attention"
      : ["ready", "offered", "awaiting_activation"].includes(lease.status)
        ? "waiting"
        : "muted";
}

/**
 * The three counts across the top.
 *
 * An aggregate, the state that means a tenancy is actually running, and the one
 * thing the provider is waiting on somebody else for. `awaiting_activation` is
 * deliberately not folded into "Awaiting tenant": the tenant has already
 * accepted by then, and it would claim they had not.
 */
export function leaseTotals(leases: Lease[]) {
  return {
    total: leases.length,
    active: leases.filter((lease) => lease.status === "active").length,
    awaiting: leases.filter((lease) => lease.status === "offered").length,
  };
}

export function leaseTenant(lease: Lease) {
  return lease.agreement?.terms.parties.tenant.name ?? lease.tenant_name;
}

export function leasePlace(lease: Lease) {
  const terms = lease.agreement?.terms;
  const property = terms?.property.title ?? lease.property_title;
  const unit = terms?.space.unit_label ?? lease.unit_label;
  return `${property}${unit ? ` · ${unit}` : ""}`;
}

export function leaseSearchText(lease: Lease) {
  const terms = lease.agreement?.terms;
  return `${terms?.parties.tenant.name ?? lease.tenant_name} ${terms?.property.title ?? lease.property_title} ${terms?.space.unit_label ?? lease.unit_label} ${terms?.space.bed_label ?? lease.bed_label ?? ""}`;
}

export function providerLeaseRent(lease: Lease) {
  const money = lease.agreement?.terms.money;
  const amount = money
    ? formatMoney({ minor: money.rent_minor, currency: money.rent_currency })
    : (lease.rent_formatted ?? "Rent not recorded");
  const period =
    money?.rent_period === "yearly" || lease.rent_period === "yearly" ? "year" : "month";
  return `${amount} / ${period}`;
}

export function providerLeaseMoveIn(lease: Lease) {
  const money = lease.agreement?.terms.money;
  return money
    ? formatMoney({ minor: money.move_in_total_minor, currency: money.rent_currency })
    : (lease.move_in_total_formatted ?? "Not recorded");
}

/** When it starts, once that is settled; when it was drawn up, before then. */
export function providerLeaseDate(lease: Lease) {
  if (lease.status === "active" || lease.status === "awaiting_activation") {
    return `Starts ${formatLeaseDate(lease.agreement?.terms.term.starts_on ?? lease.starts_on)}`;
  }
  return formatLeaseDate(lease.created_at);
}

/**
 * Truncated to the date part, then read at midday.
 *
 * Some of these are dates (`starts_on`) and some are timestamps
 * (`created_at`, `tenant_accepted_at`). Taking the first ten characters treats
 * both as the day they name, and midday keeps that day the same one on either
 * side of a timezone.
 */
export function formatLeaseDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
