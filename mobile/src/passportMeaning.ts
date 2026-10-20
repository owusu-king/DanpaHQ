/**
 * The words both readers of a Housing Passport see.
 *
 * The twin of the words section of `web/src/lib/passport.ts`, without
 * `shareUrl` (each client builds its link from its own origin). A mirror test
 * keeps the two identical from the `--- words` rule down, so a status never
 * reads one way on the phone and another on the laptop.
 */

import type {
  CorrectionRecordType,
  PassportCorrection,
  PassportShare,
  PassportStatus,
  PassportTenancy,
} from "@/passport";

// --- words ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<PassportStatus, string> = {
  verified: "Verified",
  confirmed: "Confirmed",
  pending: "Pending",
  disputed: "Disputed",
  unverified: "Not verified",
  expired: "Expired",
  none: "Nothing recorded",
};

/** How each status is earned, for the legend both readers see. */
export const STATUS_MEANING: { status: PassportStatus; meaning: string }[] = [
  { status: "verified", meaning: "Checked by Danpa HQ or a payment provider" },
  { status: "confirmed", meaning: "Agreed by both the tenant and the provider" },
  { status: "pending", meaning: "Waiting for the other party or a review" },
  { status: "disputed", meaning: "Questioned, and being looked into" },
  { status: "unverified", meaning: "Recorded, but not checked" },
];

export const NOT_RECORDED_LABEL: Record<string, string> = {
  inspections: "inspections",
  references: "landlord references",
};

/** "1 yr 7 mos", "7 months", "Under a month". */
export function duration(months: number): string {
  if (months <= 0) return "Under a month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest} month${rest === 1 ? "" : "s"}`;
  const head = `${years} yr${years === 1 ? "" : "s"}`;
  return rest ? `${head} ${rest} mo${rest === 1 ? "" : "s"}` : head;
}

const iso = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00` : value);

export function monthYear(value: string | null | undefined): string {
  if (!value) return "";
  return iso(value).toLocaleDateString("en-GH", { month: "short", year: "numeric" });
}

export function dayMonthYear(value: string | null | undefined): string {
  if (!value) return "";
  return iso(value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

export function period(from: string | null, to: string | null, ongoing: boolean): string {
  if (!from) return "";
  const end = ongoing || !to ? "present" : monthYear(to);
  return `${monthYear(from)} – ${end}`;
}

export function tenancyPeriod(tenancy: PassportTenancy): string {
  if (tenancy.status === "pending_lease") return "Awaiting an agreement";
  if (tenancy.status === "upcoming") return tenancy.started_on ? `Starts ${dayMonthYear(tenancy.started_on)}` : "Starting soon";
  return period(tenancy.started_on, tenancy.ended_on, tenancy.status === "active");
}

export function tenancyStanding(tenancy: PassportTenancy): string {
  return { active: "Current home", upcoming: "Upcoming", ended: "Past home", pending_lease: "Not yet agreed" }[tenancy.status];
}

export function placeLine(tenancy: PassportTenancy): string {
  return [tenancy.place.locality, tenancy.place.district].filter(Boolean).join(", ");
}

/** "Expires in 6 days", "Expires today", "Expired 3 Oct", "Withdrawn 2 Oct". */
export function shareLifeLine(share: PassportShare, now = Date.now()): string {
  if (share.state === "revoked" && share.revoked_at) return `Withdrawn ${dayMonthYear(share.revoked_at)}`;
  const ends = new Date(share.expires_at).getTime();
  if (share.state === "expired" || ends <= now) return `Expired ${dayMonthYear(share.expires_at)}`;
  const hours = Math.ceil((ends - now) / 3_600_000);
  if (hours <= 24) return hours <= 1 ? "Expires within the hour" : `Expires in ${hours} hours`;
  const days = Math.ceil(hours / 24);
  return `Expires in ${days} days`;
}

export function viewsLine(share: PassportShare): string {
  if (!share.view_count) return "Not opened yet";
  return `Opened ${share.view_count} time${share.view_count === 1 ? "" : "s"}`;
}

/** What a link carries, in a few words. */
export function scopeLine(scope: PassportShare["scope"]): string {
  const parts: string[] = [];
  if (scope.identity) parts.push("Identity");
  const count = scope.tenancy_ids.length;
  if (count) parts.push(`${count} tenanc${count === 1 ? "y" : "ies"}`);
  if (count && scope.payments) parts.push(scope.amounts ? "rent with amounts" : "rent record");
  return parts.join(" · ");
}

/** The record's correction, if it has one. */
export function correctionFor(
  corrections: PassportCorrection[],
  recordType: CorrectionRecordType,
  recordId = "",
): PassportCorrection | null {
  return corrections.find((row) => row.record_type === recordType && row.record_id === recordId) ?? null;
}
