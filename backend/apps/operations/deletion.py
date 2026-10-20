"""Deleting an account: asked for by the person, decided by Management.

``request_deletion`` records the ask and what stands in its way;
``approve`` erases, ``decline`` explains. Erasure keeps the user row, because
leases, payments and audit trails reference it and the law requires some of
them to be kept, but it removes what identifies the person: names, email,
phone, photo, identity numbers and contact numbers, and it ends every session.
"""

from __future__ import annotations

from django.db import connection, transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, NotFound, ValidationFailed

from .models import AccountDeletionRequest, DeletionStatus

CONFIRMATION = "DELETE"


def blockers_for(user) -> list[str]:
    """What Management will have to settle first, in words the person reads."""
    from apps.lease.models import Lease, LeaseStatus

    found: list[str] = []
    live = [LeaseStatus.ACTIVE, LeaseStatus.AWAITING_ACTIVATION, LeaseStatus.TENANT_ACCEPTED]
    renting = Lease.objects.filter(tenant=user, status__in=live).count()
    letting = Lease.objects.filter(landlord=user, status__in=live).count()
    if renting:
        found.append(
            f"You are a tenant on {renting} current agreement{'s' if renting != 1 else ''}."
        )
    if letting:
        found.append(
            f"You granted {letting} current agreement{'s' if letting != 1 else ''} as a provider."
        )
    from apps.organization.models import MembershipRole, OrganizationMembership

    owned = OrganizationMembership.objects.filter(
        user=user, role=MembershipRole.OWNER, ended_at__isnull=True
    ).count()
    if owned:
        plural = "s" if owned != 1 else ""
        found.append(f"You own {owned} Portfolio{plural}, which will need a new owner.")
    return found


def pending_for(user) -> AccountDeletionRequest | None:
    return AccountDeletionRequest.objects.filter(user=user, status=DeletionStatus.PENDING).first()


def latest_for(user) -> AccountDeletionRequest | None:
    return AccountDeletionRequest.objects.filter(user=user).first()


@transaction.atomic
def request_deletion(*, user, reason: str, confirmation: str) -> AccountDeletionRequest:
    if (confirmation or "").strip() != CONFIRMATION:
        raise ValidationFailed(f"Type {CONFIRMATION} to confirm.")
    if pending_for(user):
        raise Conflict("Your request is already with Management.")
    item = AccountDeletionRequest.objects.create(
        user=user, reason=(reason or "").strip()[:1000], blockers=blockers_for(user)
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="account_deletion_request",
        aggregate_id=item.id,
        actor=user,
        metadata={"blockers": len(item.blockers)},
    )
    _tell(
        user,
        item,
        kind="account.deletion_requested",
        title="We received your request to delete your account",
        body="Management will review it and confirm by text. You can withdraw it from "
        "Settings until then.",
    )
    return item


@transaction.atomic
def cancel_deletion(*, user) -> AccountDeletionRequest:
    item = pending_for(user)
    if item is None:
        raise NotFound("There is no deletion request waiting.")
    item.status = DeletionStatus.CANCELLED
    item.decided_at = timezone.now()
    item.save(update_fields=["status", "decided_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="account_deletion_request",
        aggregate_id=item.id,
        actor=user,
        changes={"status": [DeletionStatus.PENDING, DeletionStatus.CANCELLED]},
    )
    return item


def _pending(item_id) -> AccountDeletionRequest:
    item = (
        AccountDeletionRequest.objects.select_for_update()
        .select_related("user")
        .filter(id=item_id)
        .first()
    )
    if item is None:
        raise NotFound("We could not find that request.")
    if item.status != DeletionStatus.PENDING:
        raise Conflict("That request has already been decided.")
    return item


@transaction.atomic
def approve(*, item_id, actor, note: str = "") -> AccountDeletionRequest:
    item = _pending(item_id)
    user = item.user
    item.status = DeletionStatus.COMPLETED
    item.decided_by = actor
    item.decided_at = timezone.now()
    item.decision_note = (note or "").strip()[:1000]
    item.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    erase_account(user)
    record(
        action=AuditAction.DELETE,
        aggregate_type="user",
        aggregate_id=user.id,
        management_actor=actor,
        metadata={"deletion_request_id": str(item.id)},
    )
    return item


@transaction.atomic
def decline(*, item_id, actor, note: str) -> AccountDeletionRequest:
    if not (note or "").strip():
        raise ValidationFailed("Say why, so the person knows what to do next.")
    item = _pending(item_id)
    item.status = DeletionStatus.DECLINED
    item.decided_by = actor
    item.decided_at = timezone.now()
    item.decision_note = note.strip()[:1000]
    item.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="account_deletion_request",
        aggregate_id=item.id,
        management_actor=actor,
        changes={"status": [DeletionStatus.PENDING, DeletionStatus.DECLINED]},
        metadata={"note": item.decision_note},
    )
    _tell(
        item.user,
        item,
        kind="account.deletion_declined",
        title="Your account was not deleted",
        body=item.decision_note[:280],
    )
    return item


def erase_account(user) -> None:
    """Remove what identifies the person; keep the row the records point at."""
    from apps.identity.models import Session, User
    from apps.notifications.models import NotificationPreference

    now = timezone.now()
    Session.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=now, revoked_reason="account_deleted"
    )
    user.first_name = ""
    user.last_name = ""
    user.preferred_name = "Deleted account"
    user.email = None
    user.is_active = False
    user.deactivated_at = now
    user.set_unusable_password()
    user.save(
        update_fields=[
            "first_name",
            "last_name",
            "preferred_name",
            "email",
            "is_active",
            "deactivated_at",
            "password",
            "updated_at",
        ]
    )
    # The phone is the sign-in identity and unique; a tombstone frees the real
    # number for whoever holds it next. Written in SQL because the field
    # normalises every value it prepares — even through `update()` — and would
    # refuse anything that is not a real number, which is the point here.
    # Table name comes from trusted model metadata; values are bound parameters.
    with connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE {User._meta.db_table} SET phone = %s WHERE id = %s",  # noqa: S608 # nosec B608
            [f"x{user.id.hex[-15:]}", user.id],
        )

    profile = getattr(user, "profile", None)
    if profile is not None:
        profile.bio = ""
        profile.avatar = None
        profile.address = None
        profile.national_id_hash = ""
        profile.national_id_last4 = ""
        profile.whatsapp_number = ""
        profile.save()
        profile.preferred_localities.clear()
    NotificationPreference.objects.filter(user=user).update(
        sms_enabled=False,
        push_enabled=False,
        sms_number="",
        whatsapp_enabled=False,
        whatsapp_number="",
    )


def _tell(user, item, *, kind: str, title: str, body: str) -> None:
    from apps.notifications.services import notify

    notify(
        user=user,
        kind=kind,
        title=title,
        body=body,
        dedupe_key=f"{kind}:{item.id}",
        target_type="account",
        target_id=item.id,
    )


def row(item: AccountDeletionRequest, *, for_management: bool = False) -> dict:
    data = {
        "id": str(item.id),
        "status": item.status,
        "status_display": item.get_status_display(),
        "reason": item.reason,
        "blockers": item.blockers,
        "requested_at": item.created_at.isoformat(),
        "decided_at": item.decided_at.isoformat() if item.decided_at else None,
        "decision_note": item.decision_note,
    }
    if for_management:
        from apps.core.phone import mask

        user = item.user
        data["user"] = {
            "id": str(user.id),
            "display_name": user.display_name,
            "phone": mask(user.phone) if user.is_active else "",
            "is_active": user.is_active,
            "joined_at": user.created_at.isoformat(),
        }
        data["decided_by"] = item.decided_by.display_name if item.decided_by else ""
    return data
