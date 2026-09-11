import { apiFetch, idempotentMutation } from "@/api";
import type { AccessCodeState, ConditionState, PermittedAction, PropertyVerification } from "@/provider";

export type Organization = {
  id: string;
  name: string;
  organization_type: "individual_owner" | "property_company" | "property_manager" | "hostel_operator";
  activities: ("residential" | "commercial" | "hostel")[];
  current_user_role: "owner" | "admin" | "property_manager" | "accountant" | "staff";
};

export type ManagedProperty = {
  id: string;
  title: string;
  property_type: string;
  /** Where the property stands, as one answer over both of its reviews.
   *
   *  This list served `authority_state` and `condition_state` side by side and
   *  the two together could not say what the property was *doing* — a property
   *  half-created and one waiting on a reviewer both read as "not confirmed",
   *  and the action under them said "Finish the photos" either way. The
   *  endpoint has served this since the combined state landed; the list simply
   *  did not read it. See `apps/property/verification.py`. */
  verification: PropertyVerification;
  /** What this person may do to it, decided by the backend (ADR 0021). */
  permitted_actions: Record<string, PermittedAction>;
  /** Kept for older builds. `verification.authority.state` is the fuller one. */
  authority_state: string;
  /** Kept for older builds. `verification.photos.state` is the fuller one. */
  condition_state: ConditionState;
  capabilities: Record<
    "private_inventory" | "tenant_access" | "leases" | "payment_collection" | "publication",
    { allowed: boolean; state: "enabled" | "verification_required" | "not_authorized"; missing: string[] }
  >;
  unit_count: number;
  building_count: number;
  bed_count: number;
  occupied_unit_count: number;
  vacant_unit_count: number;
  /** The one photograph a row shows. The Property's own if it has one, else a
   *  photograph from one of its Units — nothing uploads Property photos yet. */
  cover_url: string | null;
  address: { locality_name: string; district_name: string };
};

export function listOrganizations() {
  return apiFetch<Organization[]>("/organizations/");
}

export function getOrganization(organizationId: string) {
  return apiFetch<Organization>(`/organizations/${organizationId}/`);
}

export function updateOrganization(
  organizationId: string,
  input: Partial<Pick<Organization, "name" | "organization_type" | "activities">>,
) {
  return apiFetch<Organization>(`/organizations/${organizationId}/`, { method: "PATCH", body: input });
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
  return apiFetch<PayoutDestinationState>(`/organizations/${organizationId}/payout-destination/`);
}

export function refreshPayoutVerification(organizationId: string, profileId?: string) {
  return apiFetch<PayoutDestinationState>(
    profileId
      ? `/organizations/${organizationId}/payout-destinations/${profileId}/refresh/`
      : `/organizations/${organizationId}/payout-destination/refresh/`,
    { method: "POST", body: {} },
  );
}

export function activatePayoutDestination(organizationId: string, profileId: string) {
  return apiFetch<PayoutDestinationState>(
    `/organizations/${organizationId}/payout-destinations/${profileId}/activate/`,
    { method: "POST", body: {} },
  );
}

export function removePayoutDestination(organizationId: string, profileId: string) {
  return apiFetch<PayoutDestinationState>(
    `/organizations/${organizationId}/payout-destinations/${profileId}/`,
    { method: "DELETE" },
  );
}

export function listPayoutInstitutions(organizationId: string, method: PayoutMethod) {
  return apiFetch<{ results: PayoutInstitution[] }>(
    `/organizations/${organizationId}/payout-institutions/?method=${method}`,
  ).then((response) => response.results);
}

export function resolvePayoutAccount(
  organizationId: string,
  input: { method: PayoutMethod; bank_code: string; account_number: string },
) {
  return apiFetch<{ account_name: string; masked_account: string }>(
    `/organizations/${organizationId}/payout-destination/resolve/`,
    { method: "POST", body: input },
  );
}

export function provisionPayoutDestination(
  organizationId: string,
  input: { method: PayoutMethod; bank_code: string; account_number: string },
) {
  return apiFetch<PayoutDestinationState>(
    `/organizations/${organizationId}/payout-destination/`,
    { method: "POST", body: input, ...idempotentMutation() },
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
  assigned_properties: { id: string; title: string }[];
  effective_access: "portfolio_wide" | "assigned_financial" | "assigned_properties";
};

export type PortfolioInvitation = {
  id: string;
  portfolio: { id: string; name: string; type: Organization["organization_type"] };
  invitee_phone: string;
  role: PortfolioMember["role"];
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  invited_by_name: string;
  properties: { id: string; title: string }[];
  expires_at: string;
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
  return apiFetch<PortfolioMember[]>(`/organizations/${organizationId}/memberships/`);
}

export function listPortfolioInvitations(organizationId: string) {
  return apiFetch<PortfolioInvitation[]>(`/organizations/${organizationId}/invitations/`);
}

export function listMyPortfolioInvitations() {
  return apiFetch<PortfolioInvitation[]>("/me/portfolio-invitations/");
}

export function invitePortfolioMember(
  organizationId: string,
  input: { phone: string; role: PortfolioMember["role"]; property_ids: string[] },
) {
  return apiFetch<PortfolioInvitation>(`/organizations/${organizationId}/invitations/`, {
    method: "POST", body: input,
  });
}

export function respondToPortfolioInvitation(
  invitationId: string,
  decision: "accept" | "decline",
  token: string,
) {
  return apiFetch(`/portfolio-invitations/${invitationId}/${decision}/`, {
    method: "POST", body: { token },
  });
}

export function revokePortfolioInvitation(organizationId: string, invitationId: string) {
  return apiFetch(`/organizations/${organizationId}/invitations/${invitationId}/revoke/`, {
    method: "POST", body: {},
  });
}

export function changePortfolioMemberRole(
  organizationId: string,
  membershipId: string,
  role: PortfolioMember["role"],
) {
  return apiFetch<PortfolioMember>(`/organizations/${organizationId}/memberships/${membershipId}/`, {
    method: "PATCH", body: { role },
  });
}

export function removePortfolioMember(organizationId: string, membershipId: string) {
  return apiFetch(`/organizations/${organizationId}/memberships/${membershipId}/`, {
    method: "DELETE", body: { reason: "Access revoked by a Portfolio administrator." },
  });
}

export function listPortfolioAssignments(organizationId: string) {
  return apiFetch<PropertyAssignment[]>(`/organizations/${organizationId}/property-assignments/`);
}

export function assignPortfolioProperty(organizationId: string, membershipId: string, propertyId: string) {
  return apiFetch<PropertyAssignment>(`/organizations/${organizationId}/property-assignments/`, {
    method: "POST", body: { membership_id: membershipId, property_id: propertyId },
  });
}

export function unassignPortfolioProperty(organizationId: string, assignmentId: string) {
  return apiFetch(`/organizations/${organizationId}/property-assignments/${assignmentId}/`, {
    method: "DELETE", body: {},
  });
}

export type PortfolioSummary = {
  organization: { id: string; name: string };
  counts: {
    properties: number;
    units: number;
    occupied_units: number;
    vacant_units: number;
    active_tenants: number;
    active_leases: number;
    pending_invitations: number;
    pending_join_requests: number;
    maintenance_alerts: number | null;
  };
  /** Confirmed collection and still-owed rent by period. Same payload the web
   *  dashboard charts; the endpoint already sent it. */
  rent_collection: {
    currency: "GHS";
    monthly: { period: string; collected_minor: number; outstanding_minor: number }[];
    yearly: { period: string; collected_minor: number; outstanding_minor: number }[];
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
  verification: {
    tenant_access_ready: number;
    payments_ready: number;
    properties_total: number;
  };
  tenants: {
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
    lease_status: string | null;
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
  }[];
  tenancy_requests: {
    id: string;
    requester_id: string;
    requester_display: string;
    property_id: string;
    property_title: string;
    unit_id: string;
    unit_label: string;
    bed_id: string | null;
    bed_label: string | null;
    status: "pending" | "approved";
    message: string;
    decision_note: string;
    lease_id: string | null;
    lease_status: "draft" | "offered" | "awaiting_activation" | "active" | "declined" | "cancelled" | "ended" | null;
    created_at: string;
    can_manage: boolean;
  }[];
  tenant_access: {
    property_id: string;
    property_title: string;
    unit_id: string;
    unit_label: string;
    condition_state: ConditionState;
    availability: { state: "available" | "occupied" | "expired"; label: string };
    access_code: AccessCodeState;
    can_manage: boolean;
  }[];
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
};

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

export function createOrganization(input: {
  name: string;
  organization_type: Organization["organization_type"];
  activities: Organization["activities"];
}) {
  return apiFetch<Organization>("/organizations/", { method: "POST", body: input });
}

export function listOrganizationProperties(organizationId: string) {
  return apiFetch<ManagedProperty[]>(`/organizations/${organizationId}/properties/`);
}

export function createPrivateProperty(organizationId: string, input: {
  title: string;
  property_type: string;
  address_id: string;
}) {
  return apiFetch<ManagedProperty>(`/organizations/${organizationId}/properties/`, {
    method: "POST",
    body: input,
  });
}

export function createPersonalPortfolioProperty(input: {
  title: string;
  property_type: string;
  address_id: string;
}) {
  return apiFetch<ManagedProperty>("/portfolio/properties/", { method: "POST", body: input });
}

export function getPortfolioSummary(organizationId: string) {
  return apiFetch<PortfolioSummary>(`/organizations/${organizationId}/portfolio/`);
}

export function listPropertyExpenses(organizationId: string) {
  return apiFetch<PropertyExpense[]>(`/organizations/${organizationId}/expenses/`);
}

export function recordPropertyExpense(organizationId: string, input: {
  property_id: string;
  amount_minor: number;
  category: string;
  incurred_on: string;
  note?: string;
}) {
  return apiFetch<PropertyExpense>(`/organizations/${organizationId}/expenses/`, {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

/* Plan & billing is in `@/billing`, with the rest of the subscription client —
   checkout, plan changes and invoices — rather than beside Portfolio
   administration. */
