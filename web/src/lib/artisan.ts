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
  status: "provided" | "verified" | "expired" | "declined";
  verified_at: string | null;
  /** Why Management could not accept it. Only ever on the artisan's own view. */
  decision_note?: string;
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

/** Keep an approved profile current. No new review; new certificates wait to be checked. */
export function updateArtisanProfile(input: Omit<ArtisanApplicationInput, "identity_documents">) {
  return authedFetch<ArtisanApplication>("/me/artisan/profile/", {
    method: "PUT",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

// --- finding an artisan --------------------------------------------------------

/** An artisan as a listing shows them: facts only, never a phone or an address. */
export type ArtisanCard = {
  id: string;
  name: string;
  trades: TradeOption[];
  districts: { id: string; name: string }[];
  id_checked: boolean;
  certified_trades: string[];
  jobs_completed: number;
  reviews_count: number;
  cover_url: string | null;
};

export type PublicArtisan = ArtisanCard & {
  bio: string;
  member_since: string;
  portfolio: { id: string; url: string | null }[];
  certificates: Omit<ArtisanCertificate, "file_id" | "decision_note">[];
  reviews: never[];
  is_you: boolean;
};

export type DiscoverResult = {
  results: ArtisanCard[];
  /** The electrical category: only certified artisans unless asked otherwise. */
  electrical: boolean;
  /** How many uncertified electricians that rule held back. */
  hidden_uncertified: number;
};

export type DiscoverQuery = {
  trade?: string;
  district?: string;
  certified?: boolean;
  showUncertified?: boolean;
};

export function discoverArtisans(query: DiscoverQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.trade) params.set("trade", query.trade);
  if (query.district) params.set("district", query.district);
  if (query.certified) params.set("certified", "true");
  if (query.showUncertified) params.set("show_uncertified", "true");
  return authedFetch<DiscoverResult>(`/artisans/?${params.toString()}`, { signal });
}

export function getArtisan(id: string) {
  return authedFetch<PublicArtisan>(`/artisans/${id}/`);
}

/** Every trade, for the filter. The same list the application offers. */
export const TRADES: TradeOption[] = [
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "carpentry", label: "Carpentry" },
  { value: "masonry", label: "Masonry and building" },
  { value: "painting", label: "Painting" },
  { value: "tiling", label: "Tiling" },
  { value: "roofing", label: "Roofing" },
  { value: "welding", label: "Welding and metalwork" },
  { value: "air_conditioning", label: "Air conditioning and fridges" },
  { value: "appliance_repair", label: "Appliance repair" },
  { value: "locksmith", label: "Locks and security" },
  { value: "pest_control", label: "Pest control" },
  { value: "cleaning", label: "Cleaning" },
  { value: "furniture", label: "Furniture making and assembly" },
  { value: "gardening", label: "Gardening and compound" },
];

export function listDistricts() {
  return apiFetch<District[]>("/geo/districts/");
}

// --- meaning -----------------------------------------------------------------

/** How each application state reads. Plain facts; no promises about anybody's work. */
export const ARTISAN_STATUS_LOOK: Record<
  ArtisanStatus,
  { pill: string; title: string; line: string; tone: "" | "is-approved" | "is-waiting" | "is-attention" }
> = {
  not_started: { pill: "Not applied", title: "Become an artisan", line: "Quote for jobs on Danpa HQ. Your account stays as it is.", tone: "" },
  pending: { pill: "Under review", title: "Application under review", line: "We'll let you know the outcome.", tone: "is-waiting" },
  needs_more_info: { pill: "Action needed", title: "One more thing needed", line: "Update your application and send it again.", tone: "is-attention" },
  approved: { pill: "Approved", title: "You're an approved artisan", line: "Switch to the artisan experience to see requests and jobs.", tone: "is-approved" },
  suspended: { pill: "Suspended", title: "Artisan account suspended", line: "New quotes and jobs are paused. Your records are unchanged.", tone: "is-attention" },
  rejected: { pill: "Not approved", title: "Not approved yet", line: "Read the note, then apply again.", tone: "is-attention" },
  revoked: { pill: "Withdrawn", title: "Approval withdrawn", line: "Contact support if you think this is wrong.", tone: "is-attention" },
};

/** May the person send (or re-send) the application form right now. */
export function canSendApplication(status: ArtisanStatus): boolean {
  return status === "not_started" || status === "needs_more_info" || status === "rejected" || status === "revoked";
}

export const CERTIFICATE_LABEL: Record<ArtisanCertificate["status"], string> = {
  provided: "Certificate provided",
  verified: "Verified",
  expired: "Expired",
  declined: "Not accepted",
};
