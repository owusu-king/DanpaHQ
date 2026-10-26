"""RFC 6238 authenticators shared by consumer and privileged sign-in boundaries.

Enrollment follows a short-lived first-factor proof. Secrets are encrypted;
recovery codes are hashed, and successful proofs are consumed under a row lock.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from dataclasses import dataclass
from urllib.parse import quote, urlencode
from uuid import UUID

from cryptography.fernet import Fernet
from django.conf import settings
from django.contrib.auth.hashers import is_password_usable
from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.crypto import hash_secret
from apps.core.exceptions import ValidationFailed
from apps.core.throttling import count_attempt

from .models import AdminAuthenticator


def _key() -> str:
    return str(getattr(settings, "RUNTIME_CONFIG_ENCRYPTION_KEY", "") or settings.SECRET_KEY)


def _cipher() -> Fernet:
    key = hashlib.sha256(f"admin-mfa:{_key()}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _principal(user) -> dict:
    if user._meta.label_lower == "operations.managementuser":
        return {"management_user_id": user.pk}
    if user._meta.label_lower == "identity.user":
        return {"django_user_id": user.pk}
    raise ValueError("MFA is available only to privileged principals.")


def device_id(user) -> UUID | None:
    return (
        AdminAuthenticator.objects.filter(**_principal(user)).values_list("id", flat=True).first()
    )


def policy(user) -> str:
    configured = user.mfa_policy
    if configured != "default":
        return configured
    privileged = "management_user_id" in _principal(user) or user.is_superuser
    return "required" if privileged and settings.ADMIN_MFA_REQUIRED else "disabled"


def required(user) -> bool:
    return policy(user) == "required"


def active_device_id(user) -> UUID | None:
    return None if policy(user) == "disabled" else device_id(user)


def session_valid(user, verified_device_id) -> bool:
    current = active_device_id(user)
    if current is None:
        return not required(user) and verified_device_id is None
    return str(current) == str(verified_device_id)


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


@transaction.atomic
def configure_policy(*, actor, user, policy_value: str, reason: str) -> bool:
    from apps.core.exceptions import PermissionDenied
    from apps.identity.models import Session

    from .models import ManagementRole, ManagementUser, MFAChallenge

    if (
        not isinstance(actor, ManagementUser)
        or not actor.is_active
        or actor.role != ManagementRole.OPERATIONS_ADMIN
    ):
        raise PermissionDenied("Only Operations Admins can configure MFA.")
    if policy_value not in {"default", "disabled", "optional", "required"} or not reason.strip():
        raise ValidationFailed("Choose an MFA policy and record a reason.")
    user = type(user).objects.select_for_update().get(pk=user.pk)
    management = isinstance(user, ManagementUser)
    if not management and (user.is_staff or user.is_superuser):
        raise PermissionDenied("Super Admin security is configured in Super Admin.")
    previous = user.mfa_policy
    if previous == policy_value:
        return False
    user.mfa_policy = policy_value
    user.save(update_fields=["mfa_policy", "updated_at"])
    now = timezone.now()
    sessions = user.sessions if management else Session.objects.filter(user=user)
    sessions.filter(revoked_at__isnull=True).update(
        revoked_at=now,
        revoked_reason="mfa_policy_changed",
    )
    MFAChallenge.objects.filter(**_principal(user)).delete()
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="management_user" if management else "user",
        aggregate_id=user.pk,
        management_actor=actor,
        changes={"mfa_policy": [previous, policy_value]},
        metadata={"reason": reason.strip(), "action": "mfa_policy_changed"},
    )
    return True


def provisioning_uri(*, user, secret: str) -> str:
    surface = (
        "Management"
        if "management_user_id" in _principal(user)
        else "Super Admin"
        if user.is_superuser
        else "Account"
    )
    issuer = f"Danpa HQ {surface}"
    label = quote(f"{issuer}:{user.email or user.phone}", safe="")
    query = urlencode(
        {"secret": secret, "issuer": issuer, "algorithm": "SHA1", "digits": 6, "period": 30}
    )
    return f"otpauth://totp/{label}?{query}"


def totp(secret: str, *, now: float | None = None) -> str:
    counter = int(time.time() if now is None else now) // 30
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()  # RFC 6238
    offset = digest[-1] & 15
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{binary % 1_000_000:06d}"


def _matching_counter(secret: str, code: str, *, last: int = -1, now=None) -> int | None:
    if not re.fullmatch(r"[0-9]{6}", code):
        return None
    counter = int(time.time() if now is None else now) // 30
    matched = None
    for candidate in range(max(0, counter - 1), counter + 2):
        if hmac.compare_digest(totp(secret, now=candidate * 30), code) and candidate > last:
            matched = candidate
    return matched


def _recovery_hash(code: str, credential_id) -> str:
    return hash_secret(
        code.replace("-", "").replace(" ", "").upper(),
        pepper=_key(),
        salt=f"admin-mfa:{credential_id}",
    )


@dataclass(frozen=True)
class Proof:
    accepted: bool
    credential_id: UUID | None = None


def verify(user, code: str = "") -> Proof:
    """An absent device fails closed; only business tests opt out explicitly."""
    principal = _principal(user)
    if policy(user) == "disabled":
        return Proof(True)
    if not AdminAuthenticator.objects.filter(**principal).exists():
        return Proof(not required(user))
    scope = f"admin-mfa:{next(iter(principal))}:{user.pk}"
    if count_attempt(scope, window=300, scope="admin_mfa") > 10:
        return Proof(False)
    with transaction.atomic():
        credential = AdminAuthenticator.objects.select_for_update().filter(**principal).first()
        if credential is None:
            return Proof(False)
        normalized = str(code).strip().replace(" ", "")
        secret = _cipher().decrypt(credential.secret_ciphertext.encode()).decode()
        counter = _matching_counter(secret, normalized, last=credential.last_counter)
        if counter is not None:
            credential.last_counter = counter
            credential.save(update_fields=["last_counter", "updated_at"])
            return Proof(True, credential.pk)
        if re.fullmatch(r"[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{8}", normalized):
            expected = _recovery_hash(normalized, credential.pk)
            remaining = [
                value
                for value in credential.recovery_hashes
                if not hmac.compare_digest(value, expected)
            ]
            if len(remaining) != len(credential.recovery_hashes):
                credential.recovery_hashes = remaining
                credential.save(update_fields=["recovery_hashes", "updated_at"])
                return Proof(True, credential.pk)
        return Proof(False)


@transaction.atomic
def enroll(
    *,
    user,
    secret: str,
    code: str,
    reset: bool = False,
    allow_consumer: bool = False,
) -> list[str]:
    """Confirm a new key after first-factor authentication or trusted recovery."""
    user = type(user).objects.select_for_update().get(pk=user.pk)
    management = "management_user_id" in _principal(user)
    consumer = allow_consumer and not management and not user.is_staff
    allowed = user.is_active and (
        (consumer and user.is_registration_complete)
        or (
            is_password_usable(user.password)
            and (
                management
                or (
                    user.is_staff
                    and user.is_superuser
                    and user.is_email_verified
                    and user.has_usable_password()
                )
            )
        )
    )
    if not allowed:
        raise ValidationFailed("Choose an active, eligible administrator.")
    existing = AdminAuthenticator.objects.select_for_update().filter(**_principal(user)).first()
    if existing and not reset:
        raise ValidationFailed("This administrator is already enrolled. Use an explicit reset.")
    counter = _matching_counter(secret, code.strip())
    if counter is None:
        raise ValidationFailed("The authenticator code did not match. Enrollment was not changed.")
    if existing:
        existing.delete()
    credential = AdminAuthenticator(
        **_principal(user),
        secret_ciphertext=_cipher().encrypt(secret.encode()).decode(),
        last_counter=counter,
    )
    recovery = [secrets.token_hex(8).upper() for _ in range(10)]
    credential.recovery_hashes = [_recovery_hash(value, credential.pk) for value in recovery]
    credential.save()
    if management:
        user.sessions.filter(revoked_at__isnull=True).update(
            revoked_at=timezone.now(), revoked_reason="mfa_enrolled"
        )
    else:
        from apps.identity.services import sign_out_everywhere

        sign_out_everywhere(user=user, reason="mfa_enrolled")
    record(
        action=AuditAction.UPDATE,
        aggregate_type="admin_authenticator",
        aggregate_id=credential.pk,
        metadata={
            "action": "mfa_reset" if existing else "mfa_enrolled",
            "surface": "management" if management else "django_admin",
        },
    )
    return [f"{value[:8]}-{value[8:]}" for value in recovery]
