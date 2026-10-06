/**
 * Maintenance requests (backend `apps.maintenance`), as the phone reads them.
 *
 * Mirrors `web/src/lib/maintenance.ts`: the same statuses, the same words for
 * each side, the same five-second limit. Which moves the reader may make comes
 * back from the server as `permissions`; this file never works the rules out.
 */

import { apiFetch, idempotentMutation, type PortfolioScope } from "@/api";

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
  permissions?: { start: boolean; report_fixed: boolean; confirm: boolean; reopen: boolean };
};

/** The longest clip a request may carry, as the backend enforces it. */
export const MAX_CLIP_MS = 5000;

export const CATEGORIES: { value: MaintenanceCategory; label: string; icon: string }[] = [
  { value: "plumbing", label: "Plumbing and leaks", icon: "water-outline" },
  { value: "electrical", label: "Electrical and power", icon: "flash-outline" },
  { value: "water", label: "Water supply", icon: "beaker-outline" },
  { value: "appliance", label: "Appliances and fittings", icon: "tv-outline" },
  { value: "structure", label: "Walls, roof, doors and windows", icon: "home-outline" },
  { value: "security", label: "Locks and security", icon: "lock-closed-outline" },
  { value: "pests", label: "Pests", icon: "bug-outline" },
  { value: "other", label: "Something else", icon: "construct-outline" },
];

export function categoryIcon(category: MaintenanceCategory) {
  return CATEGORIES.find((row) => row.value === category)?.icon ?? "construct-outline";
}

export function listMyMaintenance() {
  return apiFetch<MaintenanceRequest[]>("/me/maintenance/");
}

export function listOrganizationMaintenance(scope: Required<PortfolioScope>) {
  return apiFetch<MaintenanceRequest[]>(`/organizations/${scope.organization}/maintenance/`);
}

export function getMaintenanceRequest(id: string) {
  return apiFetch<MaintenanceRequest>(`/maintenance/${id}/`);
}

export function submitMaintenanceRequest(input: {
  tenancy_id: string;
  category: MaintenanceCategory;
  description: string;
  photo_file_id: string;
  video_file_id?: string | null;
  video_duration_ms?: number | null;
  video_clip_start_ms?: number | null;
  video_clip_end_ms?: number | null;
}) {
  return apiFetch<MaintenanceRequest>("/me/maintenance/", {
    method: "POST",
    body: input,
    ...idempotentMutation(),
  });
}

export type MaintenanceMove = "start" | "fixed" | "confirm" | "reopen";

export function moveMaintenanceRequest(id: string, move: MaintenanceMove, body: { note?: string; reason?: string } = {}) {
  return apiFetch<MaintenanceRequest>(`/maintenance/${id}/${move}/`, {
    method: "POST",
    body,
    ...idempotentMutation(),
  });
}

// --- meaning -----------------------------------------------------------------

export type MaintenanceTone = "waiting" | "working" | "asking" | "done" | "reopened";

export function maintenanceTone(status: MaintenanceStatus): MaintenanceTone {
  return ({
    submitted: "waiting",
    in_progress: "working",
    awaiting_tenant_confirmation: "asking",
    completed: "done",
    reopened: "reopened",
  } as const)[status];
}

/** What a stage is called, from the side reading it. Same words as web. */
export function maintenanceStatusLabel(status: MaintenanceStatus, side: "tenant" | "provider") {
  if (status === "awaiting_tenant_confirmation") {
    return side === "tenant" ? "Confirm the fix" : "Waiting for tenant";
  }
  return ({
    submitted: side === "tenant" ? "Sent" : "New",
    in_progress: "In progress",
    completed: "Completed",
    reopened: "Reopened",
  } as const)[status];
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
    state: (index < reached || request.status === "completed" ? "done" : index === reached ? "now" : "todo") as "done" | "now" | "todo",
  }));
}

/** "4.8" — seconds to one decimal, for clip lengths. */
export function seconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toLocaleString("en-GH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
