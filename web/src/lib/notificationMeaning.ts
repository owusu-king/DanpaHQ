/**
 * What a notification is, in the only two categories that change how it reads.
 *
 * The backend emits 26 event kinds and the feed rendered every one of them
 * identically: a viewing request waiting for a reply looked exactly like a
 * receipt for a payment that already went through. The split below is not a
 * taxonomy for its own sake — it is the single question a person has when they
 * open Updates: *does any of this want something from me?*
 *
 * Actionability is a property of the kind alone, because each kind is emitted to
 * exactly one side of the relationship. `viewing.requested` only ever reaches the
 * host; `lease.offered` only ever reaches the tenant. There is no case where the
 * same kind means "your turn" for one recipient and "for your information" for
 * another, so nothing here has to know who is reading.
 *
 * Mirrored in `mobile/src/notificationMeaning.ts`, held in step by
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
 * `read_at` is the only signal the record carries — a notification does not know
 * whether the viewing was answered afterwards. Unread-and-actionable is the
 * honest proxy, and it clears itself the moment the row is opened. Home is what
 * actually knows what is outstanding; this never claims to.
 */
export function needsYou(item: { kind: string; is_read: boolean }): boolean {
  return !item.is_read && wantsAReply(item.kind);
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
    case "application":
    case "property_join_request":
      return "/applications";
    case "lease":
      return "/leases";
    case "payment":
      return "/payments";
    case "property":
      return `/properties/${item.target_id}`;
    case "organization":
      return "/settings/team";
    case "portfolio_invitation":
      return "/portfolio-invitations";
    default:
      return "/home";
  }
}
