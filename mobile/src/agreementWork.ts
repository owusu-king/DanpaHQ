/**
 * What a granted agreement asks of the provider today (owner, 2026-10-06).
 *
 * The Agreements page filed each agreement under "to send", "current" or
 * "history" and let a Filter sheet pick one. A landlord opens it to know three
 * things: is anything waiting on me, how far along are the ones in flight, and
 * which running tenancies are coming to an end. So each agreement resolves to
 * one lane, a position in the four steps every agreement walks, and — once it is
 * running — how far through its term it is.
 *
 * Every date here is one the agreement carries; nothing is projected.
 */

import type { Lease } from "@/leases";

export type Lane = "yours" | "signing" | "ending" | "running" | "closed";

/** Ending within this many days is a decision to plan for, not a date to note. */
export const ENDING_DAYS = 60;

/** The four steps every agreement walks, in order. */
export const SIGNING_STEPS = ["Drafted", "Sent", "Accepted", "Active"] as const;

const DAY = 86_400_000;

/** The agreed terms where the agreement was recorded, the lease's own fields otherwise. */
function term(lease: Lease) {
  const terms = lease.agreement?.terms;
  return {
    startsOn: terms?.term.starts_on ?? lease.starts_on,
    endsOn: terms?.term.ends_on ?? lease.ends_on,
    termMonths: terms?.term.term_months ?? lease.term_months,
  };
}

function atNoon(date: string): number {
  return new Date(`${date.slice(0, 10)}T12:00:00`).getTime();
}

export function daysUntilEnd(lease: Lease, now = Date.now()): number | null {
  const { endsOn } = term(lease);
  return endsOn ? Math.ceil((atNoon(endsOn) - now) / DAY) : null;
}

export function laneOf(lease: Lease, now = Date.now()): Lane {
  if (lease.status === "draft" || lease.status === "ready" || lease.status === "tenant_accepted") return "yours";
  if (lease.status === "offered" || lease.status === "awaiting_activation") return "signing";
  if (lease.status === "active") {
    const left = daysUntilEnd(lease, now);
    return left !== null && left <= ENDING_DAYS ? "ending" : "running";
  }
  return "closed";
}

/** How many of the four steps are done. */
export function stepsDone(lease: Pick<Lease, "status">): number {
  switch (lease.status) {
    case "draft":
    case "ready":
      return 1;
    case "offered":
      return 2;
    case "tenant_accepted":
    case "awaiting_activation":
      return 3;
    case "active":
    case "ended":
      return 4;
    default:
      return 0;
  }
}

/** The one thing to do, where it is the provider's. Both happen on the agreement. */
export function nextAct(lease: Pick<Lease, "status">): { label: "Send agreement" | "Confirm move-in"; icon: "send-outline" | "checkmark-done-outline" } | null {
  if (lease.status === "draft" || lease.status === "ready") return { label: "Send agreement", icon: "send-outline" };
  if (lease.status === "tenant_accepted") return { label: "Confirm move-in", icon: "checkmark-done-outline" };
  return null;
}

/** Where it stands, said as the next thing that happens. */
export function signingLine(lease: Pick<Lease, "status" | "activation_requirement">): string {
  switch (lease.status) {
    case "draft":
      return "Draft — not sent yet";
    case "ready":
      return "Ready — not sent yet";
    case "offered":
      return "Sent — tenant is reviewing";
    case "tenant_accepted":
      return "Tenant accepted — confirm to start";
    case "awaiting_activation":
      return lease.activation_requirement === "initial_payment" ? "Accepted — waiting for the first payment" : "Accepted — waiting to activate";
    case "active":
      return "Running";
    case "declined":
      return "Tenant declined";
    case "cancelled":
      return "Withdrawn";
    case "ended":
      return "Ended";
    default:
      return "Closed";
  }
}

/**
 * How far through its term a running agreement is: the share elapsed, and which
 * month of how many. Null where the agreement carries no end.
 */
export function termProgress(lease: Lease, now = Date.now()): { share: number; month: number; months: number } | null {
  const { startsOn, endsOn, termMonths } = term(lease);
  if (!startsOn || !endsOn) return null;
  const start = atNoon(startsOn);
  const end = atNoon(endsOn);
  if (end <= start) return null;
  const share = Math.max(0, Math.min(1, (now - start) / (end - start)));
  const months = termMonths || Math.max(1, Math.round((end - start) / (30.44 * DAY)));
  return { share, month: Math.min(months, Math.max(1, Math.ceil(share * months))), months };
}

/** Rent per month, so yearly and monthly agreements add up to one figure. */
export function monthlyRentMinor(lease: Lease): { minor: number; currency: string } {
  const money = lease.agreement?.terms.money;
  const minor = money?.rent_minor ?? lease.rent_minor;
  const period = money?.rent_period ?? lease.rent_period;
  return { minor: period === "yearly" ? Math.round(minor / 12) : minor, currency: money?.rent_currency ?? lease.rent_currency };
}

export type AgreementWork = {
  yours: Lease[];
  signing: Lease[];
  ending: Lease[];
  running: Lease[];
  closed: Lease[];
  /** The monthly rent the running agreements bring in, by currency (Ghana: one). */
  rentRoll: { minor: number; currency: string } | null;
};

export function agreementWork(leases: readonly Lease[], now = Date.now()): AgreementWork {
  const lanes: Record<Lane, Lease[]> = { yours: [], signing: [], ending: [], running: [], closed: [] };
  for (const lease of leases) lanes[laneOf(lease, now)].push(lease);
  // Oldest first where somebody is waiting; soonest end first where a term is running out.
  const byCreated = (a: Lease, b: Lease) => a.created_at.localeCompare(b.created_at);
  lanes.yours.sort(byCreated);
  lanes.signing.sort(byCreated);
  lanes.ending.sort((a, b) => (daysUntilEnd(a, now) ?? 0) - (daysUntilEnd(b, now) ?? 0));
  lanes.running.sort((a, b) => (daysUntilEnd(a, now) ?? Infinity) - (daysUntilEnd(b, now) ?? Infinity));
  lanes.closed.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const live = [...lanes.ending, ...lanes.running];
  const rentRoll = live.length
    ? live.reduce<{ minor: number; currency: string }>((sum, lease) => {
      const rent = monthlyRentMinor(lease);
      return { minor: sum.minor + rent.minor, currency: rent.currency };
    }, { minor: 0, currency: "GHS" })
    : null;
  return { ...lanes, rentRoll };
}
