/**
 * The tenant's agreements, read as their home rather than as records (owner,
 * 2026-10-06).
 *
 * `agreementMeaning` decides the standing and which copy of the terms is
 * authoritative, and is mirrored with web; this only arranges what it decides:
 * an agreement to decide, the home in place and how far through its term it
 * is, and the agreements between "accepted" and "in place" with the steps they
 * still have to walk.
 */

import type { AgreedTerms } from "@/agreementMeaning";

export type TenantLane = "decide" | "finalising" | "home" | "past";

export function laneOf(lease: { status: string }): TenantLane {
  if (lease.status === "offered") return "decide";
  if (lease.status === "tenant_accepted" || lease.status === "awaiting_activation") return "finalising";
  if (lease.status === "active") return "home";
  return "past";
}

/** The four steps an agreement walks from the tenant's side. */
export const TENANT_STEPS = ["Offered", "You accepted", "Landlord confirmed", "In place"] as const;

export function stepsDone(lease: { status: string }): number {
  switch (lease.status) {
    case "offered":
      return 1;
    case "tenant_accepted":
      return 2;
    case "awaiting_activation":
      return 3;
    case "active":
    case "ended":
      return 4;
    default:
      return 0;
  }
}

/** How far through its term an agreement in place is, and which month of how many. */
export function termOf(terms: Pick<AgreedTerms, "startsOn" | "endsOn" | "termMonths">, now = Date.now()): { share: number; month: number; months: number; daysLeft: number } | null {
  if (!terms.startsOn || !terms.endsOn) return null;
  const start = new Date(`${terms.startsOn.slice(0, 10)}T12:00:00`).getTime();
  const end = new Date(`${terms.endsOn.slice(0, 10)}T12:00:00`).getTime();
  if (end <= start) return null;
  const share = Math.max(0, Math.min(1, (now - start) / (end - start)));
  const months = terms.termMonths || Math.max(1, Math.round((end - start) / (30.44 * 86_400_000)));
  return { share, month: Math.min(months, Math.max(1, Math.ceil(share * months))), months, daysLeft: Math.ceil((end - now) / 86_400_000) };
}
