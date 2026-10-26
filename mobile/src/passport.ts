/**
 * Housing Passport: the tenant's record and the links they share it by.
 *
 * The same contract as `web/src/lib/passport.ts` (ADR 0035). Every status is
 * decided by the backend from the record that owns the fact; the words both
 * readers see are in `passportMeaning.ts`, mirrored from web.
 *
 * The recipient's view is web's alone (`/shared-passport#<token>`): the app only
 * builds the link, on the web origin it was configured with.
 */

import { apiFetch } from "@/api";

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
  apiFetch<PassportView>("/me/passport/preview/", { method: "POST", body: scope });

export const listPassportShares = () => apiFetch<PassportShare[]>("/me/passport/shares/");

export const createPassportShare = (input: PassportScope & { recipient_label: string; expires_in_days: ShareLifetime }) =>
  apiFetch<PassportShare>("/me/passport/shares/", { method: "POST", body: input });

export const revokePassportShare = (id: string) =>
  apiFetch<PassportShare>(`/me/passport/shares/${id}/revoke/`, { method: "POST" });

export const requestPassportCorrection = (input: { record_type: CorrectionRecordType; record_id: string; reason: string }) =>
  apiFetch<PassportCorrection>("/me/passport/corrections/", { method: "POST", body: input });

// --- the link ----------------------------------------------------------------------

/**
 * The web origin a recipient opens the passport on.
 *
 * PENDING the owner's answer: mobile has no web origin configured yet, so no
 * link can be built and the screen says so instead of inventing one.
 */
export function webOrigin(): string | null {
  return null;
}

/** The token travels in the fragment, so it never reaches a server log. */
export function shareUrl(token: string): string | null {
  const origin = webOrigin();
  return origin ? `${origin}/shared-passport#${token}` : null;
}
