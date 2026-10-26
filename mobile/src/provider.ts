import type { ImagePickerAsset } from "expo-image-picker";
import { preparePhotoUpload } from "@/photoUpload";

import { apiFetch, idempotentMutation } from "@/api";
import type { ProviderReadiness } from "@/auth";
import type { Listing, Locality } from "@/listings";

export type ProviderApplication = {
  id: string;
  organization_id: string | null;
  relationship_type: "owner" | "agent" | "manager" | "company_representative";
  relationship_label: string;
  title: string;
  status: string;
  status_label: string;
  property_id: string | null;
  decision_note: string;
};

type Reservation = {
  file_id: string;
  url: string;
  method: "PUT" | "POST";
  fields?: Record<string, string>;
};

export type UploadedFile = {
  id: string;
  is_usable: boolean;
  status_message: string;
  rejection_reason: string;
};

export async function uploadImage(
  asset: ImagePickerAsset,
  purpose:
    | "identity_document"
    | "property_document"
    | "property_photo"
    | "payment_evidence"
    | "avatar"
    | "maintenance_photo"
    | "maintenance_video"
    | "artisan_work_photo"
    | "artisan_certificate"
    | "artisan_job_photo"
    | "artisan_done_photo"
    | "artisan_receipt"
    | "report_evidence",
) {
  // A video picked without a declared type is an iPhone's QuickTime or an
  // Android camera's MP4; the server sniffs the bytes either way.
  const video = asset.type === "video" || purpose === "maintenance_video";
  const mime = asset.mimeType ?? (video ? (asset.uri.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4") : "image/jpeg");
  const extension = { "video/quicktime": "mov", "video/mp4": "mp4", "video/webm": "webm", "image/png": "png", "image/webp": "webp", "image/heic": "heic" }[mime] ?? "jpg";
  const filename = asset.fileName ?? `${purpose}-${Date.now()}.${extension}`;
  const prepared = await preparePhotoUpload(asset, mime, filename, purpose);
  const reservation = await apiFetch<Reservation>("/files/uploads/", {
    method: "POST",
    body: { purpose, filename: prepared.filename, content_type: prepared.mime, size_bytes: prepared.blob.size },
  });

  let response: Response;
  if (reservation.method === "PUT") {
    response = await fetch(reservation.url, {
      method: "PUT",
      headers: { "Content-Type": prepared.mime },
      body: prepared.blob,
    });
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries(reservation.fields ?? {})) form.append(key, value);
    form.append("file", { uri: prepared.uri, name: prepared.filename, type: prepared.mime } as unknown as Blob);
    response = await fetch(reservation.url, { method: "POST", body: form });
  }
  if (!response.ok) throw new Error("Storage refused the document upload.");
  let stored = await apiFetch<UploadedFile>(`/files/uploads/${reservation.file_id}/complete/`, {
    method: "POST",
  });
  for (let attempt = 0; attempt < 20 && !stored.is_usable && !stored.rejection_reason; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    stored = await apiFetch<UploadedFile>(`/files/${reservation.file_id}/`);
  }
  return stored;
}

/**
 * `POST /provider/applications/` has no client wrapper any more, deliberately.
 *
 * It submitted a property claim on the spot, and having it to hand is how the
 * creation flow came to file a review from its second step. The claim is now
 * recorded against a property that exists — `recordPropertyClaim` — and queued
 * with the photographs by `submitPropertyForVerification`. Answering a reviewer
 * who asked for more is handled server-side inside the same claim endpoint.
 *
 * The endpoint itself remains: ADR 0024 keeps it as the onboarding path, where a
 * claim genuinely is the thing being sent and there is often no property row
 * yet. Nothing reaches it today.
 */

export function getProviderReadiness(propertyId?: string) {
  const query = propertyId ? `?property_id=${encodeURIComponent(propertyId)}` : "";
  return apiFetch<ProviderReadiness>(`/provider/readiness/${query}`);
}

export function createAddress(input: {
  locality_id?: string;
  place?: {
    provider: string;
    reference: string;
    session?: string;
    name: string;
    context?: string;
  };
  digital_address?: string;
  street?: string;
  landmark?: string;
}) {
  return apiFetch<{ id: string }>("/geo/addresses/", { method: "POST", body: input });
}

export function searchProviderLocalities(query: string) {
  return apiFetch<Locality[]>(`/geo/localities/?q=${encodeURIComponent(query)}`, {
    anonymous: true,
  });
}

export type PropertySaleSummary = {
  id: string;
  status: "active" | "withdrawn" | "sold";
  status_label: string;
  headline: string;
  price_formatted: string | null;
  is_public: boolean;
};

export type Property = {
  id: string;
  title: string;
  property_type: string;
  /** `sale` for a property sold whole — no Units (owner, 2026-09-28). */
  purpose: "letting" | "sale";
  /** A sale's headline facts, for a row; null when letting. */
  sale: PropertySaleSummary | null;
  authority_state: string;
  capabilities: import("@/organizations").ManagedProperty["capabilities"];
  condition_state: ConditionState;
  /** Where the property stands, as one state rather than two half-answers.
   *  `authority_state` beside it has four values and collapses `rejected` and
   *  `revoked` into `unverified`, so a page cannot be state-aware on it. */
  verification: PropertyVerification;
  permitted_actions: Record<string, PermittedAction>;
  /** Where it stands against the Portfolio's plan allowance — never its lifecycle.
   *  Above the allowance it keeps its status, its records and its tenancies. */
  billing_access?: import("@/billing").BillingAccess;
  /** The Ghana-specific facts that decide what this property must photograph.
   *  Both default to `unknown`, which is the state the details step exists to
   *  leave — see `trust.evidence_policy`. */
  water_source: string;
  power_meter_type: string;
  compound_type: string;
  /** The three facts in words, from the server's own vocabulary. */
  water_source_label: string;
  power_meter_label: string;
  compound_label: string;
  notes: string;
  amenities_confirmed_at: string | null;
  /** The one photograph a row shows. The Property's own if it has one, else a
   *  photograph from one of its Units — nothing uploads Property photos yet. */
  cover_url: string | null;
  /** What the compound has, as distinct from what any one space inside it
   *  has. Served by `PropertySerializer` and read by the creation review. */
  amenities: SpaceAmenity[];
  unit_count: number;
  building_count: number;
  bed_count: number;
  occupied_unit_count: number;
  vacant_unit_count: number;
  address: {
    locality_name: string;
    district_name: string;
    region_name: string;
    digital_address: string;
    street: string;
    house_number: string;
    landmark: string;
  };
};

/** Where a condition check stands. `in_progress` means photos are being
 *  collected and nobody has been asked to look yet. */
export type ConditionState =
  | "not_started"
  | "in_progress"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

/**
 * The space's verification lifecycle, in the vocabulary the workspace renders.
 *
 * Separate from `ConditionState`, which is the older two-word answer cards
 * already show. This one tells apart the states a provider needs told apart:
 * work still to do from work waiting on them to press a button, and queued
 * from actually being looked at.
 *
 * Mirrors `web/src/lib/console.ts` deliberately — a provider photographing a
 * room on their phone and finishing on a laptop must see the same state.
 */
export type SpaceVerificationState =
  | "draft"
  | "ready_for_submission"
  | "submitted"
  | "under_review"
  | "verified"
  | "changes_requested"
  | "rejected"
  | "suspended"
  | "expired";

export type SpaceVerification = {
  state: SpaceVerificationState;
  state_label: string;
  editable: boolean;
  required_total: number;
  required_outstanding: number;
  can_submit: boolean;
  decision_note: string;
  policy_version: string;
};

/** Whether the space is being offered publicly. Never mixed into verification. */
export type SpacePublication = {
  state: "private" | "published" | "withdrawn";
  label: string;
  listing_id: string | null;
  listing_status: string | null;
};

/** Whether it can still be taken. Occupancy decides this, not the listing. */
export type SpaceAvailability = {
  state: "available" | "occupied" | "expired";
  label: string;
};

export type SpaceAmenity = {
  id: string;
  name: string;
  category: string;
  icon: string;
  notes: string;
  confirmed_at: string | null;
};

export type AmenityOption = {
  id: string;
  name: string;
  category: string;
  icon: string;
  scope: "property" | "unit" | "both";
  space_types: string[];
};

export type SpacePhoto = {
  id: string;
  file_id: string;
  is_primary: boolean;
  caption: string;
  sort_order: number;
  slot_key: string;
  download_url: string | null;
  created_at: string;
};

/** What the backend says this person may do, so the client renders rather than
 *  decides. Hiding a control it refuses is a courtesy; the API refuses either way. */
export type PermittedAction = {
  allowed: boolean;
  code: string;
  message: string;
  requires_reason: boolean;
  requires_confirmation: boolean;
  requires_elevated: boolean;
  blockers: { kind: string; count: number; message: string }[];
};

export type Unit = {
  id: string;
  property_id: string;
  label: string;
  space_type: string;
  space_type_label: string;
  /** Which details fit this kind of space; absent from an older API. */
  asks?: { bedrooms: boolean; bathrooms: "count" | "yes_no" | "none"; floor: boolean };
  description: string;
  bedrooms: number;
  bathrooms: number;
  floor_level: number | null;
  wing: string;
  entrance_note: string;
  is_furnished: boolean;
  has_private_bathroom: boolean;
  has_private_toilet: boolean;
  has_private_kitchen: boolean;
  has_air_conditioning: boolean;
  /** Present so a Unit read outside its Property can say where it is. */
  property_title: string;
  condition_state: ConditionState;
  /** Three lifecycles, three fields. They move independently. */
  verification: SpaceVerification;
  publication: SpacePublication;
  availability: SpaceAvailability;
  amenities: SpaceAmenity[];
  primary_photo: SpacePhoto | null;
  photo_count: number;
  permitted_actions: Record<string, PermittedAction>;
  /** Where it stands against the Portfolio's plan allowance — never its lifecycle. */
  billing_access?: import("@/billing").BillingAccess;
  access_code: AccessCodeState;
  /** Deprecated. Raw codes are returned only by create/rotate. */
  join_code: string | null;
};

export type AccessCodeState = {
  state: "unavailable" | "not_created" | "active" | "expired" | "revoked";
  expires_at: string | null;
  issued_at: string | null;
  version: number;
  can_rotate: boolean;
  can_revoke: boolean;
  single_use: boolean;
  /** False for somebody who may read the Unit but not share it. */
  can_manage?: boolean;
};

export type IssuedAccessCode = AccessCodeState & { code: string };

/** One space, with every photograph and the property it sits in. */
export type UnitDetail = Unit & {
  media: SpacePhoto[];
  beds: Bed[];
  property: {
    id: string;
    title: string;
    property_type: string;
    address: { locality_name: string; district_name: string } | null;
    authority_state: string;
    condition_state: ConditionState;
  };
};

/** Every state a property's verification can actually be in. */
export type PropertyVerificationState =
  | "draft"
  | "ready_for_submission"
  | "submitted"
  | "under_review"
  | "verified"
  | "changes_requested"
  | "rejected"
  | "suspended"
  | "expired";

export type PropertyVerification = {
  state: PropertyVerificationState;
  state_label: string;
  review_state: "not_submitted" | "pending_verification" | "verified" | "withdrawn" | "changes_required" | "rejected" | "suspended" | "expired";
  review_state_label: string;
  editable: boolean;
  with_reviewer: boolean;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string;
  authority: { state: string; state_label: string; decided_at: string | null; note: string };
  photos: { state: string; state_label: string; decided_at: string | null; note: string };
};

/** Take a submission back out of the review queue. Nothing is deleted: the
 *  reviews and their evidence stay and only their place in the queue goes. */
/**
 * Keep the document with the property. Ask nobody to read it.
 *
 * The Documents step of creation — deliberately not `submitProviderApplication`,
 * which files a claim for review. Routing creation through that is what made the
 * wizard's second step say "Send this claim for review" and send it.
 */
export function recordPropertyClaim(
  propertyId: string,
  input: {
    relationship_type: ProviderApplication["relationship_type"];
    owner_name?: string;
    owner_phone?: string;
    company_name?: string;
    file_ids: string[];
    /** Which document each file is, by file id — a sale's title and site plan
     *  beside the relationship document. A file with no entry is the latter. */
    evidence_types?: Record<string, string>;
  },
) {
  return apiFetch<ProviderApplication>(`/properties/${propertyId}/claim/`, {
    method: "POST",
    body: input,
  });
}

/** Send the whole property — the document and the photographs, in one act. */
export function submitPropertyForVerification(propertyId: string) {
  return apiFetch<{ submitted: boolean }>(`/properties/${propertyId}/verification/`, {
    method: "POST",
    body: {},
    ...idempotentMutation(),
  });
}

/**
 * Take a property out of the workspace, keeping every record.
 *
 * `archive` and `delete` are separate verbs on purpose: one is reversible and
 * the other is not, and sharing a verb is how somebody removes a building
 * meaning to tidy their list. Both carry a reason — it is what the audit entry
 * and anyone affected will read — and both are refused unless `confirmed`.
 */
export function archiveProperty(propertyId: string, reason: string) {
  return apiFetch<Property>(`/properties/${propertyId}/archive/`, {
    method: "POST",
    body: { reason, confirmed: true },
  });
}

/** Permanent, and only ever for a property nobody outside the workspace saw. */
export function deleteProperty(propertyId: string, reason: string) {
  // Query string rather than a body: DELETE carries no body reliably through
  // every proxy, and the view reads `request.query_params` for exactly that.
  const query = new URLSearchParams({ reason, confirmed: "true" });
  return apiFetch<void>(`/properties/${propertyId}/archive/?${query}`, {
    method: "DELETE",
  });
}

/** Unit lifecycle mirrors Property lifecycle: archive is reversible; delete is
 * reserved for a private draft with no review or rental history. */
export function archiveUnit(unitId: string, reason: string) {
  return apiFetch<{ id: string; is_active: boolean }>(`/spaces/${unitId}/archive/`, {
    method: "POST",
    body: { reason, confirmed: true },
  });
}

export function deleteUnit(unitId: string, reason: string) {
  const query = new URLSearchParams({ reason, confirmed: "true" });
  return apiFetch<void>(`/spaces/${unitId}/archive/?${query}`, {
    method: "DELETE",
  });
}

/** Undo an archive. */
export function restoreProperty(propertyId: string) {
  return apiFetch<Property>(`/properties/${propertyId}/restore/`, {
    method: "POST",
    body: {},
  });
}

export function withdrawPropertySubmission(propertyId: string, reason: string) {
  return apiFetch<Property>(`/properties/${propertyId}/verification/withdraw/`, {
    method: "POST",
    body: { reason },
    ...idempotentMutation(),
  });
}

/** The same act one level down, on a space. */
export function withdrawSpaceSubmission(unitId: string, reason: string) {
  return apiFetch<unknown>(`/units/${unitId}/verification/withdraw/`, {
    method: "POST",
    body: { reason },
    ...idempotentMutation(),
  });
}

export type Bed = {
  id: string;
  unit_id: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export function getProperty(id: string) {
  return apiFetch<Property>(`/properties/${id}/`);
}

/**
 * Correct a property's own details.
 *
 * `PATCH /properties/:id/` has accepted these since Phase 2 and no screen on
 * either platform sent them, so every property carried `water_source: unknown`
 * and `power_meter_type: unknown` — the two the evidence policy reads to decide
 * whether the water source and the meter have to be photographed.
 */
export function updateProperty(
  id: string,
  input: Partial<{
    title: string;
    water_source: string;
    power_meter_type: string;
    compound_type: string;
    notes: string;
  }>,
) {
  return apiFetch<Property>(`/properties/${id}/`, { method: "PATCH", body: input });
}

export function listUnits(propertyId: string) {
  return apiFetch<Unit[]>(`/properties/${propertyId}/units/`);
}

/**
 * Every Unit in one Portfolio.
 *
 * Units were readable one Property at a time, so finding a room across a
 * portfolio meant a request per Property. Same serializer, same scoping.
 */
export function listPortfolioUnits(organizationId: string) {
  return apiFetch<Unit[]>(`/organizations/${organizationId}/units/`);
}

export function createUnit(propertyId: string, input: {
  label: string;
  /** The block or wing, where the Property names one. */
  wing?: string;
  space_type: string;
  bedrooms: number;
  bathrooms: number;
  description?: string;
  floor_level?: number | null;
  entrance_note?: string;
  is_furnished?: boolean;
}) {
  return apiFetch<UnitDetail>(`/properties/${propertyId}/units/`, { method: "POST", body: input });
}

// --- one space, and everything that happens to it ----------------------------

export function getUnit(unitId: string) {
  return apiFetch<UnitDetail>(`/units/${unitId}/`);
}

export function rotateUnitAccessCode(unitId: string) {
  return apiFetch<IssuedAccessCode>(`/units/${unitId}/access-code/rotate/`, {
    method: "POST",
    body: {},
  });
}

export type ArchiveRestoreDecision = {
  allowed: boolean;
  code: string;
  message: string;
  blockers: { kind: string; count: number; message: string }[];
};

export type ArchivedProperty = {
  resource_type: "property";
  id: string;
  label: string;
  property_type_label: string;
  locality: string;
  district: string;
  unit_count: number;
  bed_count: number;
  archived_at: string;
  archived_reason: string;
  restore: ArchiveRestoreDecision;
};

export type ArchivedSpace = {
  resource_type: "space";
  id: string;
  label: string;
  space_type_label: string;
  property_id: string;
  property_title: string;
  property_archived: boolean;
  bed_count: number;
  archived_at: string;
  archived_reason: string;
  restore: ArchiveRestoreDecision;
};

export type ArchiveSummary = {
  properties: ArchivedProperty[];
  spaces: ArchivedSpace[];
};

export function listMyArchive() {
  return apiFetch<ArchiveSummary>("/me/archive/");
}

export function restoreSpace(spaceId: string) {
  return apiFetch<{ id: string; is_active: boolean }>(`/spaces/${spaceId}/restore/`, {
    method: "POST",
    body: {},
  });
}

export function revokeUnitAccessCode(unitId: string, reason = "Revoked by provider") {
  return apiFetch<AccessCodeState>(`/units/${unitId}/access-code/revoke/`, {
    method: "POST",
    body: { reason },
    ...idempotentMutation(),
  });
}

export function updateUnit(
  unitId: string,
  input: Partial<{
    label: string;
    description: string;
    bedrooms: number;
    bathrooms: number;
    floor_level: number | null;
    wing: string;
    entrance_note: string;
    is_furnished: boolean;
    has_private_bathroom: boolean;
    has_private_toilet: boolean;
    has_private_kitchen: boolean;
    has_air_conditioning: boolean;
  }>,
) {
  return apiFetch<UnitDetail>(`/units/${unitId}/`, { method: "PATCH", body: input });
}

/** The amenity vocabulary for this space, and what it currently claims.
 *  Filtered server-side by scope and space type, so a bed space is never
 *  offered a porch and neither client keeps its own copy of that rule. */
export function getUnitAmenities(unitId: string) {
  return apiFetch<{ options: AmenityOption[]; chosen: SpaceAmenity[] }>(
    `/units/${unitId}/amenities/`,
  );
}

/** The whole checklist, not a diff — one request that either lands or does not. */
export function setUnitAmenities(unitId: string, amenityIds: string[]) {
  return apiFetch<SpaceAmenity[]>(`/units/${unitId}/amenities/`, {
    method: "PUT",
    body: { amenity_ids: amenityIds },
  });
}

export function getPropertyAmenities(propertyId: string) {
  return apiFetch<{ options: AmenityOption[]; chosen: SpaceAmenity[]; confirmed: boolean }>(
    `/properties/${propertyId}/amenities/`,
  );
}

export function setPropertyAmenities(propertyId: string, amenityIds: string[]) {
  return apiFetch<SpaceAmenity[]>(`/properties/${propertyId}/amenities/`, {
    method: "PUT",
    body: { amenity_ids: amenityIds },
  });
}

export function listUnitPhotos(unitId: string) {
  return apiFetch<{ capacity: number; photos: SpacePhoto[] }>(`/units/${unitId}/photos/`);
}

/**
 * Add a photograph of the space.
 *
 * The same image becomes the listing's picture and the evidence the check is
 * decided on — one upload, two consequences. Omitting `slot_key` fills the
 * first outstanding slot, which is what taking three photos in order should do.
 */
export function attachUnitPhoto(
  unitId: string,
  input: { file_id: string; slot_key?: string; caption?: string; is_primary?: boolean },
) {
  return apiFetch<SpacePhoto>(`/units/${unitId}/photos/`, { method: "POST", body: input });
}

export function setPrimaryUnitPhoto(unitId: string, photoId: string) {
  return apiFetch<SpacePhoto>(`/units/${unitId}/photos/${photoId}/`, { method: "PATCH" });
}

export function removeUnitPhoto(unitId: string, photoId: string) {
  return apiFetch<void>(`/units/${unitId}/photos/${photoId}/`, { method: "DELETE" });
}

/** Reopen an approved space so its details and photographs can change. The
 *  approval is superseded and any live advertisement comes down with it. */
export function requestUnitRecheck(unitId: string, reason: string) {
  return apiFetch<UnitDetail>(`/units/${unitId}/verification/recheck/`, {
    method: "POST",
    body: { reason },
    ...idempotentMutation(),
  });
}

export function withdrawListing(listingId: string, reason: string) {
  return apiFetch<Listing>(`/listings/${listingId}/withdraw/`, {
    method: "POST",
    body: { reason },
  });
}

export function listBeds(unitId: string) {
  return apiFetch<Bed[]>(`/units/${unitId}/beds/`);
}

export function createBed(unitId: string, input: { label: string }) {
  return apiFetch<Bed>(`/units/${unitId}/beds/`, { method: "POST", body: input });
}

export function listMyListings() {
  return apiFetch<Listing[]>("/me/listings/");
}

export function createListing(input: {
  unit_id: string;
  rent_minor: number;
  headline: string;
  description: string;
  advance_months: number;
  caution_months: number;
  minimum_lease_months: number;
}) {
  return apiFetch<Listing>("/me/listings/", { method: "POST", body: input });
}

export function updateListing(id: string, input: {
  rent_minor: number;
  headline: string;
  description: string;
  advance_months: number;
  caution_months: number;
  minimum_lease_months: number;
}) {
  return apiFetch<Listing>(`/me/listings/${id}/`, {
    method: "PATCH",
    body: input,
  });
}

export function attachListingPhoto(listingId: string, fileId: string) {
  return apiFetch(`/listings/${listingId}/media/`, {
    method: "POST",
    body: { file_id: fileId, is_cover: true },
  });
}

export function publishListing(listingId: string) {
  return apiFetch<Listing>(`/listings/${listingId}/publish/`, { method: "POST" });
}
