/**
 * The landlord console's view of the API.
 *
 * One module rather than calls scattered through components, for the same
 * reason the backend has a services layer: the shapes the API returns are a
 * contract, and a contract written down in one place is one that can be changed
 * deliberately. Everything here goes through authedFetch, so a request that
 * needs a session cannot accidentally be made without one.
 */

import { apiFetch, idempotentMutation } from "./api";
import { authedBlob, authedFetch } from "./auth";

// --- geography ---------------------------------------------------------------

export type Locality = {
  id: string;
  name: string;
  aliases: string[];
  district: string;
  district_name: string;
  region_name: string;
};

export type Address = {
  id: string;
  locality_name: string;
  district_name: string;
  region_name: string;
  digital_address: string;
  street: string;
  house_number: string;
  landmark: string;
};

/** Reference data, readable signed out - a search filter needs it before sign-in. */
export function searchLocalities(query: string) {
  return apiFetch<Locality[]>(`/geo/localities/?q=${encodeURIComponent(query)}`);
}

export function createAddress(input: {
  locality_id: string;
  digital_address?: string;
  street?: string;
  house_number?: string;
  landmark?: string;
}) {
  return authedFetch<Address>("/geo/addresses/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- property ----------------------------------------------------------------

export type Property = {
  id: string;
  title: string;
  property_type: string;
  owner_display: string;
  address: Address | null;
  water_source: string;
  power_meter_type: string;
  compound_type: string;
  has_security: boolean;
  is_gated: boolean;
  notes: string;
  amenities_confirmed_at: string | null;
  unit_count: number;
  building_count: number;
  bed_count: number;
  occupied_unit_count: number;
  vacant_unit_count: number;
  authority_state: "verified" | "pending" | "unverified" | "expired";
  /** Whether the building itself has been checked. Separate from authority,
   *  which asks whether this person may let it at all. */
  condition_state: ConditionState;
  /** Where the property stands, as one state rather than two half-answers.
   *
   *  `authority_state` beside it collapses through four display values, so a
   *  rejected property and one nobody ever claimed both arrive as `unverified`.
   *  This is the field a page decides from. */
  verification: PropertyVerification;
  /** What the compound has, as distinct from what any one space inside it has. */
  amenities: SpaceAmenity[];
  /** The one photograph a row shows. The Property's own if it has one, else a
   *  photograph from one of its Units — nothing uploads Property photos yet. */
  cover_url: string | null;
  capabilities: Record<string, { allowed: boolean; state: string; missing: string[] }>;
  /** What this person may do to this property, decided by the backend. The page
   *  renders these; hiding one the API refuses is a courtesy, not the boundary. */
  permitted_actions: Record<string, PermittedAction>;
  created_at: string;
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
  /** The sole provider-facing review result. Detailed `state` remains for
   * setup routing and backwards compatibility. */
  review_state: "not_submitted" | "pending_verification" | "verified" | "withdrawn" | "changes_required" | "rejected" | "suspended" | "expired";
  review_state_label: string;
  /** False while a reviewer is holding it. */
  editable: boolean;
  /** True for `submitted` and `under_review` — somebody else has it. */
  with_reviewer: boolean;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string;
  /** Internal package sections, retained for completeness and targeted notes;
   * they are not independent property outcomes. */
  authority: { state: string; state_label: string; decided_at: string | null; note: string };
  photos: { state: string; state_label: string; decided_at: string | null; note: string };
};

/**
 * Take a submission back out of the review queue.
 *
 * Nothing is deleted: the reviews and their evidence stay, and only their place
 * in the queue goes — so the property lands back where it was before the send
 * and can be corrected and sent again.
 */
/**
 * Keep the document with the property. Ask nobody to read it.
 *
 * The Documents step of creation. Deliberately not `submitProviderApplication`,
 * which files a claim for review — routing creation through that is what made
 * the second step of the wizard say "Send this claim for review" and send it,
 * leaving the wizard's final step with only photographs to submit.
 */
export function recordPropertyClaim(
  propertyId: string,
  input: {
    relationship_type: ProviderApplication["relationship_type"];
    owner_name?: string;
    owner_phone?: string;
    company_name?: string;
    file_ids: string[];
  },
) {
  return authedFetch<ProviderApplication>(`/properties/${propertyId}/claim/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Send the whole property to the review team — the document and the
 * photographs, in one act, because they are decided together.
 *
 * A separate decision from creating it, made from the property afterwards.
 */
export function submitPropertyForVerification(propertyId: string) {
  return authedFetch<{ submitted: boolean }>(`/properties/${propertyId}/verification/`, {
    method: "POST",
    body: JSON.stringify({}),
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
  return authedFetch<Property>(`/properties/${propertyId}/archive/`, {
    method: "POST",
    body: JSON.stringify({ reason, confirmed: true }),
  });
}

/** Permanent, and only ever for a property nobody outside the workspace saw. */
export function deleteProperty(propertyId: string, reason: string) {
  // Query string rather than a body: DELETE carries no body reliably through
  // every proxy, and the view reads `request.query_params` for exactly that.
  const query = new URLSearchParams({ reason, confirmed: "true" });
  return authedFetch<void>(`/properties/${propertyId}/archive/?${query}`, {
    method: "DELETE",
  });
}

/** Unit lifecycle mirrors Property lifecycle: archive is reversible; delete is
 * reserved for a private draft with no review or rental history. */
export function archiveUnit(unitId: string, reason: string) {
  return authedFetch<{ id: string; is_active: boolean }>(`/spaces/${unitId}/archive/`, {
    method: "POST",
    body: JSON.stringify({ reason, confirmed: true }),
  });
}

export function deleteUnit(unitId: string, reason: string) {
  const query = new URLSearchParams({ reason, confirmed: "true" });
  return authedFetch<void>(`/spaces/${unitId}/archive/?${query}`, {
    method: "DELETE",
  });
}

/** Undo an archive. */
export function restoreProperty(propertyId: string) {
  return authedFetch<Property>(`/properties/${propertyId}/restore/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function withdrawPropertySubmission(propertyId: string, reason: string) {
  return authedFetch<Property>(`/properties/${propertyId}/verification/withdraw/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    ...idempotentMutation(),
  });
}

/** The same act one level down, on a space. */
export function withdrawSpaceSubmission(unitId: string, reason: string) {
  return authedFetch<unknown>(`/units/${unitId}/verification/withdraw/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    ...idempotentMutation(),
  });
}

/** An optional physical subdivision: a block, a tower, a hostel building. */
export type Building = {
  id: string;
  property_id: string;
  name: string;
  code: string;
  sort_order: number;
  is_active: boolean;
};

export function listBuildings(propertyId: string) {
  return authedFetch<Building[]>(`/properties/${propertyId}/buildings/`);
}

export function createBuilding(propertyId: string, input: { name: string; code?: string }) {
  return authedFetch<Building>(`/properties/${propertyId}/buildings/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type ProviderApplication = {
  id: string;
  organization_id: string | null;
  relationship_type: "owner" | "agent" | "manager" | "company_representative";
  relationship_label: string;
  title: string;
  property_type: string;
  address: Address;
  owner_name: string;
  owner_phone: string;
  company_name: string;
  status: string;
  status_label: string;
  authority_verification_id: string;
  property_id: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  decision_note: string;
};

export type ProviderReadiness = {
  identity: { state: "verified" | "pending" | "unverified" | "expired" };
  identity_verification_id: string | null;
  identity_status: string;
  identity_decision_note: string;
  status: string;
  next_step: "identity" | "property" | "review" | "more_info" | "approved";
  application_id: string | null;
  property_id: string | null;
  decision_note: string;
  onboarding_stage: "identity" | "property" | "review" | "more_info" | "unit" | "listing" | "listing_review" | "listing_changes" | "live";
  unit_id: string | null;
  listing_id: string | null;
  listing_status: string;
  listing_review_note: string;
};

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
 * yet. Nothing reaches it today. Give it a wrapper again only alongside a screen
 * that means to submit.
 */

export function getProviderReadiness() {
  return authedFetch<ProviderReadiness>("/provider/readiness/", { cache: "no-store" });
}

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
 * Separate from `ConditionState`, which is the older two-word answer both
 * clients already show on cards. This one distinguishes the states a provider
 * actually needs told apart: work still to do (`draft`) from work waiting on
 * them to press a button (`ready_for_submission`), and queued (`submitted`)
 * from actually being looked at (`under_review`).
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
  listing_status: Listing["status"] | null;
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

/** What the backend says this person may do, so the client renders rather
 *  than decides. Hiding a control it refuses is a courtesy; the API refuses
 *  the call either way. */
export type PermittedAction = {
  allowed: boolean;
  code: string;
  message: string;
  requires_reason: boolean;
  requires_confirmation: boolean;
  requires_elevated: boolean;
  blockers: Array<{ kind: string; count: number; message: string }>;
};

export type Unit = {
  id: string;
  property_id: string;
  building_id: string | null;
  label: string;
  space_type: string;
  space_type_label: string;
  description: string;
  bedrooms: number;
  bathrooms: number;
  floor_area_sqm: string | null;
  floor_level: number | null;
  wing: string;
  entrance_note: string;
  has_private_bathroom: boolean;
  has_private_toilet: boolean;
  has_private_kitchen: boolean;
  is_furnished: boolean;
  has_air_conditioning: boolean;
  is_active: boolean;
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
  access_code: AccessCodeState;
  /** Deprecated. Raw codes are returned only by create/rotate. */
  join_code: string | null;
  created_at: string;
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
    address: Address | null;
    authority_state: Property["authority_state"];
    condition_state: ConditionState;
    capabilities: Record<string, { allowed: boolean; state: string; missing: string[] }>;
  };
};

export function listProperties() {
  return authedFetch<Property[]>("/properties/");
}

/**
 * Claim the landlord or agent role for yourself.
 *
 * Self-service on purpose: saying "I am a landlord" is a statement of intent,
 * not a claim of legitimacy. What the role *unlocks* — being trusted by a
 * tenant — is gated on verification, which is not self-service.
 */
export function addRole(role: "landlord" | "agent" | "tenant") {
  return authedFetch<unknown>("/me/roles/", {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function getProperty(id: string) {
  return authedFetch<Property>(`/properties/${id}/`);
}

/**
 * Correct a property's own details.
 *
 * `PATCH /properties/:id/` has accepted these since Phase 2 and nothing ever
 * sent them, so every property in the system carried `water_source: unknown`
 * and `power_meter_type: unknown` — the two values the evidence policy reads to
 * decide whether the water source and the meter have to be photographed. A
 * property nobody had described was therefore asked for the shortest possible
 * checklist, whatever it actually was.
 */
export function updateProperty(
  id: string,
  input: Partial<{
    title: string;
    water_source: string;
    power_meter_type: string;
    compound_type: string;
    has_security: boolean;
    is_gated: boolean;
    notes: string;
  }>,
) {
  return authedFetch<Property>(`/properties/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createProperty(input: {
  title: string;
  property_type: string;
  address_id: string;
  water_source?: string;
  power_meter_type?: string;
  compound_type?: string;
  notes?: string;
}) {
  return authedFetch<Property>("/properties/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listUnits(propertyId: string) {
  return authedFetch<Unit[]>(`/properties/${propertyId}/units/`);
}

/**
 * Every Unit in one Portfolio.
 *
 * Units were readable one Property at a time, so finding a room across a
 * portfolio meant a request per Property. Same serializer, same scoping — a
 * member with Property assignments sees theirs, not the Portfolio's.
 */
export function listPortfolioUnits(organizationId: string) {
  return authedFetch<Unit[]>(`/organizations/${organizationId}/units/`, { cache: "no-store" });
}

export function createUnit(
  propertyId: string,
  input: {
    label: string;
    /** What is let here. The backend refuses a type the property's category
     *  does not allow — see `space_rules.py`. */
    space_type: string;
    bedrooms: number;
    bathrooms: number;
    description?: string;
    building_id?: string;
    floor_level?: number | null;
    wing?: string;
    entrance_note?: string;
    is_furnished?: boolean;
  },
) {
  return authedFetch<UnitDetail>(`/properties/${propertyId}/units/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- the rentable space ------------------------------------------------------
//
// A space is created under a property and then worked on in its own right:
// details, amenities, photographs, and a check. Everything below is scoped to
// one unit, which is why none of it takes a property id.

export function getUnit(unitId: string) {
  return authedFetch<UnitDetail>(`/units/${unitId}/`, { cache: "no-store" });
}

export function rotateUnitAccessCode(unitId: string) {
  return authedFetch<IssuedAccessCode>(`/units/${unitId}/access-code/rotate/`, {
    method: "POST",
    body: JSON.stringify({}),
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
  property_type: string;
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
  space_type: string;
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
  return authedFetch<ArchiveSummary>("/me/archive/", { cache: "no-store" });
}

export function restoreSpace(spaceId: string) {
  return authedFetch<{ id: string; is_active: boolean }>(`/spaces/${spaceId}/restore/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function revokeUnitAccessCode(unitId: string, reason = "Revoked by provider") {
  return authedFetch<AccessCodeState>(`/units/${unitId}/access-code/revoke/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    ...idempotentMutation(),
  });
}

export function updateUnit(
  unitId: string,
  input: Partial<{
    label: string;
    description: string;
    building_id: string | null;
    space_type: string;
    bedrooms: number;
    bathrooms: number;
    floor_area_sqm: string | null;
    floor_level: number | null;
    wing: string;
    entrance_note: string;
    has_private_bathroom: boolean;
    has_private_toilet: boolean;
    has_private_kitchen: boolean;
    is_furnished: boolean;
    has_air_conditioning: boolean;
  }>,
) {
  return authedFetch<UnitDetail>(`/units/${unitId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** The amenity vocabulary for this space, and what it currently claims. */
export function getUnitAmenities(unitId: string) {
  return authedFetch<{ options: AmenityOption[]; chosen: SpaceAmenity[] }>(
    `/units/${unitId}/amenities/`,
    { cache: "no-store" },
  );
}

/** The whole checklist, not a diff — one request that either lands or does not. */
export function setUnitAmenities(unitId: string, amenityIds: string[]) {
  return authedFetch<SpaceAmenity[]>(`/units/${unitId}/amenities/`, {
    method: "PUT",
    body: JSON.stringify({ amenity_ids: amenityIds }),
  });
}

export function getPropertyAmenities(propertyId: string) {
  return authedFetch<{ options: AmenityOption[]; chosen: SpaceAmenity[]; confirmed: boolean }>(
    `/properties/${propertyId}/amenities/`,
    { cache: "no-store" },
  );
}

export function setPropertyAmenities(propertyId: string, amenityIds: string[]) {
  return authedFetch<SpaceAmenity[]>(`/properties/${propertyId}/amenities/`, {
    method: "PUT",
    body: JSON.stringify({ amenity_ids: amenityIds }),
  });
}

export function listUnitPhotos(unitId: string) {
  return authedFetch<{ capacity: number; photos: SpacePhoto[] }>(
    `/units/${unitId}/photos/`,
    { cache: "no-store" },
  );
}

/**
 * Add a photograph of the space.
 *
 * The same image becomes the listing's picture and the evidence the check is
 * decided on — one upload, two consequences. `slot_key` may be omitted, in
 * which case the first outstanding slot is filled, which is what taking three
 * photos in order should do.
 */
export function attachUnitPhoto(
  unitId: string,
  input: { file_id: string; slot_key?: string; caption?: string; is_primary?: boolean },
) {
  return authedFetch<SpacePhoto>(`/units/${unitId}/photos/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function setPrimaryUnitPhoto(unitId: string, photoId: string) {
  return authedFetch<SpacePhoto>(`/units/${unitId}/photos/${photoId}/`, { method: "PATCH" });
}

export function removeUnitPhoto(unitId: string, photoId: string) {
  return authedFetch<void>(`/units/${unitId}/photos/${photoId}/`, { method: "DELETE" });
}

/** Reopen an approved space so its details and photographs can change. The
 *  approval is superseded and any live advertisement comes down with it. */
export function requestUnitRecheck(unitId: string, reason: string) {
  return authedFetch<UnitDetail>(`/units/${unitId}/verification/recheck/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    ...idempotentMutation(),
  });
}

// --- listing -----------------------------------------------------------------

export type ListingMedia = {
  id: string;
  file_id: string;
  is_cover: boolean;
  sort_order: number;
  caption: string;
  download_url: string | null;
};

export type Listing = {
  id: string;
  unit: string;
  listing: string | null;
  application: string | null;
  status: "draft" | "pending_review" | "active" | "rented" | "withdrawn" | "expired" | "suspended" | "rejected" | "flagged";
  headline: string;
  description: string;
  rent_minor: number | null;
  rent_currency: string;
  rent_period: string;
  rent_formatted: string | null;
  advance_months: number;
  advance_label: string;
  caution_months: number;
  agency_fee_months: number;
  total_move_in_minor: number;
  available_from: string | null;
  minimum_lease_months: number;
  media: ListingMedia[];
  /** The one photograph a card shows: the Unit's own primary image, then the
   *  campaign's. `media` is optional campaign media and is usually empty. */
  cover_url: string | null;
  locality_name: string | null;
  district_name: string | null;
  landmark: string | null;
  property_type: string | null;
  space_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  is_furnished: boolean | null;
  map_latitude: string | null;
  map_longitude: string | null;
  provider_label: string;
  trust_stamps: {
    phone: { state: "verified" | "pending" | "unverified" | "expired" };
    identity: { state: "verified" | "pending" | "unverified" | "expired" };
    property: { state: "verified" | "pending" | "unverified" | "expired" };
    relationship: string;
    relationship_label: string;
  };
  review_note: string;
  reviewed_at: string | null;
  created_at: string;
};

export function listMyListings() {
  return authedFetch<Listing[]>("/me/listings/", { cache: "no-store" });
}

export type Organization = {
  id: string;
  name: string;
  organization_type: "individual_owner" | "property_company" | "property_manager" | "hostel_operator";
  activities: OrganizationActivity[];
  current_user_role: "owner" | "admin" | "property_manager" | "accountant" | "staff";
};

export type OrganizationActivity = "residential" | "commercial" | "hostel";

export function listOrganizations() {
  return authedFetch<Organization[]>("/organizations/");
}

export function getOrganization(organizationId: string) {
  return authedFetch<Organization>(`/organizations/${organizationId}/`, { cache: "no-store" });
}

export function updateOrganization(
  organizationId: string,
  input: Partial<Pick<Organization, "name" | "organization_type" | "activities">>,
) {
  return authedFetch<Organization>(`/organizations/${organizationId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type PayoutMethod = "bank" | "mobile_money";
export type PayoutInstitution = { code: string; name: string; method: PayoutMethod };
export type PayoutProfile = {
  id: string;
  method: PayoutMethod;
  provider: string;
  masked_account: string;
  account_name: string;
  institution: string;
  status: "unverified" | "verified" | "rejected" | "disabled";
  status_display: string;
  is_active: boolean;
  verified_at: string | null;
  updated_at: string;
};
export type PayoutDestinationState = {
  profile: PayoutProfile | null;
  active_profile: PayoutProfile | null;
  profiles: PayoutProfile[];
  provisioning: null | {
    id: string;
    provider: string;
    method: PayoutMethod;
    status: "pending" | "needs_reconciliation" | "succeeded" | "failed";
    status_display: string;
    checking: boolean;
    failure_code: string;
    failure_message: string;
    check_count: number;
    last_checked_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  };
};

export function getPayoutDestination(organizationId: string) {
  return authedFetch<PayoutDestinationState>(
    `/organizations/${organizationId}/payout-destination/`,
    { cache: "no-store" },
  );
}

export function refreshPayoutVerification(organizationId: string, profileId?: string) {
  return authedFetch<PayoutDestinationState>(
    profileId
      ? `/organizations/${organizationId}/payout-destinations/${profileId}/refresh/`
      : `/organizations/${organizationId}/payout-destination/refresh/`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function activatePayoutDestination(organizationId: string, profileId: string) {
  return authedFetch<PayoutDestinationState>(
    `/organizations/${organizationId}/payout-destinations/${profileId}/activate/`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function removePayoutDestination(organizationId: string, profileId: string) {
  return authedFetch<PayoutDestinationState>(
    `/organizations/${organizationId}/payout-destinations/${profileId}/`,
    { method: "DELETE" },
  );
}

export function listPayoutInstitutions(organizationId: string, method: PayoutMethod) {
  return authedFetch<{ results: PayoutInstitution[] }>(
    `/organizations/${organizationId}/payout-institutions/?method=${method}`,
  ).then((response) => response.results);
}

export function resolvePayoutAccount(
  organizationId: string,
  input: { method: PayoutMethod; bank_code: string; account_number: string },
) {
  return authedFetch<{ account_name: string; masked_account: string }>(
    `/organizations/${organizationId}/payout-destination/resolve/`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function provisionPayoutDestination(
  organizationId: string,
  input: { method: PayoutMethod; bank_code: string; account_number: string },
) {
  return authedFetch<PayoutDestinationState>(
    `/organizations/${organizationId}/payout-destination/`,
    { method: "POST", body: JSON.stringify(input), ...idempotentMutation() },
  );
}

export type PortfolioMember = {
  id: string;
  user_id: string;
  display_name: string;
  phone: string;
  role: "owner" | "admin" | "property_manager" | "accountant" | "staff";
  joined_at: string;
  ended_at: string | null;
  assigned_properties: Array<{ id: string; title: string }>;
  effective_access: "portfolio_wide" | "assigned_financial" | "assigned_properties";
};

export type PortfolioInvitation = {
  id: string;
  portfolio: { id: string; name: string; type: Organization["organization_type"] };
  invitee_phone: string;
  role: PortfolioMember["role"];
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  invited_by_name: string;
  properties: Array<{ id: string; title: string }>;
  expires_at: string;
  responded_at: string | null;
  created_at: string;
  token: string | null;
};

export type PropertyAssignment = {
  id: string;
  membership_id: string;
  property_id: string;
  created_at: string;
  ended_at: string | null;
};

export function listPortfolioMembers(organizationId: string) {
  return authedFetch<PortfolioMember[]>(`/organizations/${organizationId}/memberships/`, {
    cache: "no-store",
  });
}

export function listPortfolioInvitations(organizationId: string) {
  return authedFetch<PortfolioInvitation[]>(`/organizations/${organizationId}/invitations/`, {
    cache: "no-store",
  });
}

export function listMyPortfolioInvitations() {
  return authedFetch<PortfolioInvitation[]>("/me/portfolio-invitations/", {
    cache: "no-store",
  });
}

export function invitePortfolioMember(
  organizationId: string,
  input: { phone: string; role: PortfolioMember["role"]; property_ids: string[] },
) {
  return authedFetch<PortfolioInvitation>(`/organizations/${organizationId}/invitations/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function respondToPortfolioInvitation(
  invitationId: string,
  decision: "accept" | "decline",
  token: string,
) {
  return authedFetch<PortfolioMember>(`/portfolio-invitations/${invitationId}/${decision}/`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function revokePortfolioInvitation(organizationId: string, invitationId: string) {
  return authedFetch<PortfolioInvitation>(
    `/organizations/${organizationId}/invitations/${invitationId}/revoke/`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function changePortfolioMemberRole(
  organizationId: string,
  membershipId: string,
  role: PortfolioMember["role"],
) {
  return authedFetch<PortfolioMember>(
    `/organizations/${organizationId}/memberships/${membershipId}/`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
}

export function removePortfolioMember(organizationId: string, membershipId: string) {
  return authedFetch<void>(`/organizations/${organizationId}/memberships/${membershipId}/`, {
    method: "DELETE",
    body: JSON.stringify({ reason: "Access revoked by a Portfolio administrator." }),
  });
}

export function assignPortfolioProperty(
  organizationId: string,
  membershipId: string,
  propertyId: string,
) {
  return authedFetch<PropertyAssignment>(
    `/organizations/${organizationId}/property-assignments/`,
    {
      method: "POST",
      body: JSON.stringify({ membership_id: membershipId, property_id: propertyId }),
    },
  );
}

export function unassignPortfolioProperty(organizationId: string, assignmentId: string) {
  return authedFetch<void>(
    `/organizations/${organizationId}/property-assignments/${assignmentId}/`,
    { method: "DELETE", body: JSON.stringify({}) },
  );
}

export function listPortfolioAssignments(organizationId: string) {
  return authedFetch<PropertyAssignment[]>(
    `/organizations/${organizationId}/property-assignments/`,
    { cache: "no-store" },
  );
}

export type ProviderTenant = {
  occupancy_id: string;
  tenancy_id: string | null;
  tenancy_status: "pending_lease" | "upcoming" | "active" | "ended" | null;
  user_id: string;
  name: string;
  property_id: string;
  property_title: string;
  unit_id: string;
  unit_label: string;
  bed_id: string | null;
  bed_label: string | null;
  lease_id: string | null;
  lease_status: Lease["status"] | null;
  lease_rent_minor: number | null;
  lease_rent_currency: string | null;
  lease_rent_period: string | null;
  lease_starts_on: string | null;
  lease_ends_on: string | null;
  rent: {
    status: "current" | "outstanding" | "overdue";
    outstanding_minor: number;
    overdue_minor: number;
    next_due_on: string | null;
  };
  can_record_payment: boolean;
};

export type ProviderTenancyRequest = PropertyJoinRequest & {
  property_id: string;
  property_title: string;
  unit_label: string;
  bed_label: string | null;
  created_at: string;
  can_manage: boolean;
};

export type ProviderTenantAccess = {
  property_id: string;
  property_title: string;
  unit_id: string;
  unit_label: string;
  condition_state: string;
  availability: { state: "available" | "occupied" | "expired"; label: string };
  access_code: AccessCodeState;
  can_manage: boolean;
};

export type OrganizationPortfolio = {
  organization: { id: string; name: string };
  counts: {
    properties: number;
    units: number;
    occupied_units: number;
    vacant_units: number;
    active_tenants: number;
    active_leases: number;
    pending_join_requests: number;
  };
  money: {
    outstanding_minor: number;
    overdue_minor: number;
    confirmed_received_minor: number;
    online_paid_minor: number;
    settled_gross_minor: number;
    settled_fee_minor: number;
    settled_net_minor: number;
    awaiting_settlement_minor: number;
    settlement_attention_minor: number;
    expenses_minor: number;
    pending_payment_records: number;
    payment_records_awaiting_you: number;
  };
  rent_collection: {
    currency: "GHS";
    monthly: Array<{
      period: string;
      collected_minor: number;
      outstanding_minor: number;
    }>;
    yearly: Array<{
      period: string;
      collected_minor: number;
      outstanding_minor: number;
    }>;
  };
  verification: {
    tenant_access_ready: number;
    payments_ready: number;
    properties_total: number;
  };
  recent_payments: {
    id: string;
    lease_id: string;
    tenant_name: string;
    property_title: string;
    unit_label: string;
    amount_minor: number;
    currency: string;
    status: string;
    paid_on: string;
    method_display: string;
    recorded_by_tenant: boolean;
    awaiting_you: boolean;
    verification_source: "party_confirmation" | "psp";
    source: "PLATFORM_PSP" | "EXTERNAL";
    evidence: "AWAITING_COUNTERPARTY_CONFIRMATION" | "PSP_CONFIRMED" | "COUNTERPARTY_CONFIRMED" | "DISPUTED" | "ADMIN_VERIFIED";
  }[];
  recent_settlements: {
    id: string;
    transaction_id: string;
    tenant_name: string;
    property_title: string;
    unit_label: string;
    status: "pending" | "processing" | "settled" | "failed" | "reversed";
    status_display: string;
    gross_minor: number;
    fee_minor: number | null;
    net_minor: number | null;
    currency: string;
    paid_at: string | null;
    settled_at: string | null;
  }[];
  recent_activity: { id: string; kind: string; title: string; at: string }[];
  tenancy_requests: ProviderTenancyRequest[];
  tenant_access: ProviderTenantAccess[];
  tenants: ProviderTenant[];
};

export function getOrganizationPortfolio(organizationId: string) {
  return authedFetch<OrganizationPortfolio>(
    `/organizations/${organizationId}/portfolio/`,
    { cache: "no-store" },
  );
}

export type PropertyExpense = {
  id: string;
  property_id: string;
  property_title: string;
  amount_minor: number;
  amount_currency: string;
  amount_formatted: string;
  category: string;
  category_display: string;
  incurred_on: string;
  note: string;
};

export function listPropertyExpenses(organizationId: string) {
  return authedFetch<PropertyExpense[]>(`/organizations/${organizationId}/expenses/`, { cache: "no-store" });
}

export function recordPropertyExpense(organizationId: string, input: {
  property_id: string;
  amount_minor: number;
  category: string;
  incurred_on: string;
  note?: string;
}) {
  return authedFetch<PropertyExpense>(`/organizations/${organizationId}/expenses/`, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function createOrganization(input: {
  name: string;
  organization_type: Organization["organization_type"];
  activities: Organization["activities"];
}) {
  return authedFetch<Organization>("/organizations/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listOrganizationProperties(organizationId: string) {
  return authedFetch<Property[]>(`/organizations/${organizationId}/properties/`);
}

export function createPrivateProperty(organizationId: string, input: {
  title: string;
  property_type: string;
  address_id: string;
}) {
  return authedFetch<Property>(`/organizations/${organizationId}/properties/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createPersonalPortfolioProperty(input: {
  title: string;
  property_type: string;
  address_id: string;
}) {
  return authedFetch<Property>("/portfolio/properties/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type PropertyJoinRequest = {
  id: string;
  requester_id: string;
  requester_display: string;
  unit_id: string;
  bed_id: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  message: string;
  decision_note: string;
  lease_id: string | null;
  lease_status: Lease["status"] | null;
};

export type Bed = {
  id: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

/** The beds inside one room. Empty for a space that is let whole. */
export function listBeds(unitId: string) {
  return authedFetch<Bed[]>(`/units/${unitId}/beds/`, { cache: "no-store" });
}

export function createBed(unitId: string, input: { label: string; sort_order?: number }) {
  return authedFetch<Bed>(`/units/${unitId}/beds/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listPropertyJoinRequests(propertyId: string) {
  return authedFetch<PropertyJoinRequest[]>(`/properties/${propertyId}/join-requests/`, {
    cache: "no-store",
  });
}

export function decidePropertyJoinRequest(id: string, approved: boolean, note = "") {
  return authedFetch<PropertyJoinRequest>(`/join-requests/${id}/decision/`, {
    method: "POST",
    body: JSON.stringify({ approved, note }),
    ...idempotentMutation(),
  });
}

export function createListing(input: {
  unit_id: string;
  rent_minor: number;
  rent_period?: string;
  advance_months?: number;
  caution_months?: number;
  agency_fee_months?: number;
  headline: string;
  description: string;
  minimum_lease_months?: number;
}) {
  return authedFetch<Listing>("/me/listings/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** `publish` and `withdraw` are the two the console uses. */
export function listingAction(id: string, action: "publish" | "withdraw", reason?: string) {
  return authedFetch<Listing>(`/listings/${id}/${action}/`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function attachListingMedia(
  listingId: string,
  input: { file_id: string; is_cover?: boolean; caption?: string },
) {
  return authedFetch<ListingMedia>(`/listings/${listingId}/media/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- upload ------------------------------------------------------------------

type Presigned = {
  file_id: string;
  url: string;
  method: string;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  max_bytes: number;
};

export type StoredFile = {
  id: string;
  upload_status: string;
  scan_status: string;
  is_usable: boolean;
  rejection_reason: string;
  status_message: string;
};

/**
 * The three-step upload, done properly.
 *
 * The bytes go straight from the browser to object storage and never pass
 * through Django, which is what keeps a 4MB photo off the API's memory and
 * request timeout. The server reserves, the client PUTs or POSTs, the server
 * verifies what actually arrived.
 */
export async function uploadFile(file: File, purpose: string): Promise<StoredFile> {
  const reservation = await authedFetch<Presigned>("/files/uploads/", {
    method: "POST",
    body: JSON.stringify({
      purpose,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    }),
  });

  // A POST policy carries form fields that encode the size limit, so storage
  // itself rejects an oversized file. Order matters: the file goes last.
  const body = new FormData();
  for (const [key, value] of Object.entries(reservation.fields ?? {})) {
    body.append(key, value);
  }
  body.append("file", file);

  const upload = await fetch(reservation.url, {
    method: reservation.method || "POST",
    body: reservation.method === "PUT" ? file : body,
    headers: reservation.method === "PUT" ? { "Content-Type": file.type } : undefined,
  });

  if (!upload.ok) {
    throw new Error(
      `Storage refused the upload (${upload.status}). The file may be larger than allowed.`,
    );
  }

  let stored = await authedFetch<StoredFile>(`/files/uploads/${reservation.file_id}/complete/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  // Scanning is asynchronous. Poll the private metadata endpoint briefly so a
  // fast scanner does not force the person to choose the same file again.
  for (let attempt = 0; attempt < 20 && !stored.is_usable && !stored.rejection_reason; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    stored = await authedFetch<StoredFile>(`/files/${reservation.file_id}/`);
  }
  return stored;
}

export function updateListing(id: string, input: {
  rent_minor: number;
  advance_months: number;
  caution_months: number;
  agency_fee_months?: number;
  headline: string;
  description: string;
  minimum_lease_months?: number;
}) {
  return authedFetch<Listing>(`/me/listings/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// --- viewings ----------------------------------------------------------------

export type ViewingSlot = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  note: string;
  is_past: boolean;
};

export type ViewingDirections = {
  street: string;
  house_number: string;
  digital_address: string;
  latitude: string | null;
  longitude: string | null;
  entrance_note: string;
  building: string;
  wing: string;
};

export type Viewing = {
  id: string;
  status:
    | "requested"
    | "offered"
    | "confirmed"
    | "checked_in"
    | "attendance_pending"
    | "declined"
    | "withdrawn"
    | "cancelled"
    | "completed"
    | "tenant_no_show"
    | "host_no_show"
    | "disputed";
  status_display: string;
  listing_id: string;
  listing_headline: string;
  locality_name: string | null;
  landmark: string | null;
  photo_url: string | null;
  property_title: string | null;
  unit_label: string | null;
  rent_formatted: string | null;
  tenant_name: string;
  message: string;
  availability_note: string;
  slots: ViewingSlot[];
  confirmed_starts_at: string | null;
  is_upcoming: boolean;
  checked_in_at: string | null;
  check_in_method: "qr" | "code" | "";
  check_in: {
    state: "unavailable" | "upcoming" | "ready" | "checked_in" | "closed";
    opens_at: string | null;
    closes_at: string | null;
    checked_in_at: string | null;
    can_issue: boolean;
    can_validate: boolean;
  };
  response_note: string;
  cancelled_at: string | null;
  cancelled_by: "tenant" | "host" | null;
  cancellation_reason: string;
  cancellation_reason_display: string;
  cancellation_note: string;
  cancellation_notice_minutes: number | null;
  outcome_note: string;
  appointments: Array<{
    id: string;
    sequence: number;
    scheduled_at: string;
    duration_minutes: number;
    note: string;
    status: string;
    confirmed_at: string;
    rescheduled_at: string | null;
    rescheduled_by: "tenant" | "host" | null;
    cancelled_at: string | null;
    cancelled_by: "tenant" | "host" | null;
    cancellation_reason: string;
    cancellation_reason_display: string;
    cancellation_note: string;
    cancellation_notice_minutes: number | null;
  }>;
  attendance: {
    state: "unavailable" | "scheduled" | "awaiting_report" | "pending" | "verified" | "disputed";
    reported_by: "tenant" | "host" | null;
    reported_at: string | null;
    alleged_absent_party: "tenant" | "host" | null;
    report_note: string;
    counterparty_response: "" | "confirm" | "dispute";
    responded_at: string | null;
    response_note: string;
    dispute_status: "" | "pending" | "verified" | "disputed";
    can_report: boolean;
    can_respond: boolean;
  };
  actions: {
    can_withdraw?: boolean;
    can_decline?: boolean;
    can_reschedule?: boolean;
    can_cancel?: boolean;
    can_confirm_slot?: boolean;
    can_complete?: boolean;
  };
  tenant_follow_up: "request_home" | "save" | "report" | "not_interested" | "";
  tenant_follow_up_at: string | null;
  post_viewing: {
    available: boolean;
    selected_action: string | null;
    can_request_home: boolean;
  };
  contact: { name: string; phone: string; role: string } | null;
  viewing_directions: ViewingDirections | null;
  created_at: string;
};

/** What tenants have asked of me. `open` hides the finished ones. */
export function listHostViewings(openOnly = false) {
  return authedFetch<Viewing[]>(`/me/viewing-requests/${openOnly ? "?open=true" : ""}`);
}

export function offerSlots(
  viewingId: string,
  input: {
    slots: { starts_at: string; duration_minutes?: number; note?: string }[];
  },
) {
  return authedFetch<Viewing>(`/viewings/${viewingId}/offer/`, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function rescheduleViewing(
  viewingId: string,
  slots: { starts_at: string; duration_minutes?: number; note?: string }[],
) {
  return authedFetch<Viewing>(`/viewings/${viewingId}/reschedule/`, {
    method: "POST",
    body: JSON.stringify({ slots }),
    ...idempotentMutation(),
  });
}

export function validateViewingCheckIn(
  viewingId: string,
  input: { credential?: string; code?: string },
) {
  return authedFetch<Viewing>(`/viewings/${viewingId}/check-in/`, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function viewingAction(
  viewingId: string,
  action: "decline" | "withdraw",
  note = "",
) {
  return authedFetch<Viewing>(`/viewings/${viewingId}/${action}/`, {
    method: "POST",
    body: JSON.stringify({ note }),
    ...idempotentMutation(),
  });
}

export type ViewingCancellationReason =
  | "schedule_conflict"
  | "emergency"
  | "transportation_problem"
  | "no_longer_interested"
  | "property_unavailable"
  | "other";

export function cancelViewingAppointment(
  viewingId: string,
  input: { reason: ViewingCancellationReason; note?: string },
) {
  return authedFetch<Viewing>(`/viewings/${viewingId}/cancel/`, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function reportViewingNoShow(viewingId: string, note = "") {
  return authedFetch<Viewing>(`/viewings/${viewingId}/attendance-report/`, {
    method: "POST",
    body: JSON.stringify({ note }),
    ...idempotentMutation(),
  });
}

export function respondViewingAttendance(
  viewingId: string,
  response: "confirm" | "dispute",
  note = "",
) {
  return authedFetch<Viewing>(`/viewings/${viewingId}/attendance-response/`, {
    method: "POST",
    body: JSON.stringify({ response, note }),
    ...idempotentMutation(),
  });
}

export function recordViewingOutcome(
  viewingId: string,
  outcome: "completed",
  note = "",
) {
  return authedFetch<Viewing>(`/viewings/${viewingId}/outcome/`, {
    method: "POST",
    body: JSON.stringify({ outcome, note }),
    ...idempotentMutation(),
  });
}

// --- applications ------------------------------------------------------------

export type RentalApplication = {
  id: string;
  status: "submitted" | "under_review" | "accepted" | "rejected" | "withdrawn";
  status_display: string;
  listing_id: string;
  listing_headline: string;
  locality_name: string | null;
  /** Compared only against "active"; the full set lives in the backend. */
  listing_status: string;
  property_title: string;
  unit_label: string;
  space_type_label: string | null;
  photo_url: string | null;
  rent_formatted: string | null;
  rent_minor: number;
  advance_months_asked: number;
  advance_months_offered: number;
  advance_shortfall_months: number;
  meets_advance: boolean;
  applicant_name: string;
  applicant_phone_verified: boolean;
  tenant_id: string;
  unit_id: string;
  move_in_from: string | null;
  household_size: number | null;
  occupation: string;
  employer: string;
  income_band: string;
  guarantor_name: string;
  guarantor_phone: string;
  guarantor_relationship: string;
  message: string;
  decision_note: string;
  decided_at: string | null;
  created_at: string;
  /** Set when the agreement behind this ended. The decision stands;
   *  the claim on the Unit does not. */
  concluded_at: string | null;
};

export function listReceivedApplications(openOnly = false) {
  return authedFetch<RentalApplication[]>(
    `/me/received-applications/${openOnly ? "?open=true" : ""}`,
  );
}

export function applicationAction(
  id: string,
  action: "review" | "accept" | "reject",
  note = "",
) {
  return authedFetch<RentalApplication>(`/applications/${id}/${action}/`, {
    method: "POST",
    body: JSON.stringify({ note }),
    ...idempotentMutation(),
  });
}

// --- notifications -----------------------------------------------------------

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  target_type: string;
  target_id: string;
  read_at: string | null;
  is_read: boolean;
  created_at: string;
};

export function listNotifications() {
  return authedFetch<{ unread_count: number; results: Notification[] }>(
    "/me/notifications/",
  );
}

export function markNotificationsRead(ids?: string[]) {
  return authedFetch<{ marked: number; unread_count: number }>(
    "/me/notifications/read/",
    { method: "POST", body: JSON.stringify(ids ? { ids } : {}) },
  );
}

// --- leases ------------------------------------------------------------------

export type Lease = {
  id: string;
  workflow_version: "legacy" | "canonical_v1";
  status: "draft" | "ready" | "offered" | "tenant_accepted" | "awaiting_activation" | "active" | "declined" | "cancelled" | "ended";
  status_display: string;
  activation_requirement: "lease_accepted" | "initial_payment";
  unit: string;
  listing: string | null;
  application: string | null;
  unit_label: string;
  property_title: string;
  locality_name: string | null;
  landlord_name: string;
  tenant_name: string;
  rent_minor: number;
  rent_currency: string;
  rent_formatted: string | null;
  rent_period: string;
  advance_months: number;
  deposit_months: number;
  agency_fee_months: number;
  advance_total_formatted: string | null;
  move_in_total_minor: number;
  move_in_total_formatted: string | null;
  starts_on: string;
  term_months: number;
  ends_on: string | null;
  conditions: string;
  structured_terms: LeaseStructuredTerms;
  ready_at: string | null;
  tenant_reviewed_at: string | null;
  provider_confirmed_at: string | null;
  both_accepted: boolean;
  landlord_accepted_at: string | null;
  tenant_accepted_at: string | null;
  exceeds_statutory_advance: boolean;
  statutory_advance_limit_months: number;
  /** Null for a whole-unit lease. Set when a bed inside the unit is let. */
  bed: string | null;
  bed_label: string | null;
  advance_notice: AdvanceNotice | null;
  /** Null for a lease offered before agreements were recorded. */
  agreement: LeaseAgreement | null;
  builder_preview: { rendered_document: RenderedAgreement; rendered_text: string } | null;
  decline_reason: string;
  created_at: string;
};

/** What the product says about the advance on this agreement, if anything.
 *
 * The wording comes from the server so that the one place it is decided is the
 * one place a lawyer has to review. Clients render `message`; they do not
 * compose their own. */
export type AdvanceNotice = {
  stance: "allow" | "warn" | "block";
  months: number;
  threshold_months: number;
  message: string;
  requires_acknowledgement: boolean;
};

/** The executed record: what was agreed, and who accepted it.
 *
 * Not a signature. `content_hash` lets the interface show that the terms on
 * screen are the ones that were accepted; it makes no legal claim. */
export type LeaseAgreement = {
  content_hash: string;
  schema_version: string;
  /** The immutable offer snapshot whose canonical bytes produced content_hash. */
  terms: {
    schema_version: string;
    lease_id: string;
    property: { id: string; title: string; address: string };
    space: {
      unit_id: string;
      unit_label: string;
      space_type: string;
      bed_id: string | null;
      bed_label: string | null;
    };
    parties: {
      landlord: { id: string; name: string };
      tenant: { id: string; name: string };
    };
    money: {
      rent_minor: number;
      rent_currency: string;
      rent_period: string;
      advance_months: number;
      deposit_months: number;
      agency_fee_months: number;
      move_in_total_minor: number;
    };
    term: {
      starts_on: string | null;
      ends_on: string | null;
      term_months: number;
    };
    conditions: string;
    negotiated?: LeaseStructuredTerms;
    template?: { code: string; version: string; review_status: string } | null;
  };
  hash_scope: "terms_json" | "rendered_document";
  reference_number: string | null;
  template: { code: string; version: string; review_status: string };
  rendered_document: RenderedAgreement;
  rendered_text: string;
  executed_at: string | null;
  final_pdf_hash: string;
  final_pdf_url: string | null;
  advance_stance: string;
  advance_acknowledged: boolean;
  accepted_by: {
    party: "landlord" | "tenant";
    name: string;
    accepted_at: string;
    method: string;
  }[];
};

export type LeaseStructuredTerms = {
  payment_due?: string;
  utilities?: Record<string, "tenant" | "provider" | "included" | "shared" | "not_applicable">;
  occupants?: { name: string; relationship?: string }[];
  provider_responsibilities?: string[];
  tenant_responsibilities?: string[];
  notice_channels?: ("Rooomly" | "email" | "SMS" | "written notice")[];
  additional_terms?: { title: string; body: string }[];
};

export type RenderedAgreement = {
  title: string;
  reference_number: string;
  production_notice?: string;
  template: { code: string; version: string; review_status: string };
  sections: { key: string; title: string; body: string; kind?: string }[];
};

export function listGrantedLeases() {
  return authedFetch<Lease[]>("/me/granted-leases/");
}

export function draftLease(input: {
  workflow_version?: "legacy" | "canonical_v1";
  unit_id: string;
  /** Let a bed rather than the whole unit. Omit for a whole-unit lease. */
  bed_id?: string;
  tenant_id: string;
  application_id?: string;
  listing_id?: string;
  join_request_id?: string;
  rent_minor: number;
  advance_months: number;
  deposit_months: number;
  agency_fee_months: number;
  starts_on: string;
  term_months: number;
  conditions?: string;
  structured_terms?: LeaseStructuredTerms;
}) {
  return authedFetch<Lease>("/me/leases/", {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function leaseAction(
  id: string,
  action: "ready" | "offer" | "review" | "accept" | "decline" | "confirm" | "cancel" | "end",
  reason = "",
  confirmed = false,
) {
  return authedFetch<Lease>(`/leases/${id}/${action}/`, {
    method: "POST",
    body: JSON.stringify({ reason, confirmed }),
    ...idempotentMutation(),
  });
}

export function updateLease(id: string, input: Partial<{
  rent_minor: number;
  rent_currency: string;
  rent_period: "monthly" | "yearly";
  advance_months: number;
  deposit_months: number;
  agency_fee_months: number;
  starts_on: string;
  term_months: number;
  conditions: string;
  structured_terms: LeaseStructuredTerms;
}>) {
  return authedFetch<Lease>(`/leases/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function getLeaseDocument(id: string) {
  return authedBlob(`/leases/${id}/document.pdf?disposition=inline`);
}

// --- provider standing -------------------------------------------------------

export type ProviderStanding = {
  exists: boolean;
  verification_status:
    | "not_started"
    | "pending"
    | "needs_more_info"
    | "approved"
    | "rejected"
    | "revoked"
    | "expired"
    | null;
  onboarding_complete: boolean;
  workspace_access: boolean;
  can_create_property: boolean;
};

/** The account-level question: may this person operate as a provider at all. */
export function getProviderStanding() {
  return authedFetch<ProviderStanding>("/me/provider-verification/");
}

export function submitProviderVerification(
  documents: { file_id: string; evidence_type: string }[],
) {
  return authedFetch<ProviderStanding>("/me/provider-verification/", {
    method: "POST",
    body: JSON.stringify({ documents }),
  });
}

// --- own account -------------------------------------------------------------

/** The fields a person may change about themselves. */
export function updateProfile(input: {
  first_name?: string;
  last_name?: string;
  preferred_name?: string;
  email?: string | null;
}) {
  return authedFetch<unknown>("/me/", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type ProfileDetail = {
  avatar_url: string | null;
  completeness: number;
  bio: string;
};

/**
 * Attach a profile photo, or remove the one there.
 *
 * Two steps, not one: the bytes go to storage through `uploadFile` — the same
 * path every other file takes, so a photo gets the same virus scan and size
 * limits — and then the resulting file id is linked here. Passing null removes
 * the photo.
 *
 * The server checks the file belongs to the signed-in person before linking it.
 * That check is not decoration: a file id is guessable like any identifier, and
 * without it somebody could point their picture at another account's upload.
 */
export function setProfilePhoto(fileId: string | null) {
  return authedFetch<ProfileDetail>("/me/profile/", {
    method: "PATCH",
    body: JSON.stringify({ avatar_file_id: fileId }),
  });
}

export type NotificationPreferences = {
  sms_enabled: boolean;
  push_enabled: boolean;
  sms_important_only: boolean;
};

export function getNotificationPreferences() {
  return authedFetch<NotificationPreferences>("/me/notification-preferences/", { cache: "no-store" });
}

export function updateNotificationPreferences(input: Partial<NotificationPreferences>) {
  return authedFetch<NotificationPreferences>("/me/notification-preferences/", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type SignedInDevice = {
  id: string;
  device_label: string;
  client: string;
  issued_at: string;
  last_used_at: string | null;
  is_current: boolean;
};

export function listSignedInDevices() {
  return authedFetch<SignedInDevice[]>("/me/sessions/", { cache: "no-store" });
}

export function endSignedInDevice(sessionId: string) {
  return authedFetch<void>(`/me/sessions/${sessionId}/`, { method: "DELETE" });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return authedFetch<{ changed: boolean }>("/me/password/", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export type OwnVerification = {
  id: string;
  kind: string;
  status: string;
  state: "verified" | "pending" | "unverified" | "expired";
  decision_note: string;
};

export function listMyVerifications() {
  return authedFetch<{ verifications: OwnVerification[] }>("/trust/verifications/");
}

/**
 * Start a check about yourself, then attach what it rests on.
 *
 * Two calls because a verification and its evidence are separate records: the
 * decision has to remain re-examinable against exactly what was submitted, and
 * a `needs_more_info` check is continued by adding evidence to the row that
 * already exists rather than opening a second one.
 */
export function startVerification(kind: string, method = "document_review") {
  return authedFetch<{ id: string }>("/trust/verifications/", {
    method: "POST",
    body: JSON.stringify({ kind, method }),
  });
}

export function attachVerificationEvidence(
  verificationId: string,
  input: { evidence_type: string; file_id: string; national_id?: string },
) {
  return authedFetch<unknown>(`/trust/verifications/${verificationId}/evidence/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ---------------------------------------------------------------- billing --

  What a Portfolio is entitled to, and what it would get on another plan.

  Two calls, deliberately. The catalogue is the same for everybody and carries
  the names and grouping of every entitlement, so no screen hardcodes the word
  "Properties" or decides which section a capability belongs to. The snapshot is
  this Portfolio's own state. Renaming an entitlement or moving it between plans
  stays a backend change.

  Neither is authority. Every limit here is checked again on the server inside
  the transaction that takes the slot — these types exist to render a page, not
  to decide whether a write is allowed.
*/

export type EntitlementValue = { value: number | boolean | null; unlimited: boolean };

export type EntitlementMeta = {
  key: string;
  group: string;
  name: string;
  description: string;
  value_type: "integer" | "boolean";
};

export type PlanSummary = {
  code: "FREE" | "PRO" | "BUSINESS";
  name: string;
  description: string;
  monthly_price_minor: number;
  annual_price_minor: number;
  currency: string;
  entitlements: Record<string, EntitlementValue>;
};

export type PlanCatalogue = {
  entitlements: EntitlementMeta[];
  groups: string[];
  headline_limits: string[];
  upgrade_order: string[];
  plans: PlanSummary[];
};

export type PortfolioBilling = {
  plan: {
    code: string;
    name: string;
    description: string;
    monthly_price_minor: number;
    currency: string;
  };
  subscription: {
    status: string;
    billing_interval: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  entitlements: Record<string, EntitlementValue & { source: string }>;
  usage: Record<string, number>;
  limits: Record<string, number | null>;
  over_limit: Array<{ entitlement: string; current: number; limit: number }>;
};

export function getPlanCatalogue() {
  return authedFetch<PlanCatalogue>("/plans/", { cache: "no-store" });
}

export function getPortfolioBilling(organizationId: string) {
  return authedFetch<PortfolioBilling>(`/organizations/${organizationId}/billing/`, {
    cache: "no-store",
  });
}
