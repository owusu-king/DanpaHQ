import type Ionicons from "@expo/vector-icons/Ionicons";

import { apiFetch, idempotentMutation } from "@/api";
import type { ArtisanStatus } from "@/auth";

/**
 * Artisans (backend `apps.artisan`). Mirrors `web/src/lib/artisan.ts`.
 *
 * Any account may apply to work as an artisan from the experience it is in.
 * Applying moves nobody: the artisan tabs open only once the backend reports
 * `capabilities.artisan.workspace_access`, and whether new work may start is
 * `can_quote` — never worked out here.
 *
 * Danpa HQ connects people and keeps the record. Nothing in this module (or
 * any screen built on it) calls an artisan trusted, guaranteed or protected.
 */

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

export type ArtisanProfile = {
  trades: TradeOption[];
  districts: { id: string; name: string; region: string }[];
  bio: string;
  portfolio: { id: string; file_id: string; url: string | null }[];
  certificates: ArtisanCertificate[];
};

export type ArtisanApplication = {
  status: ArtisanStatus;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string;
  suspended_at: string | null;
  suspended_reason: string;
  identity_on_file: boolean;
  trade_options: TradeOption[];
  profile: ArtisanProfile | null;
};

export type ArtisanApplicationInput = {
  trades: string[];
  district_ids: string[];
  bio: string;
  portfolio_file_ids: string[];
  identity_documents: { file_id: string; evidence_type: string }[];
  certificates: { file_id: string; trade: string; issuing_body: string; expires_on: string | null }[];
};

export type District = { id: string; name: string; region_name: string };

export const MIN_WORK_PHOTOS = 1;
export const MAX_WORK_PHOTOS = 8;
export const MAX_DISTRICTS = 10;

export function getMyArtisanApplication() {
  return apiFetch<ArtisanApplication>("/me/artisan/");
}

export function applyAsArtisan(input: ArtisanApplicationInput) {
  return apiFetch<ArtisanApplication>("/me/artisan/", {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

/** Keep an approved profile current. No new review; new certificates wait to be checked. */
export function updateArtisanProfile(input: Omit<ArtisanApplicationInput, "identity_documents">) {
  return apiFetch<ArtisanApplication>("/me/artisan/profile/", {
    method: "PUT",
    body: input,
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
  electrical: boolean;
  hidden_uncertified: number;
};

export function discoverArtisans(query: { trade?: string; district?: string; certified?: boolean; showUncertified?: boolean }) {
  const params: string[] = [];
  if (query.trade) params.push(`trade=${encodeURIComponent(query.trade)}`);
  if (query.district) params.push(`district=${encodeURIComponent(query.district)}`);
  if (query.certified) params.push("certified=true");
  if (query.showUncertified) params.push("show_uncertified=true");
  return apiFetch<DiscoverResult>(`/artisans/?${params.join("&")}`);
}

export function getArtisan(id: string) {
  return apiFetch<PublicArtisan>(`/artisans/${id}/`);
}

/** Every trade, for the filter. Mirrors web's list, which a contract test holds to the backend. */
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

export type ArtisanLook = {
  pill: string;
  title: string;
  line: string;
  icon: keyof typeof Ionicons.glyphMap | null;
  tone: "calm" | "waiting" | "attention" | "approved";
};

/** How each application state reads. Plain facts; no promises about anybody's work. */
export const ARTISAN_STATUS_LOOK: Record<ArtisanStatus, ArtisanLook> = {
  not_started: {
    pill: "Not applied",
    title: "Work as an artisan",
    line: "Quote for repairs and jobs from tenants and property providers. Your account stays as it is.",
    icon: "hammer",
    tone: "calm",
  },
  pending: {
    pill: "Under review",
    title: "Application under review",
    line: "Your application is with our team. There is nothing more to send.",
    icon: null,
    tone: "waiting",
  },
  needs_more_info: {
    pill: "Action needed",
    title: "One more thing needed",
    line: "The review is paused until we have it. Read the note, update and send again.",
    icon: "alert-circle",
    tone: "attention",
  },
  approved: {
    pill: "Approved",
    title: "You're approved as an artisan",
    line: "Switch to artisan work to see quote requests and jobs.",
    icon: "checkmark-circle",
    tone: "approved",
  },
  suspended: {
    pill: "Suspended",
    title: "Your artisan account is suspended",
    line: "You cannot send new quotes or take on new jobs for now. Your existing jobs and records are unchanged.",
    icon: "pause-circle",
    tone: "attention",
  },
  rejected: {
    pill: "Not approved",
    title: "Not approved yet",
    line: "Read the note, put it right, and apply again.",
    icon: "alert-circle",
    tone: "attention",
  },
  revoked: {
    pill: "Withdrawn",
    title: "Approval withdrawn",
    line: "The artisan experience is closed. Contact support if you think this is wrong.",
    icon: "alert-circle",
    tone: "attention",
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
  declined: "Not accepted",
};

// --- quotes on maintenance requests (mirrors web/src/lib/artisan.ts) -------------

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
    category_display: string;
    /** The category on a repair; what the customer called it on a direct job. */
    title: string;
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

export function inviteArtisan(requestId: string, artisanId: string) {
  return apiFetch<ArtisanWork>(`/maintenance/${requestId}/artisan-invitations/`, {
    method: "POST",
    body: { artisan_id: artisanId },
    ...idempotentMutation(),
  });
}

export function suggestArtisan(requestId: string, artisanId: string) {
  return apiFetch<ArtisanWork>(`/maintenance/${requestId}/artisan-suggestions/`, {
    method: "POST",
    body: { artisan_id: artisanId },
    ...idempotentMutation(),
  });
}

export function approveQuote(quoteId: string) {
  return apiFetch<ArtisanWork>(`/artisan-quotes/${quoteId}/approve/`, { method: "POST", body: {}, ...idempotentMutation() });
}

export function declineQuote(quoteId: string, note = "") {
  return apiFetch<ArtisanWork>(`/artisan-quotes/${quoteId}/decline/`, { method: "POST", body: { note }, ...idempotentMutation() });
}

export function getArtisanWork() {
  return apiFetch<{ requests: CustomerWorkItem[]; records: CustomerWorkItem[] }>("/artisan-work/");
}

export function listMyInvitations() {
  return apiFetch<ArtisanInvitation[]>("/me/artisan/invitations/");
}

export function listMyJobs() {
  return apiFetch<ArtisanInvitation[]>("/me/artisan/jobs/");
}

export function getMyInvitation(id: string) {
  return apiFetch<ArtisanInvitation>(`/me/artisan/invitations/${id}/`);
}

export function declineInvitation(id: string) {
  return apiFetch<ArtisanInvitation>(`/me/artisan/invitations/${id}/decline/`, { method: "POST", body: {}, ...idempotentMutation() });
}

export function submitQuote(invitationId: string, input: QuoteInput) {
  return apiFetch<ArtisanInvitation>(`/me/artisan/invitations/${invitationId}/quotes/`, {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export function withdrawQuote(quoteId: string) {
  return apiFetch<ArtisanInvitation>(`/artisan-quotes/${quoteId}/withdraw/`, { method: "POST", body: {}, ...idempotentMutation() });
}

export function submitRevision(kind: WorkKind, id: string, input: QuoteInput & { reason: string }) {
  const path = kind === "direct_job" ? `/direct-jobs/${id}/revisions/` : `/maintenance/${id}/revisions/`;
  return apiFetch<ArtisanInvitation>(path, {
    method: "POST",
    body: input,
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
  return apiFetch<DirectJob>("/me/direct-jobs/", { method: "POST", body: input, ...idempotentMutation() });
}

export function getDirectJob(id: string) {
  return apiFetch<DirectJob>(`/me/direct-jobs/${id}/`);
}

export function inviteToDirectJob(jobId: string, artisanId: string) {
  return apiFetch<DirectJob>(`/me/direct-jobs/${jobId}/invitations/`, {
    method: "POST",
    body: { artisan_id: artisanId },
    ...idempotentMutation(),
  });
}

export function cancelDirectJob(jobId: string) {
  return apiFetch<DirectJob>(`/me/direct-jobs/${jobId}/cancel/`, { method: "POST", body: {}, ...idempotentMutation() });
}
