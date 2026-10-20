/**
 * Housing Passport: the tenant's record, the links they share it by, and the
 * words both readers see.
 *
 * Every status here is decided by the backend (`apps.passport.record`) from
 * the record that owns the fact. This file only names those statuses and
 * formats dates and durations; it never upgrades one, and it never turns an
 * absence into a judgement.
 */

import { apiFetch } from "@/lib/api";

export type PassportStatus =
  | "verified"
  | "confirmed"
  | "pending"
  | "disputed"
  | "unverified"
  | "expired"
  | "none";

export type PassportReview = { since: string; note: string } | null;

export type IdentityCredential = {
  key: "identity" | "selfie_match" | "phone" | "email";
  title: string;
  detail: string;
  status: PassportStatus;
  basis: string;
  as_of: string | null;
  valid_until: string | null;
};

export type PassportPayments = {
  status: PassportStatus;
  status_before_review?: PassportStatus;
  basis: string;
  confirmed: number;
  provider_confirmed: number;
  on_time: number;
  late: number;
  overdue: number;
  awaiting: number;
  disputed: number;
  first_paid_on: string | null;
  last_paid_on: string | null;
  total_formatted: string | null;
  review: PassportReview;
};

export type PassportTenancy = {
  id: string;
  place: { title: string; space: string; space_type: string; locality: string; district: string };
  status: "pending_lease" | "upcoming" | "active" | "ended";
  started_on: string | null;
  ended_on: string | null;
  agreed_until: string | null;
  months: number;
  agreements: number;
  credential: { status: PassportStatus; status_before_review?: PassportStatus; basis: string; as_of: string | null };
  review: PassportReview;
  property: { verified: boolean; as_of: string | null };
  rent: { formatted: string; period: string } | null;
  payments: PassportPayments | null;
};

export type TimelineEvent = {
  on: string;
  kind: "joined" | "identity" | "agreement" | "moved_in" | "upcoming" | "ended";
  title: string;
  detail: string;
  tenancy_id?: string;
};

export type PassportView = {
  holder: { name: string; initials: string; member_since: string };
  sections: { identity: boolean; tenancies: number; payments: boolean; amounts: boolean };
  summary: {
    tenancies: number;
    current: number;
    months: number;
    period: { from: string | null; to: string | null; ongoing: boolean };
    payments_confirmed: number | null;
    payments_on_time: number | null;
    payments_late: number | null;
  };
  identity: { credentials: IdentityCredential[]; review: PassportReview } | null;
  tenancies: PassportTenancy[];
  timeline: TimelineEvent[];
  not_recorded: string[];
};

export type CorrectionRecordType = "identity" | "tenancy" | "payments";

export type PassportCorrection = {
  id: string;
  record_type: CorrectionRecordType;
  record_id: string;
  state: "under_review" | "resolved" | "closed";
  reported_on: string;
  closed_on: string | null;
  reason: string;
  support_case_id: string | null;
};

export type MyPassport = PassportView & { corrections: PassportCorrection[] };

export type SharedPassport = PassportView & {
  share: { recipient_label: string; issued_at: string; expires_at: string };
};

export type PassportScope = {
  include_identity: boolean;
  tenancy_ids: string[];
  include_payments: boolean;
  include_amounts: boolean;
};

export type PassportShare = {
  id: string;
  recipient_label: string;
  state: "active" | "expired" | "revoked";
  /** Present only while the link works. */
  token: string | null;
  scope: { identity: boolean; tenancy_ids: string[]; payments: boolean; amounts: boolean };
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
};

export const SHARE_LIFETIMES = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

export type ShareLifetime = (typeof SHARE_LIFETIMES)[number]["days"];

// --- API --------------------------------------------------------------------------

export const getMyPassport = () => apiFetch<MyPassport>("/me/passport/");

export const previewPassport = (scope: PassportScope) =>
  apiFetch<PassportView>("/me/passport/preview/", { method: "POST", body: JSON.stringify(scope) });

export const listPassportShares = () => apiFetch<PassportShare[]>("/me/passport/shares/");

export const createPassportShare = (input: PassportScope & { recipient_label: string; expires_in_days: ShareLifetime }) =>
  apiFetch<PassportShare>("/me/passport/shares/", { method: "POST", body: JSON.stringify(input) });

export const revokePassportShare = (id: string) =>
  apiFetch<PassportShare>(`/me/passport/shares/${id}/revoke/`, { method: "POST" });

export const requestPassportCorrection = (input: { record_type: CorrectionRecordType; record_id: string; reason: string }) =>
  apiFetch<PassportCorrection>("/me/passport/corrections/", { method: "POST", body: JSON.stringify(input) });

/** The recipient's read. The token goes in the body, never a URL. */
export const openSharedPassport = (token: string) =>
  apiFetch<SharedPassport>("/passport-shares/open/", { method: "POST", body: JSON.stringify({ token }) });

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

export function shareUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/shared-passport#${token}`;
}

/** The record's correction, if it has one. */
export function correctionFor(
  corrections: PassportCorrection[],
  recordType: CorrectionRecordType,
  recordId = "",
): PassportCorrection | null {
  return corrections.find((row) => row.record_type === recordType && row.record_id === recordId) ?? null;
}
