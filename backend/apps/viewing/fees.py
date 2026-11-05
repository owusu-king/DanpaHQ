"""Management-owned pricing and evidence for viewing fees."""

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, ValidationFailed
from apps.operations.configuration import value


def policy() -> dict:
    return {
        "mode": value("VIEWING_FEE_MODE", "disabled"),
        "collection": value("VIEWING_FEE_COLLECTION", "platform"),
        "fixed_minor": value("VIEWING_FEE_FIXED_MINOR", 0),
        "minimum_minor": value("VIEWING_FEE_MIN_MINOR", 0),
        "maximum_minor": value("VIEWING_FEE_MAX_MINOR", 0),
        "currency": "GHS",
    }


def quote(viewing, requested_minor: int | None) -> None:
    current = policy()
    if viewing.appointments.exists() or viewing.fee_intents.exists():
        if requested_minor is not None and requested_minor != viewing.fee_minor:
            raise Conflict("The agreed viewing fee cannot be changed.")
        return
    if current["mode"] in ("disabled", "free"):
        amount = 0
    elif current["mode"] == "fixed":
        amount = current["fixed_minor"]
    else:
        if requested_minor is None:
            raise ValidationFailed("Set a viewing fee within management's limits.")
        amount = requested_minor
        if not current["minimum_minor"] <= amount <= current["maximum_minor"]:
            raise ValidationFailed("The viewing fee is outside management's permitted range.")
    if requested_minor is not None and requested_minor != amount:
        raise ValidationFailed("The viewing fee must match management's policy.")
    viewing.fee_minor = amount
    viewing.fee_policy = current
    viewing.fee_collection = current["collection"]


def details(viewing) -> dict:
    return {
        "amount_minor": viewing.fee_minor,
        "currency": "GHS",
        "collection": viewing.fee_collection,
        "status": "free"
        if not viewing.fee_minor
        else (
            "paid" if viewing.fee_paid_at else "claimed" if viewing.fee_claimed_by_id else "unpaid"
        ),
        "claimed_by_id": str(viewing.fee_claimed_by_id) if viewing.fee_claimed_by_id else None,
        "claimed_by": ("tenant" if viewing.fee_claimed_by_id == viewing.tenant_id else "host")
        if viewing.fee_claimed_by_id
        else None,
        "paid_at": viewing.fee_paid_at,
        "source": viewing.fee_payment_source,
    }


@transaction.atomic
def record_direct(*, viewing, user, confirm=False):
    from .models import ViewingRequest
    from .services import assert_participant

    viewing = ViewingRequest.objects.select_for_update().get(pk=viewing.pk)
    assert_participant(viewing, user)
    if value("VIEWING_FEE_MODE", "disabled") == "disabled" and not confirm:
        raise Conflict("Viewing fees are disabled by management.")
    if not viewing.confirmed_at or viewing.fee_collection != "direct" or not viewing.fee_minor:
        raise Conflict("This viewing has no direct payment to record.")
    if viewing.fee_paid_at:
        return viewing
    if confirm:
        if not viewing.fee_claimed_by_id or (
            (viewing.fee_claimed_by_id == viewing.tenant_id) == (user.id == viewing.tenant_id)
        ):
            raise Conflict("The other party must confirm the recorded payment.")
        viewing.fee_paid_at = timezone.now()
        viewing.fee_payment_source = "party_confirmation"
    else:
        if viewing.fee_claimed_by_id:
            raise Conflict("A payment is already awaiting confirmation.")
        viewing.fee_claimed_by = user
    viewing.save(
        update_fields=["fee_claimed_by", "fee_paid_at", "fee_payment_source", "updated_at"]
    )
    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="viewing",
        aggregate_id=viewing.id,
        actor=user,
        metadata={
            "event": "viewing_fee_confirmed" if confirm else "viewing_fee_recorded",
            "amount_minor": viewing.fee_minor,
            "currency": "GHS",
            "source": "direct",
        },
    )
    return viewing
