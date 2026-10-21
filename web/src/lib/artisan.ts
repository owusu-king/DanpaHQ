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

// --- quotes on repairs and direct jobs ----------------------------------------------

export type QuoteStatus = "submitted" | "approved" | "declined" | "withdrawn" | "superseded";

export type Material = { item: string; quantity: string; cost_minor: number | null };

export type QuoteView = {
  id: string;
  status: QuoteStatus;
  status_display: string;
  price_minor: number;
  price_display: string;
  scope: string;
  materials: Material[];
  /** Set on a revised quote: the quote whose price it would replace. */
  revises: string | null;
  reason: string;
  decision_note: string;
  created_at: string;
  decided_at: string | null;
};

export type ArtisanBrief = { id: string; name: string; trades: TradeOption[]; cover_url: string | null };

export type InvitationState =
  | "suggested"
  | "invited"
  | "quoted"
  | "declined"
  | "closed"
  | "assigned"
  | "cancelled";

/** What a quote is for: a repair on a rented home, or a job somebody posted for themselves. */
export type WorkKind = "maintenance" | "direct_job";

/** The artisan block of a maintenance request, as this reader may see it. */
export type ArtisanWork = {
  assigned: null | {
    artisan: ArtisanBrief;
    assigned_at: string | null;
    /** Null for the tenant: the price is the payer's business. */
    price_on_record: QuoteView | null;
  };
  invitations: {
    id: string;
    state: InvitationState;
    artisan: ArtisanBrief;
    suggested_by_tenant: boolean;
    quotes: QuoteView[];
  }[];
  permissions: { invite: boolean; approve: boolean; suggest: boolean; cancel?: boolean };
  max_open_invitations: number;
};

/** One request as an artisan reads it. `job` exists only once their quote was approved. */
export type ArtisanInvitation = {
  id: string;
  state: InvitationState;
  invited_at: string | null;
  request: {
    kind: WorkKind;
    id: string;
    /** The trade, on a direct job. */
    category: string;
    /** The category on a repair; what the customer called it on a direct job. */
    title: string;
    category_display: string;
    description: string;
    photo: { url: string } | null;
    reported_at: string;
    status: string;
    status_display: string;
    area: { locality: string; district: string; region: string };
  };
  quotes: QuoteView[];
  unlocked: boolean;
  job?: {
    address: { line: string; street: string; house_number: string; digital_address: string; landmark: string };
    /** Null on a direct job: there is no property. */
    place: { property_title: string; unit_label: string } | null;
    contact: { name: string; phone: string; role: string };
    approved_by: string;
    approved_at: string | null;
    price_on_record: QuoteView | null;
    history: { kind: string; kind_display: string; note: string; at: string }[];
  };
};

export type CustomerWorkItem = ArtisanWork & {
  request: {
    kind: WorkKind;
    id: string;
    category_display: string;
    title: string;
    status: string;
    status_display: string;
    place: string;
  };
};

export type QuoteInput = { price_minor: number; scope: string; materials: Material[] };

/** Fired after an invitation or suggestion, so an open maintenance sheet refreshes. */
export const ARTISAN_WORK_CHANGED = "danpahq:artisan-work-changed";

export function inviteArtisan(requestId: string, artisanId: string) {
  return authedFetch<ArtisanWork>(`/maintenance/${requestId}/artisan-invitations/`, {
    method: "POST",
    body: JSON.stringify({ artisan_id: artisanId }),
    ...idempotentMutation(),
  });
}

export function suggestArtisan(requestId: string, artisanId: string) {
  return authedFetch<ArtisanWork>(`/maintenance/${requestId}/artisan-suggestions/`, {
    method: "POST",
    body: JSON.stringify({ artisan_id: artisanId }),
    ...idempotentMutation(),
  });
}

export function approveQuote(quoteId: string) {
  return authedFetch<ArtisanWork>(`/artisan-quotes/${quoteId}/approve/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}

export function declineQuote(quoteId: string, note = "") {
  return authedFetch<ArtisanWork>(`/artisan-quotes/${quoteId}/decline/`, {
    method: "POST",
    body: JSON.stringify({ note }),
    ...idempotentMutation(),
  });
}

export function getArtisanWork() {
  return authedFetch<{ requests: CustomerWorkItem[]; records: CustomerWorkItem[] }>("/artisan-work/");
}

export function listMyInvitations() {
  return authedFetch<ArtisanInvitation[]>("/me/artisan/invitations/");
}

export function listMyJobs() {
  return authedFetch<ArtisanInvitation[]>("/me/artisan/jobs/");
}

export function getMyInvitation(id: string) {
  return authedFetch<ArtisanInvitation>(`/me/artisan/invitations/${id}/`);
}

export function declineInvitation(id: string) {
  return authedFetch<ArtisanInvitation>(`/me/artisan/invitations/${id}/decline/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}

export function submitQuote(invitationId: string, input: QuoteInput) {
  return authedFetch<ArtisanInvitation>(`/me/artisan/invitations/${invitationId}/quotes/`, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function withdrawQuote(quoteId: string) {
  return authedFetch<ArtisanInvitation>(`/artisan-quotes/${quoteId}/withdraw/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}

export function submitRevision(
  kind: WorkKind,
  id: string,
  input: QuoteInput & { reason: string },
) {
  const path = kind === "direct_job" ? `/direct-jobs/${id}/revisions/` : `/maintenance/${id}/revisions/`;
  return authedFetch<ArtisanInvitation>(path, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

/** Which trade a maintenance category usually needs, to start Find in the right place. */
export const TRADE_FOR_CATEGORY: Record<string, string> = {
  plumbing: "plumbing",
  electrical: "electrical",
  water: "plumbing",
  appliance: "appliance_repair",
  structure: "masonry",
  security: "locksmith",
  pests: "pest_control",
};

/** How a state reads, the same everywhere. */
export const INVITATION_STATE_LABEL: Record<InvitationState, string> = {
  suggested: "Suggested by the tenant",
  invited: "Asked to quote",
  quoted: "Quote waiting",
  declined: "Declined",
  closed: "Another artisan chosen",
  assigned: "Doing the work",
  cancelled: "Cancelled",
};

/** Said wherever a payer approves a price. Advice, not a rule Danpa HQ enforces. */
export const PAYMENT_TIP = "Pay after the work is confirmed done, or a small deposit at most.";

/** "450.00" → 45000, or null when it is not a price. */
export function toMinor(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Math.round(Number(cleaned) * 100);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// --- direct jobs ----------------------------------------------------------------------

/** A job somebody posted for themselves, as they — its payer — read it. */
export type DirectJob = ArtisanWork & {
  job: {
    kind: "direct_job";
    id: string;
    trade: string;
    trade_display: string;
    title: string;
    description: string;
    photo: { url: string } | null;
    status: "open" | "assigned" | "cancelled";
    status_display: string;
    area: { locality: string; district: string; region: string };
    address: { line: string; house_number: string; street: string; landmark: string };
    created_at: string;
    cancelled_at: string | null;
  };
};

export type DirectJobInput = {
  trade: string;
  title: string;
  description: string;
  locality_id: string;
  photo_file_id?: string | null;
  house_number?: string;
  street?: string;
  landmark?: string;
};

export function postDirectJob(input: DirectJobInput) {
  return authedFetch<DirectJob>("/me/direct-jobs/", {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function getDirectJob(id: string) {
  return authedFetch<DirectJob>(`/me/direct-jobs/${id}/`);
}

export function inviteToDirectJob(jobId: string, artisanId: string) {
  return authedFetch<DirectJob>(`/me/direct-jobs/${jobId}/invitations/`, {
    method: "POST",
    body: JSON.stringify({ artisan_id: artisanId }),
    ...idempotentMutation(),
  });
}

export function cancelDirectJob(jobId: string) {
  return authedFetch<DirectJob>(`/me/direct-jobs/${jobId}/cancel/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}
