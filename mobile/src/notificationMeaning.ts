/**
 * What a notification is, in the only two categories that change how it reads.
 *
 * See the web twin for the reasoning. The classification is shared; the
 * destinations are not, because the two clients have different route shapes and
 * mobile splits several of them by workspace.
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
    default:
      // Whichever side the person is on. There is no standalone home route on
      // mobile: the tab groups are the home for each workspace.
      return { pathname: isProvider ? "/(app)/(provider-tabs)" : "/(app)/(tabs)" };
  }
}
