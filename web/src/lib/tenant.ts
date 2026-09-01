/**
 * The tenant's own side of the product.
 *
 * These endpoints have existed since Phase 3 and the mobile app has consumed
 * them all along; the web simply never did. Every "tenant" page on the web was
 * in fact the provider's view of the same domain — `/applications` listed
 * applications *received*, `/leases` listed leases *granted* — so a signed-in
 * tenant had no way to see their own tenancy, rent, applications or viewings at
 * all.
 *
 * Nothing here is new API surface. The shapes mirror `mobile/src/leases.ts` and
 * the mobile tenant screens, so both clients read the same contract.
 */

import { authedFetch } from "./auth";
import { idempotentMutation } from "./api";
import type {
  Lease,
  Listing,
  RentalApplication,
  Viewing,
  ViewingCancellationReason,
} from "./console";

export type Occupancy = {
  id: string;
  property_id: string;
  property_title: string;
  unit_id: string;
  unit_label: string;
  bed_id: string | null;
  bed_label: string | null;
  lease_id: string | null;
  status: string;
  starts_on: string | null;
};

export type RentCharge = {
  id: string;
  lease: string;
  kind: "advance" | "deposit" | "agency_fee" | "rent";
  kind_display: string;
  /**
   * `cancelled` covers a period that will never be lived through — the tenancy
   * ended before it, or a replacement agreement took over the term. Distinct
   * from `waived`, which is a provider forgiving a debt that exists.
   */
  status: "due" | "part_paid" | "paid" | "waived" | "written_off" | "adjusted" | "cancelled";
  status_display: string;
  effective_status: string;
  due_on: string;
  amount_minor: number;
  amount_currency: string;
  amount_formatted: string | null;
  amount_paid_minor: number | null;
  outstanding_minor: number;
  outstanding_formatted: string | null;
  is_overdue: boolean;
  days_overdue: number;
  settled_at: string | null;
  waived_reason: string;
  has_dispute: boolean;
  adjusted_minor: number;
  waived_minor: number;
  written_off_minor: number;
  adjustments: ObligationAdjustment[];
};

export type ObligationAdjustment = {
  id: string;
  obligation_id: string;
  kind: "waiver" | "write_off";
  kind_display: string;
  amount_minor: number;
  amount_currency: string;
  amount_formatted: string;
  reason: string;
  actor_id: string | null;
  actor_name: string | null;
  effective_at: string;
};

export type RentPayment = {
  id: string;
  lease: string;
  charge: string | null;
  status: "claimed" | "confirmed" | "disputed";
  status_display: string;
  verification_source: "party_confirmation" | "psp";
  source: "PLATFORM_PSP" | "EXTERNAL";
  channel: "MOBILE_MONEY" | "CARD" | "BANK_TRANSFER" | "CASH" | "OTHER";
  provider: string;
  evidence: "AWAITING_COUNTERPARTY_CONFIRMATION" | "PSP_CONFIRMED" | "COUNTERPARTY_CONFIRMED" | "DISPUTED" | "ADMIN_VERIFIED";
  lifecycle_status: "AWAITING_TENANT_CONFIRMATION" | "AWAITING_PROVIDER_CONFIRMATION" | "CONFIRMED" | "DISPUTED";
  amount_minor: number;
  amount_currency: string;
  amount_formatted: string | null;
  paid_on: string;
  method: "momo" | "cash" | "bank" | "cheque" | "other";
  method_display: string;
  reference: string;
  note: string;
  evidence_file: { id: string; name: string; content_type: string } | null;
  recorded_by_name: string;
  recorded_by_tenant: boolean;
  confirmed_at: string | null;
  is_confirmed: boolean;
  disputed_at: string | null;
  dispute_reason: string;
  awaiting_you: boolean;
  receipt_id: string | null;
  obligation_label: string;
  created_at: string;
};

export type LeaseLedger = {
  charges: RentCharge[];
  payments: RentPayment[];
  digital_payment: {
    available: boolean;
    reason: string;
    methods: ("mobile_money" | "card" | "bank_transfer")[];
    /** The server's part-payment terms, sent with the offer so a client never
     * has to infer the rule it will be judged by. `minimum_part_minor` does not
     * apply when paying the whole remaining balance. */
    allows_partial: boolean;
    minimum_part_minor: number;
    outstanding_minor: number;
    currency: string;
  };
  permissions: { record_payment: boolean; waive: boolean; write_off: boolean };
  context: {
    lease_status: string;
    lease_status_display: string;
    tenancy_id: string | null;
    tenant_name: string;
    property_title: string;
    unit_label: string;
    location: string;
    ended_on: string | null;
  };
  financial_summary: {
    is_post_tenancy: boolean;
    tenancy_ended_on: string | null;
    unpaid_rent_minor: number;
    other_charges_minor: number;
    credits_minor: number;
    refunded_minor: number;
    waived_minor: number;
    written_off_minor: number;
    outstanding_balance_minor: number;
    credit_balance_minor: number;
    currency: string;
  };
};

export type MyApplication = RentalApplication;

export type SubmitRentalApplication = {
  listing_id: string;
  advance_months_offered: number;
  move_in_from?: string | null;
  household_size?: number;
  occupation?: string;
  employer?: string;
  income_band?: string;
  guarantor_name?: string;
  guarantor_phone?: string;
  guarantor_relationship?: string;
  message?: string;
};

export type MyViewing = Viewing;

/** The shortlist embeds the whole listing, so the shared card renders it as-is. */
export type SavedListing = {
  id: string;
  listing: Listing;
  note: string;
  created_at: string;
};

/** An access request this person sent, as they read it. */
export type MyJoinRequest = {
  id: string;
  property_id: string;
  property_title: string;
  locality_name: string | null;
  unit_id: string;
  unit_label: string | null;
  bed_label: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  status_display: string;
  decision_note: string;
  decided_at: string | null;
  lease_id: string | null;
  lease_status: string | null;
  created_at: string;
};

/**
 * The access requests this person sent.
 *
 * Until now the only read was provider-scoped, so somebody who quoted an access
 * code got a success message and then silence: an approval eventually surfaced
 * as a lease offer, and a rejection surfaced as nothing at all.
 */
export function listMyJoinRequests() {
  return authedFetch<MyJoinRequest[]>("/me/join-requests/");
}

export function listMyOccupancies() {
  return authedFetch<Occupancy[]>("/me/occupancies/");
}

export function listMyLeases() {
  return authedFetch<Lease[]>("/me/leases/");
}

export function getLeaseLedger(id: string) {
  return authedFetch<LeaseLedger>(`/leases/${id}/charges/`);
}

export function recordRentPayment(input: {
  lease_id: string;
  charge_id?: string | null;
  amount_minor: number;
  amount_currency?: string;
  paid_on: string;
  method: RentPayment["method"];
  reference?: string;
  note?: string;
  evidence_file_id?: string | null;
}) {
  return authedFetch<RentPayment>("/rent/payments/", {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function getPaymentEvidenceDownload(fileId: string) {
  return authedFetch<{ url: string; expires_in: number }>(
    `/files/${fileId}/download/?reason=rent_payment_review`,
  );
}

export function rentPaymentAction(id: string, action: "confirm" | "dispute", reason = "") {
  return authedFetch<RentPayment>(`/rent/payments/${id}/${action}/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    ...idempotentMutation(),
  });
}

export function adjustRentCharge(
  id: string,
  kind: "waive" | "write-off",
  amountMinor: number,
  reason: string,
) {
  return authedFetch<RentCharge>(`/rent/charges/${id}/${kind}/`, {
    method: "POST",
    body: JSON.stringify({ amount_minor: amountMinor, reason, confirmed: true }),
    ...idempotentMutation(),
  });
}

export function waiveRentCharge(id: string, amountMinor: number, reason: string) {
  return authedFetch<RentCharge>(`/rent/charges/${id}/waive/`, {
    method: "POST",
    body: JSON.stringify({ amount_minor: amountMinor, reason, confirmed: true }),
    ...idempotentMutation(),
  });
}

export function acceptMyLease(id: string, acknowledged = false) {
  return authedFetch<Lease>(`/leases/${id}/accept/`, {
    method: "POST",
    body: JSON.stringify({ acknowledged }),
    ...idempotentMutation(),
  });
}

export function declineMyLease(id: string, reason = "") {
  return authedFetch<Lease>(`/leases/${id}/decline/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    ...idempotentMutation(),
  });
}

export function listMyApplications() {
  return authedFetch<MyApplication[]>("/me/applications/");
}

export function submitRentalApplication(input: SubmitRentalApplication) {
  return authedFetch<MyApplication>("/me/applications/", {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function withdrawMyApplication(id: string, note = "") {
  return authedFetch<MyApplication>(`/applications/${id}/withdraw/`, {
    method: "POST",
    body: JSON.stringify({ note }),
    ...idempotentMutation(),
  });
}

export function listMyViewings() {
  return authedFetch<MyViewing[]>("/me/viewings/");
}

export function confirmMyViewingSlot(viewingId: string, slotId: string) {
  return authedFetch<MyViewing>(`/viewings/${viewingId}/confirm/`, {
    method: "POST",
    body: JSON.stringify({ slot_id: slotId }),
    ...idempotentMutation(),
  });
}

export function withdrawMyViewing(viewingId: string, note = "") {
  return authedFetch<MyViewing>(`/viewings/${viewingId}/withdraw/`, {
    method: "POST",
    body: JSON.stringify({ note }),
    ...idempotentMutation(),
  });
}

export function rescheduleMyViewing(
  viewingId: string,
  slots: { starts_at: string; duration_minutes?: number; note?: string }[],
) {
  return authedFetch<MyViewing>(`/viewings/${viewingId}/reschedule/`, {
    method: "POST",
    body: JSON.stringify({ slots }),
    ...idempotentMutation(),
  });
}

export function cancelMyViewing(
  viewingId: string,
  input: { reason: ViewingCancellationReason; note?: string },
) {
  return authedFetch<MyViewing>(`/viewings/${viewingId}/cancel/`, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function reportMyViewingNoShow(viewingId: string, note = "") {
  return authedFetch<MyViewing>(`/viewings/${viewingId}/attendance-report/`, {
    method: "POST",
    body: JSON.stringify({ note }),
    ...idempotentMutation(),
  });
}

export function respondMyViewingAttendance(
  viewingId: string,
  response: "confirm" | "dispute",
  note = "",
) {
  return authedFetch<MyViewing>(`/viewings/${viewingId}/attendance-response/`, {
    method: "POST",
    body: JSON.stringify({ response, note }),
    ...idempotentMutation(),
  });
}

export type ViewingCheckInCredential = {
  qr_payload: string;
  code: string;
  expires_at: string;
  opens_at: string;
};

export function issueViewingCheckInCredential(viewingId: string) {
  return authedFetch<ViewingCheckInCredential>(
    `/viewings/${viewingId}/check-in-credential/`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export function recordPostViewingAction(
  viewingId: string,
  input: {
    action: "request_home" | "save" | "report" | "not_interested";
    report_category?: string;
    details?: string;
  },
) {
  return authedFetch<{
    action: string;
    tenancy_request_id: string | null;
    saved_listing_id: string | null;
    report_id: string | null;
  }>(`/viewings/${viewingId}/post-viewing/`, {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

export function listSavedListings() {
  return authedFetch<SavedListing[]>("/me/saved-listings/");
}

/**
 * What is owed, soonest first.
 *
 * Overdue is called out separately rather than folded into a total. A single
 * "balance" figure hides whether the money is late, and late is the part that
 * changes what someone does today.
 */
export function outstanding(charges: RentCharge[]): {
  overdue: RentCharge[];
  next: RentCharge | null;
} {
  const unpaid = charges
    .filter((charge) => charge.outstanding_minor > 0)
    .sort((a, b) => a.due_on.localeCompare(b.due_on));
  return {
    overdue: unpaid.filter((charge) => charge.is_overdue),
    next: unpaid[0] ?? null,
  };
}
