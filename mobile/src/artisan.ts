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
