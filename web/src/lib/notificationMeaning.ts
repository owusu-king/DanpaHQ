/**
 * The presentation meaning of a notification.
 *
 * The backend emits many event kinds and the old feed rendered every one of
 * them identically. This module translates those domain events into the small,
 * stable vocabulary a person needs to scan Updates: source, category, semantic
 * tone and whether it currently appears to need their attention.
 *
 * Actionability is a property of the kind alone, because each kind is emitted to
 * exactly one side of the relationship. `viewing.requested` only ever reaches the
 * host; `lease.offered` only ever reaches the tenant. There is no case where the
 * same kind means "your turn" for one recipient and "for your information" for
 * another, so nothing here has to know who is reading.
 *
 * This is presentation only; it does not invent a second notification or domain
 * lifecycle. Mirrored in `mobile/src/notificationMeaning.ts`, held in step by
 * `notificationMeaning.mirror.test.mjs`.
 */

/** Kinds that asked the recipient to do something. */
const WANTS_A_REPLY = new Set([
  "viewing.requested",
  "viewing.slots_offered",
  "viewing.checkin_available",
  "viewing.attendance_reported",
  "tenancy_request.created",
  "application.submitted",
  "lease.offered",
  "organization.invitation_created",
  "payment.failed",
  "rent.payment_due_soon",
  "rent.payment_due_now",
  "rent.payment_overdue",
  "rent.external_payment_recorded",
  "maintenance.submitted",
  "maintenance.awaiting_confirmation",
  "maintenance.reopened",
]);

export function wantsAReply(kind: string): boolean {
  return WANTS_A_REPLY.has(kind);
}

/**
 * Whether this one is still waiting on the person reading it.
 *
 * `read_at` is the only signal the record carries — a notification does not know
 * whether the viewing was answered afterwards. Unread-and-actionable is the
 * honest proxy, and it clears itself the moment the row is opened. Home is what
 * actually knows what is outstanding; this never claims to.
 */
export function needsYou(item: { kind: string; is_read: boolean }): boolean {
  return !item.is_read && wantsAReply(item.kind);
}

export type NotificationCategory = "rental" | "applications" | "payments" | "system";
export type NotificationTone = "action" | "success" | "warning" | "critical" | "info" | "neutral";

const SUCCESS = new Set([
  "viewing.confirmed",
  "viewing.checked_in",
  "viewing.attendance_responded",
  "application.accepted",
  "lease.activated",
  "payment.succeeded",
  "rent.external_payment_confirmed",
  "billing.subscription_payment_succeeded",
  "organization.invitation_accepted",
  "maintenance.completed",
]);

const WARNING = new Set([
  "viewing.declined",
  "viewing.cancelled",
  "application.rejected",
  "lease.declined",
  "rent.payment_due_soon",
  "rent.payment_due_now",
]);

const CRITICAL = new Set([
  "payment.failed",
  "rent.payment_overdue",
  "rent.external_payment_disputed",
  "billing.subscription_payment_failed",
]);

/** A small, stable navigation vocabulary over the backend's event kinds. */
export function notificationCategory(kind: string): NotificationCategory {
  if (kind.startsWith("application.") || kind.startsWith("tenancy_request.") || kind.startsWith("property_invitation.")) {
    return "applications";
  }
  if (kind.startsWith("payment.") || kind.startsWith("rent.") || kind.startsWith("billing.")) {
    return "payments";
  }
  if (kind.startsWith("organization.")) return "system";
  return "rental";
}

/** The human context shown before the message, not an internal event name. */
export function notificationSource(kind: string): string {
  if (kind.startsWith("viewing.")) return "Viewings";
  if (kind.startsWith("application.")) return "Applications";
  if (kind.startsWith("tenancy_request.") || kind.startsWith("property_invitation.")) return "Rental requests";
  if (kind.startsWith("lease.")) return "Agreements";
  if (kind.startsWith("rent.") || kind.startsWith("payment.")) return "Payments";
  if (kind.startsWith("billing.")) return "Plan & billing";
  if (kind.startsWith("organization.")) return "Portfolio";
  if (kind.startsWith("maintenance.")) return "Maintenance";
  return "Danpa HQ";
}

/** Meaning comes from the event; action remains the honest unread proxy above. */
export function notificationTone(item: { kind: string; is_read: boolean }): NotificationTone {
  if (CRITICAL.has(item.kind)) return "critical";
  if (needsYou(item)) return "action";
  if (SUCCESS.has(item.kind)) return "success";
  if (WARNING.has(item.kind)) return "warning";
  if (item.kind.endsWith(".ended") || item.kind.endsWith(".withdrawn")) return "neutral";
  return "info";
}

export function notificationStatus(item: { kind: string; is_read: boolean }): string {
  if (needsYou(item)) return "Action needed";
  if (!item.is_read) return "Unread";
  const tone = notificationTone(item);
  if (tone === "success") return "Completed";
  if (tone === "critical" || tone === "warning") return "Important";
  return "Read";
}

/**
 * Where a notification points.
 *
 * Every target type the backend emits is listed. The previous table covered four
 * and sent the rest to the properties list, so a Portfolio invitation — the one
 * notification a person genuinely cannot act on anywhere else — landed on
 * inventory. `listing` was in the table and is never emitted.
 */
export function destination(item: { target_type: string; target_id: string }): string {
  switch (item.target_type) {
    case "viewing":
      return "/viewings";
    case "sale_enquiry":
      return `/record/enquiry?id=${item.target_id}`;
    case "application":
    case "property_join_request":
      return "/applications";
    case "lease":
      return "/leases";
    case "payment":
      return "/payments";
    case "property":
      return `/record/property?id=${item.target_id}`;
    case "organization":
      return "/settings/team";
    case "portfolio_invitation":
      return "/portfolio-invitations";
    case "billing":
      return "/settings/billing";
    case "maintenance_request":
      return `/maintenance?request=${item.target_id}`;
    default:
      return "/home";
  }
}
