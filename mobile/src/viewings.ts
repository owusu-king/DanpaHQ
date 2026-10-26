/**
 * Viewings, from the tenant's side.
 *
 * Exact contact/directions are released only after confirmation. Attendance
 * is then verified by one server-issued QR/code credential before completion.
 */

import { apiFetch, idempotentMutation, scopeQuery, type PortfolioScope } from "@/api";

export type ViewingSlot = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  note: string;
  is_past: boolean;
};

export type ViewingContact = {
  name: string;
  phone: string;
  role: string;
};

export type ViewingDirections = {
  street: string;
  house_number: string;
  digital_address: string;
  latitude: string | null;
  longitude: string | null;
  entrance_note: string;
  wing: string;
};

export type ViewingStatus =
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

export type ViewingCancellationReason =
  | "schedule_conflict"
  | "emergency"
  | "transportation_problem"
  | "no_longer_interested"
  | "property_unavailable"
  | "other";

export type Viewing = {
  id: string;
  status: ViewingStatus;
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
  appointments: {
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
  }[];
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
  contact: ViewingContact | null;
  viewing_directions: ViewingDirections | null;
  created_at: string;
};

export function listMyViewings() {
  return apiFetch<Viewing[]>("/me/viewings/");
}

/** Viewing requests for Properties the current provider may manage. */
export function listReceivedViewings(openOnly = false, scope?: PortfolioScope) {
  return apiFetch<Viewing[]>(
    `/me/viewing-requests/${scopeQuery(scope, openOnly ? { open: "true" } : undefined)}`,
  );
}

export function getViewing(viewingId: string) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/`);
}

export function requestViewing(input: {
  listing_id: string;
  message?: string;
  availability_note?: string;
}) {
  return apiFetch<Viewing>("/me/viewings/", {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export function confirmSlot(viewingId: string, slotId: string) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/confirm/`, {
    method: "POST",
    body: { slot_id: slotId },
    ...idempotentMutation(),
  });
}

export function offerViewingSlots(
  viewingId: string,
  input: {
    slots: { starts_at: string; duration_minutes?: number; note?: string }[];
  },
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/offer/`, {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export function rescheduleViewing(
  viewingId: string,
  slots: { starts_at: string; duration_minutes?: number; note?: string }[],
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/reschedule/`, {
    method: "POST",
    body: { slots },
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
  return apiFetch<ViewingCheckInCredential>(`/viewings/${viewingId}/check-in-credential/`, {
    method: "POST",
    body: {},
  });
}

/** QR scan and six-digit fallback deliberately share this endpoint/service. */
export function validateViewingCheckIn(
  viewingId: string,
  input: { credential?: string; code?: string },
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/check-in/`, {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export function recordPostViewingAction(
  viewingId: string,
  input: {
    action: "request_home" | "save" | "report" | "not_interested";
    report_category?: string;
    details?: string;
  },
) {
  return apiFetch<{
    action: string;
    tenancy_request_id: string | null;
    saved_listing_id: string | null;
    report_id: string | null;
  }>(`/viewings/${viewingId}/post-viewing/`, {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export function respondToViewing(
  viewingId: string,
  action: "decline" | "withdraw",
  note = "",
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/${action}/`, {
    method: "POST",
    body: { note },
    ...idempotentMutation(),
  });
}

export function recordProviderViewingOutcome(
  viewingId: string,
  outcome: "completed",
  note = "",
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/outcome/`, {
    method: "POST",
    body: { outcome, note },
    ...idempotentMutation(),
  });
}

export function cancelViewing(
  viewingId: string,
  input: { reason: ViewingCancellationReason; note?: string },
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/cancel/`, {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export function recordOutcome(
  viewingId: string,
  outcome: "completed",
  note = "",
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/outcome/`, {
    method: "POST",
    body: { outcome, note },
    ...idempotentMutation(),
  });
}

export function reportViewingNoShow(viewingId: string, note = "") {
  return apiFetch<Viewing>(`/viewings/${viewingId}/attendance-report/`, {
    method: "POST",
    body: { note },
    ...idempotentMutation(),
  });
}

export function respondViewingAttendance(
  viewingId: string,
  response: "confirm" | "dispute",
  note = "",
) {
  return apiFetch<Viewing>(`/viewings/${viewingId}/attendance-response/`, {
    method: "POST",
    body: { response, note },
    ...idempotentMutation(),
  });
}

/** "Sat 16 Aug, 2:30 pm" — the way an appointment is said out loud. */
export function formatSlot(iso: string): string {
  const when = new Date(iso);
  return when.toLocaleString("en-GH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
