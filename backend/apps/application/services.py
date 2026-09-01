"""Application lifecycle.

    submitted ──▶ under_review ──▶ accepted
        │              │       └──▶ rejected
        └──────────────┴──────────▶ withdrawn   (the applicant, any time)

Accepting one application does not reject the others. A landlord may reasonably
hold two while deciding, and auto-rejecting on their behalf would send a
rejection they never wrote. The lease slice is what closes the others out.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.outbox.services import emit

from .models import BLOCKING_STATUSES, ApplicationStatus, RentalApplication


def get_application_or_404(pk) -> RentalApplication:
    application = (
        RentalApplication.objects.filter(id=pk)
        .select_related("unit__property__address__locality", "listing", "tenant")
        .prefetch_related("listing__media__file", "unit__media__file")
        .first()
    )
    if application is None:
        raise NotFound("We could not find that application.")
    return application


def is_host(application: RentalApplication, user) -> bool:
    return application.listing.unit.property.is_managed_by(user)


def assert_host(application: RentalApplication, user) -> None:
    if not is_host(application, user):
        raise PermissionDenied("Only the landlord or agent for this listing can do that.")


def assert_participant(application: RentalApplication, user) -> None:
    if str(application.tenant_id) != str(user.id) and not is_host(application, user):
        raise PermissionDenied("You do not have access to that application.")


def assert_current(application: RentalApplication) -> None:
    if application.superseded_by_id is not None:
        raise Conflict("That application is retained as history and cannot be changed.")


@transaction.atomic
def conclude_for_lease(lease) -> None:
    """Mark the application behind a finished agreement as no longer current.

    Called wherever a lease reaches a terminal state — declined, cancelled or
    ended. The decision on the application is untouched; only its standing as a
    live claim on the Unit changes, which is what the duplicate rule is really
    about.

    Idempotent, and silent when there is no application behind the lease: a
    lease can be prepared directly from a private access code with no
    application at all.
    """
    if lease.application_id is None:
        return
    RentalApplication.objects.filter(id=lease.application_id, concluded_at__isnull=True).update(
        concluded_at=timezone.now()
    )


def submit_application(*, listing, tenant, data: dict) -> RentalApplication:
    from apps.listing.models import Listing, ListingStatus
    from apps.occupancy.services import unit_is_occupied
    from apps.property.models import Unit

    # Serialize the request with occupancy activation. If possession begins
    # first, this request observes it and stops; if the request commits first,
    # it truthfully predates that occupancy rather than slipping through it.
    Unit.objects.select_for_update().get(id=listing.unit_id)
    listing = (
        Listing.objects.select_for_update().select_related("unit__property").get(id=listing.id)
    )

    # An active listing already carries the P3 trust gate: `moderate_listing`
    # only approves after `assert_verified_provider`, and if authority is later
    # revoked `suspend_for_verification` takes the listing out of discovery. So
    # `status == ACTIVE` *is* the gate here, and re-checking it would only add
    # a second opinion that could disagree — the coupling P1.5 exists to avoid.
    if listing.status != ListingStatus.ACTIVE:
        raise Conflict("That place is no longer being advertised.")
    if unit_is_occupied(listing.unit):
        raise Conflict("That place is now occupied and is not accepting requests.")
    if listing.unit.property.is_managed_by(tenant):
        raise ValidationFailed("This is your own listing.")
    if RentalApplication.objects.filter(
        unit_id=listing.unit_id,
        tenant=tenant,
        status__in=BLOCKING_STATUSES,
        superseded_by__isnull=True,
        # An accepted application speaks for a live claim on this Unit. Once the
        # agreement it became has ended, it is history and must not stand in the
        # way of the same person renting the same place again.
        concluded_at__isnull=True,
    ).exists():
        raise Conflict("You have already applied for this place.")

    # Applying is the act of becoming a tenant here, so the capability is
    # established rather than assumed. Browsing does not make someone a tenant;
    # this does.
    from apps.identity.services import ensure_tenant_capability

    ensure_tenant_capability(tenant)

    # Snapshot what the tenant has on file, so the landlord sees the claim as it
    # stood. The request can override any of it.
    profile = getattr(tenant, "tenant_profile", None)

    try:
        # The conditional database constraint is the final guard for two
        # concurrent requests that both pass the friendly existence check.
        application = RentalApplication.objects.create(
            listing=listing,
            unit_id=listing.unit_id,
            tenant=tenant,
            move_in_from=data.get("move_in_from"),
            household_size=data.get("household_size") or getattr(profile, "household_size", None),
            advance_months_offered=(
                data["advance_months_offered"]
                if "advance_months_offered" in data
                else getattr(profile, "advance_months_affordable", 0) or 0
            ),
            message=(data.get("message") or "")[:1000],
            occupation=(data.get("occupation") or getattr(profile, "occupation", "") or "")[:120],
            employer=(data.get("employer") or getattr(profile, "employer", "") or "")[:160],
            income_band=(data.get("income_band") or getattr(profile, "income_band", "") or "")[:24],
            guarantor_name=(data.get("guarantor_name") or "")[:160],
            guarantor_phone=data.get("guarantor_phone") or "",
            guarantor_relationship=(data.get("guarantor_relationship") or "")[:60],
        )
    except IntegrityError as exc:
        raise Conflict("You have already applied for this place.") from exc

    record(
        action=AuditAction.CREATE,
        aggregate_type="application",
        aggregate_id=application.id,
        actor=tenant,
        metadata={
            "listing_id": str(listing.id),
            "advance_offered": application.advance_months_offered,
            "advance_asked": listing.advance_months,
        },
    )
    emit(
        DomainEvent(
            "application.submitted.v1",
            "application",
            str(application.id),
            {
                "listing_id": str(listing.id),
                "tenant_id": str(tenant.id),
                "meets_advance": application.meets_advance,
            },
        )
    )
    return application


@transaction.atomic
def start_review(*, application: RentalApplication, user) -> RentalApplication:
    """Tell the applicant somebody is actually looking.

    Small, but it is the difference between waiting and waiting in silence,
    which is most of what applicants complain about.
    """
    assert_host(application, user)
    assert_current(application)
    if application.status != ApplicationStatus.SUBMITTED:
        raise Conflict("That application is not waiting to be picked up.")

    application.status = ApplicationStatus.UNDER_REVIEW
    application.save(update_fields=["status", "updated_at"])

    record(
        action=AuditAction.UPDATE,
        aggregate_type="application",
        aggregate_id=application.id,
        actor=user,
        changes={"status": [ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW]},
    )
    emit(
        DomainEvent(
            "application.under_review.v1",
            "application",
            str(application.id),
            {"tenant_id": str(application.tenant_id)},
        )
    )
    return application


@transaction.atomic
def decide(
    *, application: RentalApplication, user, accept: bool, note: str = ""
) -> RentalApplication:
    assert_host(application, user)
    assert_current(application)
    if not application.is_open:
        raise Conflict("That application has already been settled.")

    previous = application.status
    application.status = ApplicationStatus.ACCEPTED if accept else ApplicationStatus.REJECTED
    application.decided_by = user
    application.decided_at = timezone.now()
    application.decision_note = note[:300]
    application.save(
        update_fields=[
            "status",
            "decided_by",
            "decided_at",
            "decision_note",
            "updated_at",
        ]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="application",
        aggregate_id=application.id,
        actor=user,
        changes={"status": [previous, application.status]},
        metadata={"note_given": bool(note)},
    )
    emit(
        DomainEvent(
            f"application.{'accepted' if accept else 'rejected'}.v1",
            "application",
            str(application.id),
            {"tenant_id": str(application.tenant_id), "listing_id": str(application.listing_id)},
        )
    )
    return application


@transaction.atomic
def withdraw(*, application: RentalApplication, user, note: str = "") -> RentalApplication:
    if str(application.tenant_id) != str(user.id):
        raise PermissionDenied("Only the applicant can withdraw an application.")
    assert_current(application)
    if not application.is_open:
        raise Conflict("That application has already been settled.")

    previous = application.status
    application.status = ApplicationStatus.WITHDRAWN
    application.withdrawn_at = timezone.now()
    application.decision_note = note[:300]
    application.save(
        update_fields=[
            "status",
            "withdrawn_at",
            "decision_note",
            "updated_at",
        ]
    )

    record(
        action=AuditAction.UPDATE,
        aggregate_type="application",
        aggregate_id=application.id,
        actor=user,
        changes={"status": [previous, application.status]},
    )
    emit(
        DomainEvent(
            "application.withdrawn.v1",
            "application",
            str(application.id),
            {"listing_id": str(application.listing_id)},
        )
    )
    return application
