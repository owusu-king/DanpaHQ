"""Private share codes for a verified rentable space.

This credential is deliberately not a tenant invitation token. It may be shared
with more than one existing tenant and proves only possession; every resulting
join request still requires a provider decision. Invitation tokens are bound to
one verified phone and drive the prospective/existing invitation workflow.
"""

from __future__ import annotations

import base64
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.crypto import hash_secret, verify_secret
from apps.core.exceptions import Conflict, NotFound

from .models import Unit

NEW_CODE_BYTES = 16


def _pepper() -> str:
    return getattr(settings, "UNIT_ACCESS_CODE_PEPPER", None) or settings.SECRET_KEY


def _ttl_days() -> int:
    return int(getattr(settings, "UNIT_ACCESS_CODE_TTL_DAYS", 30))


def canonical(raw: str) -> str:
    """Normalize human grouping without weakening the code alphabet."""
    compact = "".join(ch for ch in str(raw).strip().upper() if ch not in {"-", " "})
    # Temporary compatibility for legacy ten-character hexadecimal codes whose
    # plaintext is converted to a peppered hash by the migration.
    if len(compact) == 10 and all(ch in "0123456789ABCDEF" for ch in compact):
        return compact
    if (
        len(compact) == 27
        and compact.startswith("U")
        and all(ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for ch in compact[1:])
    ):
        return compact
    raise NotFound("We could not find a space with that access code.")


def _hash(raw: str) -> str:
    return hash_secret(canonical(raw), pepper=_pepper())


def _generate() -> str:
    body = base64.b32encode(secrets.token_bytes(NEW_CODE_BYTES)).decode().rstrip("=")
    chunks = [body[index : index + 5] for index in range(0, len(body), 5)]
    # The U prefix keeps this private share credential visually distinct from a
    # phone-bound invitation token. Hyphens are presentation only.
    return "U-" + "-".join(chunks)


def _usable(unit: Unit, *, now=None) -> bool:
    from apps.billing import enforcement as billing
    from apps.occupancy.services import unit_is_occupied
    from apps.trust.gates import property_verification_ok, space_condition_ok

    current = now or timezone.now()
    return bool(
        unit.is_active
        and unit.property.deleted_at is None
        and property_verification_ok(unit.property)
        and space_condition_ok(unit)
        and not unit_is_occupied(unit)
        and unit.access_code_hash
        and unit.access_code_revoked_at is None
        and unit.access_code_expires_at
        and unit.access_code_expires_at > current
        # A space above its Portfolio's plan allowance takes no new tenants, so
        # its code resolves to nothing — the same answer as any unusable code,
        # which says nothing about why. Reactivating the space brings it back.
        and billing.accepts_new_activity(unit=unit)
    )


def state(unit: Unit, *, now=None) -> str:
    from apps.billing import enforcement as billing
    from apps.occupancy.services import unit_is_occupied
    from apps.trust.gates import property_verification_ok, space_condition_ok

    current = now or timezone.now()
    if (
        not unit.is_active
        or unit.property.deleted_at is not None
        or not property_verification_ok(unit.property)
        or not space_condition_ok(unit)
        or unit_is_occupied(unit)
        or not billing.accepts_new_activity(unit=unit)
    ):
        return "unavailable"
    if not unit.access_code_hash:
        return "not_created"
    if unit.access_code_revoked_at is not None:
        return "revoked"
    if not unit.access_code_expires_at or unit.access_code_expires_at <= current:
        return "expired"
    return "active"


def snapshot(unit: Unit) -> dict:
    code_state = state(unit)
    return {
        "state": code_state,
        "expires_at": unit.access_code_expires_at,
        "issued_at": unit.access_code_issued_at,
        "version": unit.access_code_version,
        "can_rotate": code_state != "unavailable",
        "can_revoke": code_state == "active",
        # A share code may onboard multiple existing tenants; every join still
        # waits for explicit provider approval. Invitation tokens remain one-recipient.
        "single_use": False,
    }


@transaction.atomic
def rotate(*, unit: Unit, actor) -> tuple[Unit, str]:
    """Create or replace the active share code and return the raw value once."""

    from apps.occupancy.services import unit_is_occupied
    from apps.property.capabilities import PropertyCapability, assert_property_capability
    from apps.trust.gates import property_verification_ok, space_condition_ok

    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    if not unit.property.is_managed_by(actor):
        raise NotFound("We could not find that space.")
    if unit_is_occupied(unit):
        raise Conflict(
            "This space is occupied. End the occupancy before creating another access code."
        )
    if (
        not unit.is_active
        or unit.property.deleted_at is not None
        or not property_verification_ok(unit.property)
        or not space_condition_ok(unit)
    ):
        raise Conflict(
            "Only an active verified space in a verified property can have an access code."
        )
    assert_property_capability(
        prop=unit.property,
        user=actor,
        capability=PropertyCapability.TENANT_ACCESS,
    )
    from apps.billing import enforcement as billing

    billing.assert_open_for_new_activity(unit=unit, action="access_code")

    previous = state(unit)
    raw = _generate()
    now = timezone.now()
    unit.access_code_hash = _hash(raw)
    unit.access_code_issued_at = now
    unit.access_code_expires_at = now + timedelta(days=_ttl_days())
    unit.access_code_revoked_at = None
    unit.access_code_version += 1
    unit.save(
        update_fields=[
            "access_code_hash",
            "access_code_issued_at",
            "access_code_expires_at",
            "access_code_revoked_at",
            "access_code_version",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="unit",
        aggregate_id=unit.id,
        actor=actor,
        changes={"access_code": [previous, "active"]},
        metadata={
            "reason": "created" if previous == "not_created" else "rotated",
            "version": unit.access_code_version,
            "expires_at": unit.access_code_expires_at.isoformat(),
        },
    )
    return unit, raw


@transaction.atomic
def revoke(*, unit: Unit, actor=None, management_actor=None, reason: str) -> Unit:
    """Revoke the current credential without deleting its audit context."""
    unit = Unit.objects.select_for_update().select_related("property").get(id=unit.id)
    if (
        actor is not None
        and not getattr(actor, "is_staff", False)
        and not unit.property.is_managed_by(actor)
    ):
        raise NotFound("We could not find that space.")
    previous = state(unit)
    if not unit.access_code_hash or unit.access_code_revoked_at is not None:
        return unit
    unit.access_code_revoked_at = timezone.now()
    unit.save(update_fields=["access_code_revoked_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="unit",
        aggregate_id=unit.id,
        actor=actor,
        management_actor=management_actor,
        changes={"access_code": [previous, "revoked"]},
        metadata={"reason": reason, "version": unit.access_code_version},
    )
    return unit


def revoke_for_verification_subject(
    *, subject_type: str, subject_id, actor=None, management_actor=None, reason: str
) -> None:
    """Invalidate codes when either the Unit or its parent loses verification."""
    if subject_type == "space":
        units = Unit.objects.filter(id=subject_id, access_code_hash__isnull=False)
    elif subject_type == "property":
        units = Unit.objects.filter(property_id=subject_id, access_code_hash__isnull=False)
    else:
        return

    for unit in units.iterator():
        revoke(
            unit=unit,
            actor=actor,
            management_actor=management_actor,
            reason=reason,
        )


def resolve(raw: str) -> Unit:
    """Return the one active verified Unit this possession secret names."""
    digest = _hash(raw)
    unit = (
        Unit.objects.filter(access_code_hash=digest)
        .select_related("property__address__locality")
        .prefetch_related("beds")
        .first()
    )
    if unit is None or not _usable(unit):
        raise NotFound("We could not find a space with that access code.")
    return unit


def verify(unit: Unit, raw: str) -> bool:
    """Constant-time verification against a Unit already named by the request."""
    if not _usable(unit):
        return False
    try:
        normalized = canonical(raw)
    except NotFound:
        normalized = "INVALID"
    return verify_secret(normalized, unit.access_code_hash, pepper=_pepper())
