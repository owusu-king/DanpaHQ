/**
 * The presentation meaning of a notification.
 *
 * See the web twin for the reasoning. Source, category, semantic tone and
 * actionability are shared; destinations are not, because the clients have
 * different route shapes and mobile splits several by workspace.
 *
 * Mirrored from `web/src/lib/notificationMeaning.ts`, held in step by
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
  "artisan.needs_info",
]);

export function wantsAReply(kind: string): boolean {
  return WANTS_A_REPLY.has(kind);
}

/**
 * Whether this one is still waiting on the person reading it.
 *
 * `read_at` is the only signal the record carries. Unread-and-actionable is the
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
  "artisan.approved",
  "artisan.reinstated",
  "artisan.certificate_verified",
]);

const WARNING = new Set([
  "viewing.declined",
  "viewing.cancelled",
  "application.rejected",
  "lease.declined",
  "rent.payment_due_soon",
  "rent.payment_due_now",
  "artisan.rejected",
  "artisan.certificate_declined",
]);

const CRITICAL = new Set([
  "payment.failed",
  "rent.payment_overdue",
  "rent.external_payment_disputed",
  "billing.subscription_payment_failed",
  "artisan.suspended",
]);

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

export function notificationSource(kind: string): string {
  if (kind.startsWith("viewing.")) return "Viewings";
  if (kind.startsWith("application.")) return "Applications";
  if (kind.startsWith("tenancy_request.") || kind.startsWith("property_invitation.")) return "Rental requests";
  if (kind.startsWith("lease.")) return "Agreements";
  if (kind.startsWith("rent.") || kind.startsWith("payment.")) return "Payments";
  if (kind.startsWith("billing.")) return "Plan & billing";
  if (kind.startsWith("organization.")) return "Portfolio";
  if (kind.startsWith("maintenance.")) return "Maintenance";
  if (kind.startsWith("artisan.")) return "Artisan work";
  return "Danpa HQ";
}

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
 * Where a notification points on this client.
 *
 * Every target type the backend emits is covered. The previous table handled
 * four and silently did nothing for the rest — tapping a Portfolio invitation,
 * a Team change or a tenancy request moved you nowhere at all.
 */
export function destination(
  item: { target_type: string; target_id: string },
  isProvider: boolean,
): { pathname: string; params?: Record<string, string> } {
  switch (item.target_type) {
    case "viewing":
      return { pathname: isProvider ? "/(app)/provider-viewings" : "/(app)/viewings" };
    case "sale_enquiry":
      return { pathname: "/(app)/enquiry/[id]", params: { id: item.target_id } };
    case "application":
    case "property_join_request":
      return { pathname: isProvider ? "/(app)/provider-applications" : "/(app)/applications" };
    case "lease":
      return { pathname: "/(app)/leases" };
    case "payment":
      return {
        pathname: isProvider ? "/(app)/(provider-tabs)/payments" : "/(app)/(tabs)/payments",
      };
    case "property":
      return { pathname: "/(app)/provider-property", params: { propertyId: item.target_id } };
    case "organization":
      return { pathname: "/(app)/team" };
    case "portfolio_invitation":
      return { pathname: "/(app)/portfolio-invitations" };
    case "billing":
      return { pathname: "/(app)/billing" };
    case "maintenance_request":
      return { pathname: "/(app)/maintenance-request", params: { id: item.target_id } };
    case "artisan_certificate":
      return { pathname: "/(app)/(artisan-tabs)/artisan-profile" };
    case "artisan_application":
      return { pathname: "/(app)/artisan-application" };
    default:
      // Whichever side the person is on. There is no standalone home route on
      // mobile: the tab groups are the home for each workspace.
      return { pathname: isProvider ? "/(app)/(provider-tabs)" : "/(app)/(tabs)" };
  }
}
