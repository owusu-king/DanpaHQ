"""Turning domain events into messages people read.

Every handler is registered against an outbox event name and receives the whole
event, so the dedupe key can be built from the event id. That matters for the
repeatable ones: a landlord offering new times twice must produce two
notifications, while the same offer redelivered after a failure must produce
one.

Imports of domain models are function-scoped. notifications is a platform
module: everything depends on it, it depends on nothing above it.
"""

from __future__ import annotations

import logging

from apps.outbox.tasks import subscribe

from .services import notify

logger = logging.getLogger("notifications")


def _key(event, user_id: str) -> str:
    """One notification per event per recipient, however often it is retried."""
    return f"{event.id}:{user_id}"


def _viewing(payload_id):
    from apps.viewing.models import ViewingRequest

    return (
        ViewingRequest.objects.filter(id=payload_id)
        .select_related(
            "listing__unit__property__owner",
            "listing__unit__property__address__locality",
            "tenant",
            "confirmed_slot",
            "current_appointment",
        )
        .first()
    )


def _application(payload_id):
    from apps.application.models import RentalApplication

    return (
        RentalApplication.objects.filter(id=payload_id)
        .select_related("listing__unit__property__owner", "tenant")
        .first()
    )


def _where(listing) -> str:
    address = getattr(listing.unit.property, "address", None)
    locality = getattr(address, "locality", None)
    return getattr(locality, "name", "") or "your place"


@subscribe("organization.invitation_created.v1")
def on_organization_invitation_created(event) -> None:
    from django.utils import timezone

    from apps.identity.providers import get_sms_provider
    from apps.organization.models import OrganizationInvitation

    invitation = (
        OrganizationInvitation.objects.filter(id=event.aggregate_id)
        .select_related("organization", "invitee_user", "invited_by")
        .first()
    )
    if invitation is None:
        return
    if invitation.invitee_user is None:
        if invitation.sms_sent_at is not None:
            return
        try:
            result = get_sms_provider().send(
                to=invitation.invitee_phone,
                body=(
                    f"{invitation.invited_by.display_name} invited you to join "
                    f"{invitation.organization.name} on Danpa HQ as "
                    f"{invitation.get_role_display()}. Sign in or register with this number, "
                    "then open Portfolio invitations."
                ),
                reference=f"portfolio-invitation:{invitation.id}",
            )
            if result.accepted:
                invitation.sms_sent_at = timezone.now()
                invitation.sms_failed_reason = ""
                invitation.save(update_fields=["sms_sent_at", "sms_failed_reason", "updated_at"])
            else:
                invitation.sms_failed_reason = "The provider did not accept it."
                invitation.save(update_fields=["sms_failed_reason", "updated_at"])
        except Exception as exc:  # external delivery must not poison the outbox event
            logger.warning(
                "Portfolio invitation SMS failed",
                extra={"event": "portfolio_invitation_sms_failed", "error": type(exc).__name__},
            )
            invitation.sms_failed_reason = type(exc).__name__[:200]
            invitation.save(update_fields=["sms_failed_reason", "updated_at"])
        return
    notify(
        user=invitation.invitee_user,
        kind="organization.invitation_created",
        title=f"Join {invitation.organization.name}",
        body=(
            f"{invitation.invited_by.display_name} invited you to their Portfolio as "
            f"{invitation.get_role_display()}. Review it in Team invitations."
        ),
        dedupe_key=_key(event, invitation.invitee_user_id),
        target_type="portfolio_invitation",
        target_id=invitation.id,
    )


@subscribe("organization.invitation_accepted.v1")
def on_organization_invitation_accepted(event) -> None:
    from apps.organization.models import OrganizationInvitation

    invitation = (
        OrganizationInvitation.objects.filter(id=event.aggregate_id)
        .select_related("organization", "invitee_user", "invited_by")
        .first()
    )
    if invitation is None or invitation.invitee_user is None:
        return
    notify(
        user=invitation.invited_by,
        kind="organization.invitation_accepted",
        title="A Portfolio invitation was accepted",
        body=(
            f"{invitation.invitee_user.display_name} joined {invitation.organization.name} "
            f"as {invitation.get_role_display()}."
        ),
        dedupe_key=_key(event, invitation.invited_by_id),
        target_type="organization",
        target_id=invitation.organization_id,
    )


@subscribe("property_invitation.accepted.v1")
def on_property_invitation_accepted(event) -> None:
    """Tell the provider when a private acquisition is ready for a lease.

    Both prospective and already-occupying people still need a Danpa HQ lease.
    Acceptance therefore always leaves the provider with an offer to prepare.
    """
    from apps.occupancy.models import PropertyInvitation

    invitation = (
        PropertyInvitation.objects.filter(id=event.aggregate_id)
        .select_related("created_by", "invitee_user", "unit__property")
        .first()
    )
    if invitation is None or invitation.invitee_user is None:
        return
    notify(
        user=invitation.created_by,
        kind="property_invitation.accepted",
        title="A prospective tenant accepted your invitation",
        body=(
            f"{invitation.invitee_user.display_name} is interested in "
            f"{invitation.unit.property.title} — {invitation.unit.label}. "
            "Prepare and send the lease for their review."
        ),
        dedupe_key=_key(event, invitation.created_by_id),
        target_type="property",
        target_id=invitation.property_id,
    )


# --- viewings ----------------------------------------------------------------


@subscribe("viewing.requested.v1")
def on_viewing_requested(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    host = viewing.responded_by or viewing.listing.created_by
    notify(
        user=host,
        kind="viewing.requested",
        title="Someone wants to see your place",
        body=f"{viewing.tenant.display_name} asked to view {viewing.listing.headline}. "
        "Offer them some times.",
        dedupe_key=_key(event, host.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.slots_offered.v1")
def on_slots_offered(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    notify(
        user=viewing.tenant,
        kind="viewing.slots_offered",
        title="Times offered for a viewing",
        body=(
            f"{viewing.listing.headline} in {_where(viewing.listing)}. "
            "Pick a time that works. Danpa HQ viewings are free."
        ),
        dedupe_key=_key(event, viewing.tenant_id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.confirmed.v1")
def on_viewing_confirmed(event) -> None:
    """Both sides. Somebody has to be somewhere at a time now."""
    viewing = _viewing(event.aggregate_id)
    if viewing is None or viewing.confirmed_slot is None:
        return

    when = viewing.confirmed_slot.starts_at.strftime("%a %d %b at %H:%M")
    host = viewing.responded_by or viewing.listing.created_by

    notify(
        user=viewing.tenant,
        kind="viewing.confirmed",
        title=f"Viewing confirmed for {when}",
        body=f"{viewing.listing.headline} in {_where(viewing.listing)}. "
        "You can now see each other's numbers in the app.",
        dedupe_key=_key(event, viewing.tenant_id),
        target_type="viewing",
        target_id=viewing.id,
    )
    notify(
        user=host,
        kind="viewing.confirmed",
        title=f"Viewing confirmed for {when}",
        body=f"{viewing.tenant.display_name} is coming to see {viewing.listing.headline}.",
        dedupe_key=_key(event, host.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.declined.v1")
def on_viewing_declined(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    notify(
        user=viewing.tenant,
        kind="viewing.declined",
        title="A viewing was declined",
        body=viewing.response_note
        or f"The landlord cannot show you {viewing.listing.headline} right now.",
        dedupe_key=_key(event, viewing.tenant_id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.withdrawn.v1")
def on_viewing_withdrawn(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    host = viewing.responded_by or viewing.listing.created_by
    notify(
        user=host,
        kind="viewing.withdrawn",
        title="A viewing request was withdrawn",
        body=(
            f"{viewing.tenant.display_name} withdrew their request for "
            f"{viewing.listing.headline}."
        ),
        dedupe_key=_key(event, host.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.cancelled.v1")
def on_viewing_cancelled(event) -> None:
    """Whoever did not do the cancelling."""
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return

    cancelled_by_tenant = bool(event.payload.get("cancelled_by_tenant"))
    host = viewing.responded_by or viewing.listing.created_by
    recipient = host if cancelled_by_tenant else viewing.tenant
    who = viewing.tenant.display_name if cancelled_by_tenant else "The landlord"

    reason = viewing.get_cancellation_reason_display() if viewing.cancellation_reason else ""
    notify(
        user=recipient,
        kind="viewing.cancelled",
        title="A viewing was cancelled",
        body=f"{who} cancelled the appointment for {viewing.listing_headline}."
        + (f" Reason: {reason}." if reason else ""),
        dedupe_key=_key(event, recipient.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.rescheduled.v1")
def on_viewing_rescheduled(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    initiated_by_tenant = bool(event.payload.get("initiated_by_tenant"))
    host = viewing.responded_by or viewing.listing.created_by
    recipient = host if initiated_by_tenant else viewing.tenant
    who = viewing.tenant.display_name if initiated_by_tenant else "The host"
    notify(
        user=recipient,
        kind="viewing.rescheduled",
        title="New viewing times are available",
        body=f"{who} requested a new time for {viewing.listing_headline}. Choose a replacement.",
        dedupe_key=_key(event, recipient.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.attendance_reported.v1")
def on_viewing_attendance_reported(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    host = viewing.responded_by or viewing.listing.created_by
    alleged = event.payload.get("alleged_absent_party")
    recipient = viewing.tenant if alleged == "tenant" else host
    notify(
        user=recipient,
        kind="viewing.attendance_reported",
        title="Please respond about a viewing",
        body=(
            f"The other party reported that you did not attend {viewing.listing.headline}. "
            "Confirm or dispute this report; it is not treated as verified until you respond."
        ),
        dedupe_key=_key(event, recipient.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.attendance_responded.v1")
def on_viewing_attendance_responded(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    reporter_id = event.payload.get("reported_by_id")
    reporter = (
        viewing.tenant
        if str(viewing.tenant_id) == str(reporter_id)
        else (viewing.responded_by or viewing.listing.created_by)
    )
    response = event.payload.get("response")
    notify(
        user=reporter,
        kind="viewing.attendance_responded",
        title="Viewing attendance report updated",
        body=(
            "The other party confirmed the report."
            if response == "confirm"
            else "The other party disputed the report. It remains unresolved for support review."
        ),
        dedupe_key=_key(event, reporter.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.approaching.v1")
def on_viewing_approaching(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None or viewing.confirmed_slot is None:
        return
    when = viewing.confirmed_slot.starts_at.strftime("%H:%M")
    for person in (viewing.tenant, viewing.responded_by or viewing.listing.created_by):
        notify(
            user=person,
            kind="viewing.approaching",
            title=f"Your viewing is approaching at {when}",
            body=f"Open {viewing.listing.headline} for directions and contact details.",
            dedupe_key=_key(event, person.id),
            target_type="viewing",
            target_id=viewing.id,
        )


@subscribe("viewing.checkin_available.v1")
def on_viewing_checkin_available(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    host = viewing.responded_by or viewing.listing.created_by
    notify(
        user=viewing.tenant,
        kind="viewing.checkin_available",
        title="Viewing check-in is ready",
        body="Open your viewing to show the temporary QR or 6-digit code when you arrive.",
        dedupe_key=_key(event, viewing.tenant_id),
        target_type="viewing",
        target_id=viewing.id,
    )
    notify(
        user=host,
        kind="viewing.checkin_available",
        title="Viewing check-in is open",
        body=f"Scan the tenant's QR or enter their 6-digit code for {viewing.listing.headline}.",
        dedupe_key=_key(event, host.id),
        target_type="viewing",
        target_id=viewing.id,
    )


@subscribe("viewing.checked_in.v1")
def on_viewing_checked_in(event) -> None:
    viewing = _viewing(event.aggregate_id)
    if viewing is None:
        return
    for person in (viewing.tenant, viewing.responded_by or viewing.listing.created_by):
        notify(
            user=person,
            kind="viewing.checked_in",
            title="Viewing checked in",
            body=f"Attendance at {viewing.listing.headline} was securely verified.",
            dedupe_key=_key(event, person.id),
            target_type="viewing",
            target_id=viewing.id,
        )


@subscribe("tenancy_request.created.v1")
def on_tenancy_request_created(event) -> None:
    from apps.occupancy.models import PropertyJoinRequest

    tenancy_request = (
        PropertyJoinRequest.objects.filter(id=event.aggregate_id)
        .select_related(
            "requester",
            "source_viewing__responded_by",
            "source_viewing__listing__created_by",
        )
        .first()
    )
    if tenancy_request is None or tenancy_request.source_viewing is None:
        return
    viewing = tenancy_request.source_viewing
    host = viewing.responded_by or viewing.listing.created_by
    notify(
        user=host,
        kind="tenancy_request.created",
        title="A tenant requested this home",
        body=(
            f"{tenancy_request.requester.display_name} requested the home after their "
            "checked-in viewing. Review it in Tenants."
        ),
        dedupe_key=_key(event, host.id),
        target_type="property_join_request",
        target_id=tenancy_request.id,
    )


# --- applications ------------------------------------------------------------


@subscribe("application.submitted.v1")
def on_application_submitted(event) -> None:
    application = _application(event.aggregate_id)
    if application is None:
        return
    host = application.listing.created_by
    short = application.advance_shortfall_months
    fit = (
        "They can pay the advance you asked for."
        if short == 0
        else f"They are {short} month{'s' if short != 1 else ''} short of your asking advance."
    )
    notify(
        user=host,
        kind="application.submitted",
        title="You have a new application",
        body=f"{application.tenant.display_name} applied for {application.listing.headline}. {fit}",
        dedupe_key=_key(event, host.id),
        target_type="application",
        target_id=application.id,
    )


@subscribe("application.under_review.v1")
def on_application_under_review(event) -> None:
    """Small, but it is the difference between waiting and waiting in silence."""
    application = _application(event.aggregate_id)
    if application is None:
        return
    notify(
        user=application.tenant,
        kind="application.under_review",
        title="Your application is being considered",
        body=f"The landlord has picked up your application for {application.listing.headline}.",
        dedupe_key=_key(event, application.tenant_id),
        target_type="application",
        target_id=application.id,
    )


@subscribe("application.accepted.v1")
def on_application_accepted(event) -> None:
    application = _application(event.aggregate_id)
    if application is None:
        return
    notify(
        user=application.tenant,
        kind="application.accepted",
        title="Your application was accepted",
        body=f"{application.listing.headline}. "
        + (application.decision_note or "Get in touch to arrange the next step."),
        dedupe_key=_key(event, application.tenant_id),
        target_type="application",
        target_id=application.id,
    )


@subscribe("application.rejected.v1")
def on_application_rejected(event) -> None:
    """A rejection with a reason is the difference between a market that teaches
    people and one that just wastes their time."""
    application = _application(event.aggregate_id)
    if application is None:
        return
    notify(
        user=application.tenant,
        kind="application.rejected",
        title="Your application was not accepted",
        body=f"{application.listing.headline}. "
        + (application.decision_note or "No reason was given."),
        dedupe_key=_key(event, application.tenant_id),
        target_type="application",
        target_id=application.id,
    )


# --- leases ------------------------------------------------------------------


def _lease(payload_id):
    from apps.lease.models import Lease

    return (
        Lease.objects.filter(id=payload_id)
        .select_related("unit__property__address__locality", "landlord", "tenant")
        .first()
    )


@subscribe("lease.offered.v1")
def on_lease_offered(event) -> None:
    """The tenant is being asked to commit money. Say what it comes to."""
    lease = _lease(event.aggregate_id)
    if lease is None:
        return

    from apps.core.money import Money

    total = Money(lease.move_in_total_minor, lease.rent_currency or "GHS")
    warning = (
        " This is more advance than the Rent Act 1963 allows on a monthly tenancy."
        if lease.exceeds_statutory_advance
        else ""
    )
    notify(
        user=lease.tenant,
        kind="lease.offered",
        title="You have a tenancy agreement to look at",
        body=f"{lease.unit.property.title or 'A place'} in {_where_unit(lease.unit)}: "
        f"{total} to move in, {lease.advance_months} months advance.{warning}",
        dedupe_key=_key(event, lease.tenant_id),
        target_type="lease",
        target_id=lease.id,
    )


@subscribe("lease.activated.v1")
def on_lease_activated(event) -> None:
    """Both sides. This is the moment the tenancy exists."""
    lease = _lease(event.aggregate_id)
    if lease is None:
        return

    when = lease.starts_on.strftime("%d %b %Y") if lease.starts_on else "the agreed date"
    notify(
        user=lease.tenant,
        kind="lease.activated",
        title="Your tenancy agreement is now in place",
        body=f"It starts on {when}. The terms are in the app, and they cannot be changed "
        "without a new agreement.",
        dedupe_key=_key(event, lease.tenant_id),
        target_type="lease",
        target_id=lease.id,
    )
    notify(
        user=lease.landlord,
        kind="lease.activated",
        title=f"{lease.tenant.display_name} accepted the agreement",
        body=f"The tenancy starts on {when}. The unit is no longer advertised.",
        dedupe_key=_key(event, lease.landlord_id),
        target_type="lease",
        target_id=lease.id,
    )


@subscribe("lease.declined.v1")
def on_lease_declined(event) -> None:
    lease = _lease(event.aggregate_id)
    if lease is None:
        return
    notify(
        user=lease.landlord,
        kind="lease.declined",
        title="An agreement was declined",
        body=f"{lease.tenant.display_name} did not accept the agreement."
        + (f" {lease.decline_reason}" if lease.decline_reason else ""),
        dedupe_key=_key(event, lease.landlord_id),
        target_type="lease",
        target_id=lease.id,
    )


@subscribe("lease.ended.v1")
def on_lease_ended(event) -> None:
    lease = _lease(event.aggregate_id)
    if lease is None:
        return
    for person in (lease.tenant, lease.landlord):
        notify(
            user=person,
            kind="lease.ended",
            title="A tenancy has ended",
            body=f"{lease.unit.property.title or 'The place'} in {_where_unit(lease.unit)}. "
            "The agreement stays in your records.",
            dedupe_key=_key(event, person.id),
            target_type="lease",
            target_id=lease.id,
        )


# --- properties for sale -----------------------------------------------------


def _enquiry(payload_id):
    from apps.sale.models import SaleEnquiry

    return (
        SaleEnquiry.objects.filter(id=payload_id).select_related("sale__property", "buyer").first()
    )


def _sellers(prop) -> list:
    """Everyone who may answer for this property: its Portfolio's managers."""
    from apps.organization.models import MembershipRole, OrganizationMembership

    organization_ids = prop.organization_relationships.filter(ended_at__isnull=True).values(
        "organization_id"
    )
    memberships = OrganizationMembership.objects.filter(
        organization_id__in=organization_ids,
        ended_at__isnull=True,
        role__in=[MembershipRole.OWNER, MembershipRole.ADMIN],
    ).select_related("user")
    people = {membership.user.id: membership.user for membership in memberships}
    if prop.created_by_id and prop.created_by_id not in people:
        people[prop.created_by_id] = prop.created_by
    return list(people.values())


@subscribe("sale.enquiry_received.v1")
def on_sale_enquiry_received(event) -> None:
    enquiry = _enquiry(event.aggregate_id)
    if enquiry is None:
        return
    headline = enquiry.sale.headline or "your property"
    for seller in _sellers(enquiry.sale.property):
        notify(
            user=seller,
            kind="sale.enquiry_received",
            title="A buyer is asking about your property",
            body=f"{enquiry.buyer.display_name} sent a question about {headline}.",
            dedupe_key=_key(event, seller.id),
            target_type="sale_enquiry",
            target_id=enquiry.id,
        )


@subscribe("sale.enquiry_replied.v1")
def on_sale_enquiry_replied(event) -> None:
    enquiry = _enquiry(event.aggregate_id)
    if enquiry is None:
        return
    headline = enquiry.sale.headline or "the property"
    if event.payload.get("from_buyer"):
        recipients = _sellers(enquiry.sale.property)
        body = f"{enquiry.buyer.display_name} replied about {headline}."
    else:
        recipients = [enquiry.buyer]
        body = f"The seller replied about {headline}."
    for person in recipients:
        notify(
            user=person,
            kind="sale.enquiry_replied",
            title="New message about a property for sale",
            body=body,
            dedupe_key=_key(event, person.id),
            target_type="sale_enquiry",
            target_id=enquiry.id,
        )


# --- scheduled rent obligations ---------------------------------------------


@subscribe("rent.payment_reminder.v1")
def on_rent_payment_reminder(event) -> None:
    from apps.core.money import Money
    from apps.rent.models import ChargeStatus, RentCharge, RentReminder, RentReminderStage

    reminder = (
        RentReminder.objects.filter(id=event.aggregate_id)
        .select_related("lease__tenant", "lease__unit__property")
        .first()
    )
    if reminder is None or reminder.lease.status != "active":
        return
    charges = list(
        RentCharge.objects.filter(
            lease=reminder.lease,
            due_on=reminder.due_on,
            status__in=(ChargeStatus.DUE, ChargeStatus.PART_PAID),
        ).order_by("kind")
    )
    charges = [charge for charge in charges if charge.outstanding_minor > 0]
    if not charges:
        # A payment may settle the group between the scheduled scan and outbox
        # delivery. A stale reminder must never tell a tenant they still owe.
        return

    outstanding_minor = sum(charge.outstanding_minor for charge in charges)
    amount = Money(outstanding_minor, charges[0].amount_currency)
    stage = reminder.stage
    titles = {
        RentReminderStage.DUE_IN_7_DAYS: "A payment is due in 7 days",
        RentReminderStage.DUE_IN_3_DAYS: "A payment is due in 3 days",
        RentReminderStage.DUE_TOMORROW: "A payment is due tomorrow",
        RentReminderStage.DUE_TODAY: "A payment is due today",
        RentReminderStage.OVERDUE_1_DAY: "A payment is 1 day overdue",
        RentReminderStage.OVERDUE_3_DAYS: "A payment is 3 days overdue",
        RentReminderStage.OVERDUE_7_DAYS: "A payment is 7 days overdue",
    }
    if stage in (RentReminderStage.DUE_IN_7_DAYS, RentReminderStage.DUE_IN_3_DAYS):
        kind = "rent.payment_due_soon"
    elif stage in (RentReminderStage.DUE_TOMORROW, RentReminderStage.DUE_TODAY):
        kind = "rent.payment_due_now"
    else:
        kind = "rent.payment_overdue"
    property_name = (reminder.lease.unit.property.title or "Your home")[:80]
    unit_label = reminder.lease.unit.label[:48]
    what = (
        charges[0].get_kind_display().lower()
        if len(charges) == 1
        else f"{len(charges)} scheduled items"
    )
    due_phrase = (
        f"was due {reminder.due_on:%d %b %Y}"
        if stage.startswith("overdue")
        else f"is due {reminder.due_on:%d %b %Y}"
    )
    title = titles.get(stage)
    if title is None:
        return
    notify(
        user=reminder.lease.tenant,
        kind=kind,
        title=title,
        body=(
            f"{amount} for {what} at {property_name} · {unit_label} {due_phrase}. "
            "Open Payments to review the obligation."
        ),
        dedupe_key=_key(event, reminder.lease.tenant_id),
        target_type="payment",
        target_id=reminder.lease_id,
    )


# --- externally recorded payments -------------------------------------------


def _external_payment(payment_id):
    from apps.rent.models import RentPayment

    return (
        RentPayment.objects.filter(id=payment_id)
        .select_related(
            "lease__tenant",
            "lease__landlord",
            "lease__unit__property",
            "charge",
            "recorded_by",
            "confirmed_by",
        )
        .first()
    )


@subscribe("rent.payment_recorded.v1")
def on_external_payment_recorded(event) -> None:
    from apps.core.money import Money

    payment = _external_payment(event.aggregate_id)
    if payment is None or payment.verification_source != "party_confirmation":
        return
    lease = payment.lease
    recipient = lease.landlord if payment.recorded_by_tenant else lease.tenant
    who = payment.recorded_by.display_name
    amount = Money(payment.amount_minor, payment.amount_currency)
    obligation = payment.charge.get_kind_display().lower() if payment.charge else "rent"
    notify(
        user=recipient,
        kind="rent.external_payment_recorded",
        title="Confirm an external payment",
        body=(
            f"{who} recorded {amount} via {payment.get_method_display()} for {obligation} "
            f"at {lease.unit.property.title}. Confirm it or tell us you did not make it."
        ),
        dedupe_key=_key(event, recipient.id),
        target_type="payment",
        target_id=lease.id,
    )


@subscribe("rent.payment_confirmed.v1")
def on_external_payment_confirmed(event) -> None:
    from apps.core.money import Money

    payment = _external_payment(event.aggregate_id)
    if payment is None or payment.verification_source != "party_confirmation":
        return
    notify(
        user=payment.recorded_by,
        kind="rent.external_payment_confirmed",
        title="External payment confirmed",
        body=(
            f"{Money(payment.amount_minor, payment.amount_currency)} via "
            f"{payment.get_method_display()} was confirmed. The receipt is now available."
        ),
        dedupe_key=_key(event, payment.recorded_by_id),
        target_type="payment",
        target_id=payment.lease_id,
    )


@subscribe("rent.payment_disputed.v1")
def on_external_payment_disputed(event) -> None:
    from apps.core.money import Money

    payment = _external_payment(event.aggregate_id)
    if payment is None or payment.verification_source != "party_confirmation":
        return
    notify(
        user=payment.recorded_by,
        kind="rent.external_payment_disputed",
        title="External payment disputed",
        body=(
            f"The {Money(payment.amount_minor, payment.amount_currency)} "
            f"{payment.get_method_display().lower()} record was disputed and did not settle "
            "the obligation."
        ),
        dedupe_key=_key(event, payment.recorded_by_id),
        target_type="payment",
        target_id=payment.lease_id,
    )


# --- provider-confirmed payments --------------------------------------------


@subscribe("payment.succeeded.v1")
def on_payment_succeeded(event) -> None:
    from apps.core.money import Money
    from apps.payments.models import PaymentTransaction

    payment = (
        PaymentTransaction.objects.filter(id=event.aggregate_id)
        .select_related(
            "intent__tenant",
            "intent__lease__landlord",
            "intent__lease__unit__property",
            "receipt",
        )
        .first()
    )
    if payment is None:
        return
    amount = Money(payment.amount_minor, payment.amount_currency)
    lease = payment.intent.lease
    notify(
        user=payment.intent.tenant,
        kind="payment.succeeded",
        title="Your payment was confirmed",
        body=(
            f"{amount} for {lease.unit.property.title}. "
            f"Receipt {payment.receipt.receipt_number} is ready."
        ),
        dedupe_key=_key(event, payment.intent.tenant_id),
        target_type="lease",
        target_id=lease.id,
    )
    notify(
        user=lease.landlord,
        kind="payment.succeeded",
        title="A tenant payment was confirmed",
        body=(
            f"{amount} from {payment.intent.tenant.display_name}. Settlement is tracked "
            "separately and is not yet claimed as complete."
        ),
        dedupe_key=_key(event, lease.landlord_id),
        target_type="lease",
        target_id=lease.id,
    )


@subscribe("payment.failed.v1")
def on_payment_failed(event) -> None:
    from apps.payments.models import PaymentIntent

    intent = (
        PaymentIntent.objects.filter(id=event.aggregate_id)
        .select_related("tenant", "lease__unit__property")
        .first()
    )
    if intent is None:
        return
    notify(
        user=intent.tenant,
        kind="payment.failed",
        title="Your payment was not completed",
        body=(
            f"No confirmed payment was recorded for {intent.lease.unit.property.title}. "
            "You can try again with a new payment attempt."
        ),
        dedupe_key=_key(event, intent.tenant_id),
        target_type="lease",
        target_id=intent.lease_id,
    )


# --- Danpa HQ subscription payments --------------------------------------------
#
# Separate events from rent on purpose. A Portfolio paying Danpa HQ for its plan
# has no tenant, lease or landlord, and the person told is the owner or
# administrator who started the payment.


@subscribe("billing.subscription_payment_succeeded.v1")
def on_subscription_payment_succeeded(event) -> None:
    from apps.billing.models import InvoiceKind
    from apps.core.money import Money
    from apps.payments.models import PaymentTransaction

    payment = (
        PaymentTransaction.objects.filter(id=event.aggregate_id)
        .select_related(
            "intent__initiated_by",
            "intent__billing_invoice__plan",
            "intent__billing_invoice__billing_account__organization",
            "receipt",
        )
        .first()
    )
    if payment is None or not payment.intent.is_subscription:
        return
    invoice = payment.intent.billing_invoice
    portfolio = invoice.billing_account.organization
    notify(
        user=payment.intent.initiated_by,
        kind="billing.subscription_payment_succeeded",
        title=(
            f"{invoice.plan.name} renewed for {portfolio.name}"
            if invoice.kind == InvoiceKind.RENEWAL
            else f"{portfolio.name} is now on {invoice.plan.name}"
        ),
        body=(
            f"{Money(payment.amount_minor, payment.amount_currency)} paid. "
            f"Receipt {payment.receipt.receipt_number} is in Plan & billing."
        ),
        dedupe_key=_key(event, payment.intent.initiated_by_id),
        target_type="billing",
        target_id=portfolio.id,
    )


@subscribe("billing.subscription_payment_failed.v1")
def on_subscription_payment_failed(event) -> None:
    from apps.payments.models import PaymentIntent

    intent = (
        PaymentIntent.objects.filter(id=event.aggregate_id)
        .select_related(
            "initiated_by",
            "billing_invoice__plan",
            "billing_invoice__billing_account__organization",
        )
        .first()
    )
    if intent is None or not intent.is_subscription:
        return
    invoice = intent.billing_invoice
    portfolio = invoice.billing_account.organization
    notify(
        user=intent.initiated_by,
        kind="billing.subscription_payment_failed",
        title=f"Payment for {invoice.plan.name} was not completed",
        body=(
            f"Nothing was charged and {portfolio.name}'s plan has not changed. "
            "You can try again from Plan & billing."
        ),
        dedupe_key=_key(event, intent.initiated_by_id),
        target_type="billing",
        target_id=portfolio.id,
    )


def _where_unit(unit) -> str:
    address = getattr(unit.property, "address", None)
    locality = getattr(address, "locality", None)
    return getattr(locality, "name", "") or "Ghana"


# --- maintenance ---------------------------------------------------------------


def _maintenance(request_id):
    from apps.maintenance.models import MaintenanceRequest

    return (
        MaintenanceRequest.objects.filter(id=request_id)
        .select_related(
            "tenant",
            "property__owner",
            "property__managed_by",
            "unit",
            "tenancy__activation_lease__landlord",
        )
        .first()
    )


def _maintenance_providers(request) -> list:
    """Who hears about a repair: the landlord on the tenancy's agreement, and
    the property's named manager. The owner stands in when neither is set."""
    lease = request.tenancy.activation_lease
    people = [lease.landlord if lease else None, request.property.managed_by]
    found = {str(person.id): person for person in people if person is not None}
    if not found and request.property.owner_id:
        found[str(request.property.owner_id)] = request.property.owner
    return list(found.values())


def _maintenance_where(request) -> str:
    return f"{request.unit.label} at {request.property.title}"


def _latest_note(request) -> str:
    event = request.events.order_by("-created_at").first()
    return event.note if event else ""


@subscribe("maintenance.submitted.v1")
def on_maintenance_submitted(event) -> None:
    request = _maintenance(event.aggregate_id)
    if request is None:
        return
    for provider in _maintenance_providers(request):
        notify(
            user=provider,
            kind="maintenance.submitted",
            title=f"New maintenance request: {request.get_category_display()}",
            body=(
                f"{request.tenant.display_name} reported a problem in "
                f"{_maintenance_where(request)}."
            ),
            dedupe_key=_key(event, provider.id),
            target_type="maintenance_request",
            target_id=request.id,
        )


@subscribe("maintenance.started.v1")
def on_maintenance_started(event) -> None:
    request = _maintenance(event.aggregate_id)
    if request is None:
        return
    notify(
        user=request.tenant,
        kind="maintenance.in_progress",
        title="Work has started on your request",
        body=(
            f"Your {request.get_category_display().lower()} request at "
            f"{_maintenance_where(request)} is in progress."
        ),
        dedupe_key=_key(event, request.tenant_id),
        target_type="maintenance_request",
        target_id=request.id,
    )


@subscribe("maintenance.fixed_reported.v1")
def on_maintenance_fixed_reported(event) -> None:
    request = _maintenance(event.aggregate_id)
    if request is None:
        return
    note = _latest_note(request)
    # The artisan the payer chose may report it done; the tenant confirms either way.
    who = (
        request.assigned_artisan.user.display_name
        if event.payload.get("by_artisan") and request.assigned_artisan_id
        else "Your landlord"
    )
    notify(
        user=request.tenant,
        kind="maintenance.awaiting_confirmation",
        title="Is it fixed? Please confirm",
        body=(
            f"{who} reported the problem at {_maintenance_where(request)} fixed"
            f"{f': {note}' if note else '.'} Confirm it, or reopen it if it is not."
        ),
        dedupe_key=_key(event, request.tenant_id),
        target_type="maintenance_request",
        target_id=request.id,
    )


@subscribe("maintenance.confirmed.v1")
def on_maintenance_confirmed(event) -> None:
    request = _maintenance(event.aggregate_id)
    if request is None:
        return
    for provider in _maintenance_providers(request):
        notify(
            user=provider,
            kind="maintenance.completed",
            title="Repair confirmed",
            body=(
                f"{request.tenant.display_name} confirmed the fix in "
                f"{_maintenance_where(request)}."
            ),
            dedupe_key=_key(event, provider.id),
            target_type="maintenance_request",
            target_id=request.id,
        )


@subscribe("maintenance.reopened.v1")
def on_maintenance_reopened(event) -> None:
    request = _maintenance(event.aggregate_id)
    if request is None:
        return
    note = _latest_note(request)
    for provider in _maintenance_providers(request):
        notify(
            user=provider,
            kind="maintenance.reopened",
            title="A repair was reopened",
            body=(
                f"{request.tenant.display_name} says the problem in {_maintenance_where(request)} "
                f"is not fixed{f': {note}' if note else '.'}"
            ),
            dedupe_key=_key(event, provider.id),
            target_type="maintenance_request",
            target_id=request.id,
        )


# --- artisans ----------------------------------------------------------------------


def _artisan_applicant(verification_id):
    """The person an artisan decision is about, or None for any other check."""
    from apps.identity.models import User
    from apps.trust.models import Verification, VerificationKind

    verification = Verification.objects.filter(
        id=verification_id, kind=VerificationKind.ARTISAN, subject_type="user"
    ).first()
    if verification is None:
        return None, None
    return verification, User.objects.filter(id=verification.subject_id).first()


@subscribe("trust.verification_decided.v1")
def on_artisan_application_decided(event) -> None:
    verification, person = _artisan_applicant(event.aggregate_id)
    if person is None:
        return
    if event.payload.get("approved"):
        notify(
            user=person,
            kind="artisan.approved",
            title="You are approved as an artisan",
            body=(
                "Switch to the artisan experience from your account menu to see quote "
                "requests. Everything else on your account is unchanged."
            ),
            dedupe_key=_key(event, person.id),
            target_type="artisan_application",
            target_id=verification.id,
        )
        return
    notify(
        user=person,
        kind="artisan.rejected",
        title="Your artisan application was not approved",
        body=verification.decision_note or "Open your application to see why.",
        dedupe_key=_key(event, person.id),
        target_type="artisan_application",
        target_id=verification.id,
    )


@subscribe("trust.verification_needs_info.v1")
def on_artisan_application_needs_info(event) -> None:
    verification, person = _artisan_applicant(event.aggregate_id)
    if person is None:
        return
    notify(
        user=person,
        kind="artisan.needs_info",
        title="Your artisan application needs something more",
        body=verification.decision_note or "Open your application to see what is needed.",
        dedupe_key=_key(event, person.id),
        target_type="artisan_application",
        target_id=verification.id,
    )


def _artisan_person(event):
    from apps.identity.models import User

    return User.objects.filter(id=event.payload.get("user_id")).first()


@subscribe("artisan.suspended.v1")
def on_artisan_suspended(event) -> None:
    person = _artisan_person(event)
    if person is None:
        return
    from apps.artisan.models import ArtisanProfile

    profile = ArtisanProfile.objects.filter(id=event.aggregate_id).first()
    notify(
        user=person,
        kind="artisan.suspended",
        title="Your artisan account is suspended",
        body=(
            f"{profile.suspended_reason if profile else ''} You cannot send new quotes or "
            "take on new jobs for now. Your existing jobs and records are unchanged."
        ).strip(),
        dedupe_key=_key(event, person.id),
        target_type="artisan_application",
        target_id=event.aggregate_id,
    )


@subscribe("artisan.reinstated.v1")
def on_artisan_reinstated(event) -> None:
    person = _artisan_person(event)
    if person is None:
        return
    notify(
        user=person,
        kind="artisan.reinstated",
        title="Your artisan account is active again",
        body="You can send quotes and take on new jobs again.",
        dedupe_key=_key(event, person.id),
        target_type="artisan_application",
        target_id=event.aggregate_id,
    )


@subscribe("artisan.certificate_decided.v1")
def on_artisan_certificate_decided(event) -> None:
    person = _artisan_person(event)
    if person is None:
        return
    from apps.artisan.models import ArtisanCertificate

    certificate = ArtisanCertificate.objects.filter(id=event.aggregate_id).first()
    if certificate is None:
        return
    trade = certificate.get_trade_display()
    if event.payload.get("verified"):
        notify(
            user=person,
            kind="artisan.certificate_verified",
            title=f"Your {trade.lower()} certificate is verified",
            body="Customers now see it as verified, with today's date, until it expires.",
            dedupe_key=_key(event, person.id),
            target_type="artisan_certificate",
            target_id=certificate.id,
        )
        return
    notify(
        user=person,
        kind="artisan.certificate_declined",
        title=f"Your {trade.lower()} certificate was not accepted",
        body=certificate.decision_note or "Open your profile to see why.",
        dedupe_key=_key(event, person.id),
        target_type="artisan_certificate",
        target_id=certificate.id,
    )


# --- quotes on repairs and direct jobs ---------------------------------------------


def _invitation(invitation_id):
    from apps.artisan.models import QuoteInvitation

    return (
        QuoteInvitation.objects.select_related(
            "artisan__user",
            "maintenance_request__property__address__locality__district",
            "maintenance_request__tenant",
            "maintenance_request__unit",
            "maintenance_request__tenancy__activation_lease__landlord",
            "maintenance_request__property__owner",
            "maintenance_request__property__managed_by",
            "direct_job__owner",
            "direct_job__locality__district",
        )
        .filter(id=invitation_id)
        .first()
    )


def _quote_row(quote_id):
    from apps.artisan.models import Quote

    return Quote.objects.select_related("invitation").filter(id=quote_id).first()


def _price(quote) -> str:
    from apps.core.money import Money

    return Money(quote.price_minor).format()


@subscribe("artisan.quote_invited.v1")
def on_quote_invited(event) -> None:
    invitation = _invitation(event.aggregate_id)
    if invitation is None:
        return
    # The area only. The address waits for an approved quote.
    if invitation.direct_job_id:
        job = invitation.direct_job
        area, what = job.locality.name, job.get_trade_display()
    else:
        request = invitation.maintenance_request
        area = request.property.address.locality_label or request.property.address.district_label
        what = request.get_category_display()
    notify(
        user=invitation.artisan.user,
        kind="artisan.quote_invited",
        title=f"New quote request: {what}",
        body=f"Somebody in {area} would like a quote. Open it to see the job and send your price.",
        dedupe_key=_key(event, invitation.artisan.user_id),
        target_type="artisan_invitation",
        target_id=invitation.id,
    )


@subscribe("artisan.suggested.v1")
def on_artisan_suggested(event) -> None:
    invitation = _invitation(event.aggregate_id)
    if invitation is None:
        return
    request = invitation.maintenance_request
    for provider in _maintenance_providers(request):
        notify(
            user=provider,
            kind="artisan.suggested",
            title="Your tenant suggested an artisan",
            body=(
                f"{request.tenant.display_name} suggested {invitation.artisan.user.display_name} "
                f"for the {request.get_category_display().lower()} repair in "
                f"{_maintenance_where(request)}. Invite them to quote if you agree."
            ),
            dedupe_key=_key(event, provider.id),
            target_type="maintenance_request",
            target_id=request.id,
        )


@subscribe("artisan.quote_submitted.v1")
def on_quote_submitted(event) -> None:
    quote = _quote_row(event.aggregate_id)
    if quote is None:
        return
    invitation = _invitation(quote.invitation_id)
    revision = event.payload.get("revision")
    # Two kinds, each stated whole: the clients classify kinds by reading them here.
    if revision:  # noqa: SIM108 — each kind must read `kind = "..."` for the client mirror test
        kind = "artisan.revision_submitted"
    else:
        kind = "artisan.quote_submitted"
    # A direct job has one payer, who posted it; a repair, whoever runs the property.
    if invitation.direct_job_id:
        job = invitation.direct_job
        payers, where = [job.owner], f"“{job.title}”"
        target_type, target_id = "artisan_direct_job", job.id
    else:
        request = invitation.maintenance_request
        payers, where = _maintenance_providers(request), _maintenance_where(request)
        target_type, target_id = "maintenance_request", request.id
    for provider in payers:
        notify(
            user=provider,
            kind=kind,
            title=(
                f"Revised quote: {_price(quote)}" if revision else f"New quote: {_price(quote)}"
            ),
            body=(
                f"{invitation.artisan.user.display_name} "
                + ("asks for a revised price" if revision else "sent a quote")
                + f" for {where}. Nothing changes until you approve it."
            ),
            dedupe_key=_key(event, provider.id),
            target_type=target_type,
            target_id=target_id,
        )


@subscribe("artisan.quote_approved.v1")
@subscribe("artisan.revision_approved.v1")
def on_quote_approved(event) -> None:
    quote = _quote_row(event.aggregate_id)
    if quote is None:
        return
    invitation = _invitation(quote.invitation_id)
    revision = event.name == "artisan.revision_approved.v1"
    notify(
        user=invitation.artisan.user,
        kind="artisan.quote_approved",
        title="Your revised price was approved" if revision else "Your quote was approved",
        body=(
            f"{_price(quote)} is now the price on record."
            if revision
            else "The job is yours. The address and a contact are now on the job."
        ),
        dedupe_key=_key(event, invitation.artisan.user_id),
        target_type="artisan_invitation",
        target_id=invitation.id,
    )


@subscribe("artisan.quote_declined.v1")
def on_quote_declined(event) -> None:
    quote = _quote_row(event.aggregate_id)
    if quote is None:
        return
    invitation = _invitation(quote.invitation_id)
    notify(
        user=invitation.artisan.user,
        kind="artisan.quote_declined",
        title=(
            "Your revised price was not approved"
            if event.payload.get("revision")
            else "Your quote was not chosen"
        ),
        body=quote.decision_note or "Open the request to see where it stands.",
        dedupe_key=_key(event, invitation.artisan.user_id),
        target_type="artisan_invitation",
        target_id=invitation.id,
    )


@subscribe("artisan.job_cancelled.v1")
def on_direct_job_cancelled(event) -> None:
    from apps.artisan.models import DirectJob

    job = DirectJob.objects.select_related("owner").filter(id=event.aggregate_id).first()
    if job is None:
        return
    from apps.identity.models import User

    artisan = User.objects.filter(id=event.payload.get("user_id")).first()
    if artisan is None:
        return
    notify(
        user=artisan,
        kind="artisan.job_cancelled",
        title="A job was cancelled",
        body=f"{job.owner.display_name} cancelled “{job.title}”. You do not need to go.",
        dedupe_key=_key(event, artisan.id),
        target_type="artisan_invitation",
        target_id=event.payload.get("invitation_id"),
    )


# --- finishing artisan work --------------------------------------------------------------


def _held_invitation_for(request):
    """The invitation of the artisan doing a repair, for their notifications."""
    if request.assigned_artisan_id is None:
        return None
    from apps.artisan.models import QuoteInvitation

    return (
        QuoteInvitation.objects.select_related("artisan__user")
        .filter(maintenance_request=request, artisan_id=request.assigned_artisan_id)
        .first()
    )


def _held_invitation_for_job(job):
    from apps.artisan.models import QuoteInvitation

    return (
        QuoteInvitation.objects.select_related("artisan__user")
        .filter(direct_job=job, artisan_id=job.assigned_artisan_id)
        .first()
    )


@subscribe("artisan.work_reported.v1")
def on_artisan_work_reported(event) -> None:
    from apps.artisan.models import WorkReport

    report = (
        WorkReport.objects.select_related(
            "invitation__artisan__user", "invitation__direct_job__owner"
        )
        .filter(id=event.aggregate_id)
        .first()
    )
    if report is None:
        return
    invitation = report.invitation
    name = invitation.artisan.user.display_name
    if invitation.direct_job_id:
        job = invitation.direct_job
        notify(
            user=job.owner,
            kind="artisan.work_reported",
            title="Is the work done? Please confirm",
            body=(
                f"{name} reported “{job.title}” done, with photos. Confirm it, or reopen "
                "it if something is not right."
            ),
            dedupe_key=_key(event, job.owner_id),
            target_type="artisan_direct_job",
            target_id=job.id,
        )
        return
    request = _maintenance(invitation.maintenance_request_id)
    if request is None:
        return
    for provider in _maintenance_providers(request):
        notify(
            user=provider,
            kind="artisan.work_reported",
            title="An artisan reported a repair done",
            body=(
                f"{name} reported the repair in {_maintenance_where(request)} done, with "
                "photos. The tenant confirms it."
            ),
            dedupe_key=_key(event, provider.id),
            target_type="maintenance_request",
            target_id=request.id,
        )


def _tell_artisan_confirmed(event, invitation, where: str) -> None:
    notify(
        user=invitation.artisan.user,
        kind="artisan.work_confirmed",
        title="Your work was confirmed done",
        body=f"The work on {where} is confirmed done. It now counts on your profile.",
        dedupe_key=_key(event, invitation.artisan.user_id),
        target_type="artisan_invitation",
        target_id=invitation.id,
    )


def _tell_artisan_reopened(event, invitation, where: str, reason: str) -> None:
    notify(
        user=invitation.artisan.user,
        kind="artisan.work_reopened",
        title="Your work was reopened",
        body=f"The work on {where} is not finished yet{f': {reason}' if reason else '.'}",
        dedupe_key=_key(event, invitation.artisan.user_id),
        target_type="artisan_invitation",
        target_id=invitation.id,
    )


@subscribe("maintenance.confirmed.v1")
def on_maintenance_confirmed_for_artisan(event) -> None:
    request = _maintenance(event.aggregate_id)
    invitation = _held_invitation_for(request) if request else None
    if invitation is not None:
        _tell_artisan_confirmed(event, invitation, _maintenance_where(request))


@subscribe("maintenance.reopened.v1")
def on_maintenance_reopened_for_artisan(event) -> None:
    request = _maintenance(event.aggregate_id)
    invitation = _held_invitation_for(request) if request else None
    if invitation is not None:
        _tell_artisan_reopened(
            event, invitation, _maintenance_where(request), _latest_note(request)
        )


def _direct_job(job_id):
    from apps.artisan.models import DirectJob

    return DirectJob.objects.filter(id=job_id).first()


@subscribe("artisan.work_confirmed.v1")
def on_direct_job_confirmed(event) -> None:
    job = _direct_job(event.aggregate_id)
    invitation = _held_invitation_for_job(job) if job else None
    if invitation is not None:
        _tell_artisan_confirmed(event, invitation, f"“{job.title}”")


@subscribe("artisan.work_reopened.v1")
def on_direct_job_reopened(event) -> None:
    job = _direct_job(event.aggregate_id)
    invitation = _held_invitation_for_job(job) if job else None
    if invitation is not None:
        _tell_artisan_reopened(event, invitation, f"“{job.title}”", event.payload.get("reason", ""))


@subscribe("artisan.paid_recorded.v1")
def on_artisan_paid_recorded(event) -> None:
    quote = _quote_row(event.aggregate_id)
    if quote is None:
        return
    invitation = _invitation(quote.invitation_id)
    notify(
        user=invitation.artisan.user,
        kind="artisan.paid_recorded",
        title="Payment recorded",
        body=(
            f"The customer recorded paying you {_price(quote)}. Danpa HQ keeps the record; "
            "the money went directly between you."
        ),
        dedupe_key=_key(event, invitation.artisan.user_id),
        target_type="artisan_invitation",
        target_id=invitation.id,
    )


@subscribe("artisan.reviewed.v1")
def on_artisan_reviewed(event) -> None:
    from apps.artisan.models import ArtisanReview

    written = (
        ArtisanReview.objects.select_related("artisan__user", "invitation")
        .filter(id=event.aggregate_id)
        .first()
    )
    if written is None:
        return
    notify(
        user=written.artisan.user,
        kind="artisan.reviewed",
        title="A customer reviewed your work",
        body=f"“{written.text[:120]}” It now shows on your profile.",
        dedupe_key=_key(event, written.artisan.user_id),
        target_type="artisan_invitation",
        target_id=written.invitation_id,
    )


@subscribe("maintenance.assigned.v1")
def on_maintenance_assigned(event) -> None:
    request = _maintenance(event.aggregate_id)
    if request is None or request.assigned_artisan_id is None:
        return
    from apps.artisan.models import ArtisanProfile

    artisan = ArtisanProfile.objects.select_related("user").get(id=request.assigned_artisan_id)
    notify(
        user=request.tenant,
        kind="maintenance.assigned",
        title="An artisan is on your repair",
        body=(
            f"{artisan.user.display_name} will fix the {request.get_category_display().lower()} "
            f"problem in {_maintenance_where(request)} and may call you to arrange a time."
        ),
        dedupe_key=_key(event, request.tenant_id),
        target_type="maintenance_request",
        target_id=request.id,
    )
