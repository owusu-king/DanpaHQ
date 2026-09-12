/**
 * Applying for a place.
 *
 * `advance_shortfall_months` is the field this whole screen is built around: a
 * tenant who can raise six months against a listing asking twelve needs to know
 * before they invest hope in it, and the landlord needs to know before they
 * spend a viewing on it.
 */

import { apiFetch, idempotentMutation, scopeQuery, type PortfolioScope } from "@/api";

export type ApplicationStatus =
  | "submitted"
  | "under_review"
  | "accepted"
  | "rejected"
  | "withdrawn";

export type IncomeBand =
  | ""
  | "under_1000"
  | "1000_3000"
  | "3000_6000"
  | "6000_10000"
  | "over_10000"
  | "prefer_not_to_say";

export type RentalApplication = {
  id: string;
  status: ApplicationStatus;
  status_display: string;
  listing_id: string;
  unit_id: string;
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
  move_in_from: string | null;
  household_size: number | null;
  occupation: string;
  employer: string;
  income_band: IncomeBand;
  guarantor_name: string;
  guarantor_phone: string;
  guarantor_relationship: string;
  message: string;
  decision_note: string;
  decided_at: string | null;
  /** Set when the agreement behind this ended. The decision stands; the
   *  claim on the Unit does not. */
  concluded_at: string | null;
  created_at: string;
};

export function listMyApplications() {
  return apiFetch<RentalApplication[]>("/me/applications/");
}

/** Applications concerning Units the current provider may manage. */
export function listReceivedApplications(openOnly = false, scope?: PortfolioScope) {
  return apiFetch<RentalApplication[]>(
    `/me/received-applications/${scopeQuery(scope, openOnly ? { open: "true" } : undefined)}`,
  );
}

export function getApplication(id: string) {
  return apiFetch<RentalApplication>(`/applications/${id}/`);
}

export function submitApplication(input: {
  listing_id: string;
  advance_months_offered: number;
  household_size?: number;
  move_in_from?: string | null;
  occupation?: string;
  employer?: string;
  income_band?: IncomeBand;
  message?: string;
  guarantor_name?: string;
  guarantor_phone?: string;
  guarantor_relationship?: string;
}) {
  return apiFetch<RentalApplication>("/me/applications/", {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export function withdrawApplication(id: string, note = "") {
  return apiFetch<RentalApplication>(`/applications/${id}/withdraw/`, {
    method: "POST",
    body: { note },
    ...idempotentMutation(),
  });
}

export function decideApplication(
  id: string,
  action: "review" | "accept" | "reject",
  note = "",
) {
  return apiFetch<RentalApplication>(`/applications/${id}/${action}/`, {
    method: "POST",
    body: { note },
    ...idempotentMutation(),
  });
}
