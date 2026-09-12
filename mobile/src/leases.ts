/**
 * Tenancy agreements, from the tenant's side.
 *
 * The only two actions here are accept and decline, and they are deliberately
 * heavy: accepting commits real money, often a year of it, and the screen says
 * so before the button.
 */

import { apiFetch, idempotentMutation, scopeQuery, type PortfolioScope } from "@/api";

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
  sections: { id: string; title: string; body: string; kind?: string }[];
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
  amount_minor: number;
  amount_currency: string;
  amount_formatted: string | null;
  amount_paid_minor: number | null;
  outstanding_minor: number;
  outstanding_formatted: string | null;
  due_on: string;
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

export function listMyLeases() {
  return apiFetch<Lease[]>("/me/leases/");
}

export function getLeaseLedger(id: string) {
  return apiFetch<LeaseLedger>(`/leases/${id}/charges/`);
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
  return apiFetch<RentPayment>("/rent/payments/", {
    method: "POST", body: input, ...idempotentMutation(),
  });
}

export function getPaymentEvidenceDownload(fileId: string) {
  return apiFetch<{ url: string; expires_in: number }>(
    `/files/${fileId}/download/?reason=rent_payment_review`,
  );
}

export function rentPaymentAction(id: string, action: "confirm" | "dispute", reason = "") {
  return apiFetch<RentPayment>(`/rent/payments/${id}/${action}/`, {
    method: "POST", body: { reason }, ...idempotentMutation(),
  });
}

export function adjustRentCharge(id: string, kind: "waive" | "write-off", amountMinor: number, reason: string) {
  return apiFetch<RentCharge>(`/rent/charges/${id}/${kind}/`, {
    method: "POST", body: { amount_minor: amountMinor, reason, confirmed: true }, ...idempotentMutation(),
  });
}

export function waiveRentCharge(id: string, amountMinor: number, reason: string) {
  return adjustRentCharge(id, "waive", amountMinor, reason);
}

export function listGrantedLeases(scope?: PortfolioScope) {
  return apiFetch<Lease[]>(`/me/granted-leases/${scopeQuery(scope)}`);
}

export function getLease(id: string) {
  return apiFetch<Lease>(`/leases/${id}/`);
}

export function draftLease(input: {
  workflow_version?: "legacy" | "canonical_v1";
  unit_id: string;
  tenant_id: string;
  bed_id?: string;
  join_request_id?: string;
  application_id?: string;
  listing_id?: string;
  rent_minor: number;
  starts_on: string;
  term_months: number;
  advance_months: number;
  deposit_months: number;
  agency_fee_months?: number;
  conditions?: string;
  structured_terms?: LeaseStructuredTerms;
}) {
  return apiFetch<Lease>("/me/leases/", {
    method: "POST",
    body: input,
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
  return apiFetch<Lease>(`/leases/${id}/`, {
    method: "PATCH", body: input, ...idempotentMutation(),
  });
}

export function leaseAction(id: string, action: "ready" | "offer" | "review" | "confirm") {
  return apiFetch<Lease>(`/leases/${id}/${action}/`, {
    method: "POST", body: {}, ...idempotentMutation(),
  });
}

export function offerLease(id: string) {
  return leaseAction(id, "offer");
}

export function cancelLease(id: string, reason = "") {
  return apiFetch<Lease>(`/leases/${id}/cancel/`, {
    method: "POST",
    body: { reason },
    ...idempotentMutation(),
  });
}

export function acceptLease(id: string, acknowledged = false) {
  return apiFetch<Lease>(`/leases/${id}/accept/`, {
    method: "POST",
    body: { acknowledged },
    ...idempotentMutation(),
  });
}

export function declineLease(id: string, reason = "") {
  return apiFetch<Lease>(`/leases/${id}/decline/`, {
    method: "POST",
    body: { reason },
    ...idempotentMutation(),
  });
}

export function endLease(id: string, reason = "", confirmed = false) {
  return apiFetch<Lease>(`/leases/${id}/end/`, {
    method: "POST",
    body: { reason, confirmed },
    ...idempotentMutation(),
  });
}
