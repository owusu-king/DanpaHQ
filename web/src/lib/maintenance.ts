/**
 * Maintenance requests (backend `apps.maintenance`).
 *
 * A tenant reports a problem on an active tenancy with one photograph and, if
 * they like, a clip of at most five seconds; the provider starts the work and
 * reports it fixed; the tenant confirms it or reopens it. Which moves the reader
 * may make comes back from the server as `permissions` — the client never works
 * the rules out for itself.
 */

import { idempotentMutation } from "./api";
import { authedFetch } from "./auth";

export type MaintenanceStatus =
  | "submitted"
  | "in_progress"
  | "awaiting_tenant_confirmation"
  | "completed"
  | "reopened";

export type MaintenanceCategory =
  | "plumbing"
  | "electrical"
  | "water"
  | "appliance"
  | "structure"
  | "security"
  | "pests"
  | "other";

export type MaintenanceMedia = { id: string; url: string; content_type: string };

export type MaintenanceEvent = {
  id: string;
  kind: "submitted" | "started" | "fixed_reported" | "confirmed" | "reopened";
  kind_display: string;
  to_status: MaintenanceStatus;
  note: string;
  actor_name: string;
  at: string;
};

export type MaintenanceRequest = {
  id: string;
  tenancy_id: string;
  status: MaintenanceStatus;
  status_display: string;
  category: MaintenanceCategory;
  category_display: string;
  description: string;
  tenant: { id: string; name: string };
  place: {
    property_id: string;
    property_title: string;
    unit_id: string;
    unit_label: string;
    bed_label: string | null;
  };
  photo: MaintenanceMedia | null;
  video: MaintenanceMedia | null;
  video_clip_start_ms: number | null;
  video_clip_end_ms: number | null;
  reopen_count: number;
  created_at: string;
  status_changed_at: string;
  started_at: string | null;
  fixed_reported_at: string | null;
  completed_at: string | null;
  reopened_at: string | null;
  events: MaintenanceEvent[];
  /** Present on the detail and after an action. */
  permissions?: { start: boolean; report_fixed: boolean; confirm: boolean; reopen: boolean };
};

/** The longest clip a request may carry, as the backend enforces it. */
export const MAX_CLIP_MS = 5000;

export const CATEGORIES: { value: MaintenanceCategory; label: string }[] = [
  { value: "plumbing", label: "Plumbing and leaks" },
  { value: "electrical", label: "Electrical and power" },
  { value: "water", label: "Water supply" },
  { value: "appliance", label: "Appliances and fittings" },
  { value: "structure", label: "Walls, roof, doors and windows" },
  { value: "security", label: "Locks and security" },
  { value: "pests", label: "Pests" },
  { value: "other", label: "Something else" },
];

export function listMyMaintenance() {
  return authedFetch<MaintenanceRequest[]>("/me/maintenance/");
}

export function listOrganizationMaintenance(organizationId: string) {
  return authedFetch<MaintenanceRequest[]>(`/organizations/${organizationId}/maintenance/`);
}

export function getMaintenanceRequest(id: string) {
  return authedFetch<MaintenanceRequest>(`/maintenance/${id}/`);
}

export function submitMaintenanceRequest(input: {
  tenancy_id: string;
  category: MaintenanceCategory;
  description: string;
  photo_file_id: string;
  video_file_id?: string | null;
  video_duration_ms?: number | null;
}) {
  return authedFetch<MaintenanceRequest>("/me/maintenance/", {
    method: "POST",
    body: JSON.stringify(input),
    ...idempotentMutation(),
  });
}

type Move = "start" | "fixed" | "confirm" | "reopen";

export function moveMaintenanceRequest(id: string, move: Move, body: { note?: string; reason?: string } = {}) {
  return authedFetch<MaintenanceRequest>(`/maintenance/${id}/${move}/`, {
    method: "POST",
    body: JSON.stringify(body),
    ...idempotentMutation(),
  });
}

// --- meaning -----------------------------------------------------------------

export type MaintenanceTone = "waiting" | "working" | "asking" | "done" | "reopened";

/** One colour per stage, the same on both sides. */
export function maintenanceTone(status: MaintenanceStatus): MaintenanceTone {
  return {
    submitted: "waiting",
    in_progress: "working",
    awaiting_tenant_confirmation: "asking",
    completed: "done",
    reopened: "reopened",
  }[status] as MaintenanceTone;
}

/** What a stage is called, from the side reading it. */
export function maintenanceStatusLabel(status: MaintenanceStatus, side: "tenant" | "provider") {
  if (status === "awaiting_tenant_confirmation") {
    return side === "tenant" ? "Confirm the fix" : "Waiting for tenant";
  }
  return {
    submitted: side === "tenant" ? "Sent" : "New",
    in_progress: "In progress",
    completed: "Completed",
    reopened: "Reopened",
  }[status];
}

/** The four stops a request travels through, for the tracker. */
export function maintenanceStops(request: MaintenanceRequest) {
  const order: MaintenanceStatus[] = ["submitted", "in_progress", "awaiting_tenant_confirmation", "completed"];
  const reached = request.status === "reopened" ? 0 : order.indexOf(request.status);
  return [
    { key: "submitted", label: "Reported", at: request.created_at },
    { key: "in_progress", label: "In progress", at: request.started_at },
    { key: "awaiting_tenant_confirmation", label: "Fixed", at: request.fixed_reported_at },
    { key: "completed", label: "Confirmed", at: request.completed_at },
  ].map((stop, index) => ({
    ...stop,
    state: index < reached || request.status === "completed" ? "done" : index === reached ? "now" : "todo",
  }));
}
