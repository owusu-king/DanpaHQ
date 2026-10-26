/**
 * What an agreement is to the provider who granted it, and where it has got to.
 *
 * The phone's reading of the provider half of web's `leaseMeaning.ts`: not a
 * mirror, because web formats money its own way, but the same stages, so the
 * two lists agree about the same record — and one place on the phone for the
 * words the Leases list and the agreement screen both say. The list had fallen
 * behind the canonical workflow: `ready` and `tenant_accepted` dropped into
 * History with no label at all.
 */

import type { Lease } from "@/leases";
import { formatMinor } from "@/listings";

/** Where an agreement has got to, which is also the order somebody works in. */
export type ProviderLeaseStage = "send" | "current" | "history";

/** Running; waiting on the provider; waiting on somebody else; or closed. */
export type ProviderLeaseTone = "good" | "attention" | "waiting" | "muted";

export function providerLeaseStage(lease: Pick<Lease, "status">): ProviderLeaseStage {
  return ["draft", "ready"].includes(lease.status)
    ? "send"
    : ["offered", "tenant_accepted", "awaiting_activation", "active"].includes(lease.status)
      ? "current"
      : "history";
}

export function providerLeaseStatus(lease: Pick<Lease, "status">): string {
  return (
    {
      draft: "Draft",
      ready: "Ready to send",
      offered: "Waiting for tenant",
      tenant_accepted: "Confirmation needed",
      awaiting_activation: "Awaiting activation",
      active: "Active tenancy",
      declined: "Declined",
      cancelled: "Withdrawn",
      ended: "Ended",
    } as Record<Lease["status"], string>
  )[lease.status];
}

export function providerLeaseTone(lease: Pick<Lease, "status">): ProviderLeaseTone {
  return lease.status === "active"
    ? "good"
    : ["draft", "tenant_accepted"].includes(lease.status)
      ? "attention"
      : ["ready", "offered", "awaiting_activation"].includes(lease.status)
        ? "waiting"
        : "muted";
}

/** The counterparty, from the frozen agreement where there is one. */
export function providerLeaseTenant(lease: Lease): string {
  return lease.agreement?.terms.parties.tenant.name ?? lease.tenant_name;
}

/** The exact space — Property, Unit and bed — from the frozen agreement where there is one. */
export function providerLeasePlace(lease: Lease): string[] {
  const terms = lease.agreement?.terms;
  return [
    terms?.property.title ?? lease.property_title,
    terms?.space.unit_label ?? lease.unit_label,
    terms?.space.bed_label ?? lease.bed_label,
  ].filter((part): part is string => Boolean(part));
}

/** The rent as agreed, or null for an older record that never held one. */
export function providerLeaseRent(lease: Lease): string | null {
  const money = lease.agreement?.terms.money;
  return money ? formatMinor(money.rent_minor, money.rent_currency) : lease.rent_formatted;
}

export function providerLeasePeriod(lease: Lease): "month" | "year" {
  const money = lease.agreement?.terms.money;
  return (money ? money.rent_period : lease.rent_period) === "yearly" ? "year" : "month";
}

/**
 * The one date worth a row: when it starts while that is still ahead, when it
 * ends while it runs, and when it was prepared before it is sent or once it has
 * closed.
 */
export function providerLeaseWhen(lease: Lease): string {
  const term = lease.agreement?.terms.term;
  const startsOn = term?.starts_on ?? lease.starts_on;
  const endsOn = term?.ends_on ?? lease.ends_on;
  if (["offered", "tenant_accepted", "awaiting_activation"].includes(lease.status)) {
    return startsOn ? `Starts ${formatLeaseDate(startsOn)}` : "No start date yet";
  }
  if (lease.status === "active") {
    return endsOn ? `Ends ${formatLeaseDate(endsOn)}` : `Since ${formatLeaseDate(startsOn)}`;
  }
  return `Prepared ${formatLeaseDate(lease.created_at)}`;
}

export function leaseSearchText(lease: Lease): string {
  const terms = lease.agreement?.terms;
  return `${terms?.parties.tenant.name ?? lease.tenant_name} ${terms?.property.title ?? lease.property_title} ${terms?.space.unit_label ?? lease.unit_label} ${terms?.space.bed_label ?? lease.bed_label ?? ""}`;
}

/**
 * Truncated to the date part, then read at midday. Some of these are dates and
 * some timestamps; the first ten characters name the day either way, and midday
 * keeps it the same day on either side of a time zone.
 */
export function formatLeaseDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
