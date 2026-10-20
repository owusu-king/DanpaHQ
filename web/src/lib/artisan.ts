/**
 * Artisans (backend `apps.artisan`).
 *
 * Any account may apply to work as an artisan from the experience it is in.
 * Applying moves nobody: the artisan experience appears in the account menu
 * only once the backend reports `capabilities.artisan.workspace_access`, and
 * whether new work may start is `can_quote` — never worked out here.
 *
 * Danpa HQ connects people and keeps the record. Nothing in this module (or any
 * screen built on it) calls an artisan trusted, guaranteed or protected.
 */

import { apiFetch, idempotentMutation } from "./api";
import { authedFetch } from "./auth";
import type { ArtisanStatus } from "./session";

export type TradeOption = { value: string; label: string };

export type ArtisanCertificate = {
  id: string;
  file_id: string;
  trade: string;
  trade_label: string;
  issuing_body: string;
  expires_on: string | null;
  status: "provided" | "verified" | "expired";
  verified_at: string | null;
};

export type ArtisanApplication = {
  status: ArtisanStatus;
  submitted_at: string | null;
  decided_at: string | null;
  /** What the reviewer wrote for the applicant. Empty unless it asks something of them. */
  decision_note: string;
  suspended_at: string | null;
  suspended_reason: string;
  /** Danpa HQ already holds a current identity check, so no ID is asked for. */
  identity_on_file: boolean;
  trade_options: TradeOption[];
  profile: {
    trades: TradeOption[];
    districts: { id: string; name: string; region: string }[];
    bio: string;
    portfolio: { id: string; file_id: string; url: string | null }[];
    certificates: ArtisanCertificate[];
  } | null;
};

export type ArtisanApplicationInput = {
  trades: string[];
  district_ids: string[];
  bio: string;
  portfolio_file_ids: string[];
  identity_documents: { file_id: string; evidence_type: string }[];
  certificates: { file_id: string; trade: string; issuing_body: string; expires_on: string | null }[];
};

export type District = { id: string; name: string; region: string; region_name: string };

export const MIN_WORK_PHOTOS = 1;
export const MAX_WORK_PHOTOS = 8;
export const MAX_DISTRICTS = 10;

export function getMyArtisanApplication() {
  return authedFetch<ArtisanApplication>("/me/artisan/");
}

export function applyAsArtisan(input: ArtisanApplicationInput) {
  return authedFetch<ArtisanApplication>("/me/artisan/", {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function listDistricts() {
  return apiFetch<District[]>("/geo/districts/");
}

// --- meaning -----------------------------------------------------------------

/** How each application state reads. Plain facts; no promises about anybody's work. */
export const ARTISAN_STATUS_LOOK: Record<
  ArtisanStatus,
  { pill: string; title: string; line: string; tone: "" | "is-approved" | "is-waiting" | "is-attention" }
> = {
  not_started: {
    pill: "Not applied",
    title: "Work as an artisan",
    line: "Quote for repairs and jobs from tenants and property providers on Danpa HQ. Your account and everything on it stays as it is.",
    tone: "",
  },
  pending: {
    pill: "Under review",
    title: "Application under review",
    line: "Your application is with our team. There is nothing more to send — we will let you know the outcome.",
    tone: "is-waiting",
  },
  needs_more_info: {
    pill: "Action needed",
    title: "One more thing needed",
    line: "The review is paused until we have it. Read the note, update your application and send it again.",
    tone: "is-attention",
  },
  approved: {
    pill: "Approved",
    title: "You're approved as an artisan",
    line: "Switch to the artisan experience from your account menu to see quote requests and jobs.",
    tone: "is-approved",
  },
  suspended: {
    pill: "Suspended",
    title: "Your artisan account is suspended",
    line: "You cannot send new quotes or take on new jobs for now. Your existing jobs and records are unchanged.",
    tone: "is-attention",
  },
  rejected: {
    pill: "Not approved",
    title: "Not approved yet",
    line: "Read the note, put it right, and apply again.",
    tone: "is-attention",
  },
  revoked: {
    pill: "Withdrawn",
    title: "Approval withdrawn",
    line: "The artisan experience is closed. Contact support if you think this is wrong.",
    tone: "is-attention",
  },
};

/** May the person send (or re-send) the application form right now. */
export function canSendApplication(status: ArtisanStatus): boolean {
  return status === "not_started" || status === "needs_more_info" || status === "rejected" || status === "revoked";
}

export const CERTIFICATE_LABEL: Record<ArtisanCertificate["status"], string> = {
  provided: "Certificate provided",
  verified: "Verified",
  expired: "Expired",
};
