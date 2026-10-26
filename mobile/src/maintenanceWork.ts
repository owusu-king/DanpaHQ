/**
 * A Portfolio's repairs, read as work (owner, 2026-10-06).
 *
 * The provider's Maintenance list filed each request under "new", "in progress",
 * "waiting for tenant" or "completed" behind a Filter sheet. A landlord opens it
 * to know what has not been started, what is being fixed, and what waits on a
 * tenant to confirm — and how long each has waited. So each request resolves to
 * one lane, the step that is the provider's when there is one (in the record's
 * own words), and how many of the four stops it has passed.
 *
 * What the provider may do is the server's answer (`permissions`); this only
 * reads it.
 */

import type { MaintenanceRequest } from "@/maintenance";

export type RepairLane = "start" | "fixing" | "confirming" | "done";

/** A repair that has waited this many days to be started or fixed is stalled. */
export const STALLED_DAYS = 3;

export function laneOf(request: Pick<MaintenanceRequest, "status">): RepairLane {
  switch (request.status) {
    case "submitted":
    case "reopened":
      return "start";
    case "in_progress":
      return "fixing";
    case "awaiting_tenant_confirmation":
      return "confirming";
    default:
      return "done";
  }
}

/** The provider's step, as the record names it. Both happen on the record. */
export function stepOf(request: MaintenanceRequest): { label: "Start work" | "Mark as fixed"; icon: "construct-outline" | "checkmark-circle-outline" } | null {
  const can = request.permissions ?? { start: false, report_fixed: false, confirm: false, reopen: false };
  if (can.start) return { label: "Start work", icon: "construct-outline" };
  if (can.report_fixed) return { label: "Mark as fixed", icon: "checkmark-circle-outline" };
  return null;
}

/**
 * How many of the four stops — reported, in progress, fixed, confirmed — are
 * done, by the same rule as the record's tracker (`maintenanceStops`): a
 * reopened request starts again at the first.
 */
export function stopsDone(request: Pick<MaintenanceRequest, "status">): number {
  if (request.status === "completed") return 4;
  if (request.status === "reopened") return 0;
  return ["submitted", "in_progress", "awaiting_tenant_confirmation"].indexOf(request.status);
}

/** Where it stands, said as what happens next. */
export function lineOf(request: Pick<MaintenanceRequest, "status" | "reopen_count">): string {
  switch (request.status) {
    case "submitted":
      return "Reported — not started";
    case "reopened":
      return request.reopen_count > 1 ? `Reopened ${request.reopen_count} times — still not fixed` : "Reopened — the tenant says it is not fixed";
    case "in_progress":
      return "Being fixed";
    case "awaiting_tenant_confirmation":
      return "Fixed — waiting for the tenant to confirm";
    default:
      return "Confirmed fixed";
  }
}

export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

export type RepairWork = Record<RepairLane, MaintenanceRequest[]>;

/** Longest wait first while there is work to do; newest first once it is done. */
export function repairWork(requests: readonly MaintenanceRequest[]): RepairWork {
  const lanes: RepairWork = { start: [], fixing: [], confirming: [], done: [] };
  for (const request of requests) lanes[laneOf(request)].push(request);
  const oldest = (a: MaintenanceRequest, b: MaintenanceRequest) => a.status_changed_at.localeCompare(b.status_changed_at);
  lanes.start.sort(oldest);
  lanes.fixing.sort(oldest);
  lanes.confirming.sort(oldest);
  lanes.done.sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
  return lanes;
}

/**
 * The same four stops read from the tenant's side (owner, 2026-10-06): a fix to
 * confirm is theirs and leads; what their landlord has not started yet, then
 * what is being fixed, wait on somebody else.
 */
export type TenantLane = "confirm" | "sent" | "fixing" | "done";

export function tenantLaneOf(request: Pick<MaintenanceRequest, "status">): TenantLane {
  const lane = laneOf(request);
  return lane === "confirming" ? "confirm" : lane === "start" ? "sent" : lane === "fixing" ? "fixing" : "done";
}

/** Where it stands, said to the person who reported it. */
export function tenantLineOf(request: Pick<MaintenanceRequest, "status" | "reopen_count">): string {
  switch (request.status) {
    case "submitted":
      return "Sent — your landlord has not started yet";
    case "reopened":
      return "Sent back — your landlord has been told it is not fixed";
    case "in_progress":
      return "Your landlord is fixing it";
    case "awaiting_tenant_confirmation":
      return "Fixed, says your landlord — is it?";
    default:
      return "You confirmed it fixed";
  }
}

export type TenantRepairs = Record<TenantLane, MaintenanceRequest[]>;

/** Newest first within each lane: a tenant follows what they reported last. */
export function tenantRepairs(requests: readonly MaintenanceRequest[]): TenantRepairs {
  const lanes: TenantRepairs = { confirm: [], sent: [], fixing: [], done: [] };
  for (const request of requests) lanes[tenantLaneOf(request)].push(request);
  for (const lane of Object.values(lanes)) lane.sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
  return lanes;
}
