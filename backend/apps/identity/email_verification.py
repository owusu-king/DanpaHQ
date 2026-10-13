"""Confirming an email address on an account that is already signed in.

Adding an address and changing one are the same act. The address waits on an
:class:`~apps.identity.models.EmailVerification` until its six-digit code comes
back, and only then is it written to the account — so a mistyped address, or
somebody else's, never replaces a working one.

Built from the phone flow's parts rather than beside them: the same code length
and lifetime, the same peppered hash, the same send ceiling and escalating
resend delay, the same five attempts and lockout. A person who has confirmed a
number already knows how this behaves.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.crypto import hash_secret, random_code, random_token, verify_secret
from apps.core.exceptions import DomainError, RateLimited, ValidationFailed

from . import messages, otp_policy
from .models import ChallengeStatus, EmailVerification, User
from .otp_policy import CODE_LENGTH, CODE_TTL_SECONDS, Decision
from .services import ChallengeFailed, _field_error, _pepper


class EmailDelivery(DomainError):
    code = "email_delivery_failed"
    status_code = 502
    message = "We could not send the email. Check the address and try again."


def clean_email(raw: str) -> str:
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email

    email = (raw or "").strip().lower()
    if not email:
        raise _field_error("email", "Enter an email address.")
    try:
        validate_email(email)
    except ValidationError as exc:
        raise _field_error("email", "Check the email address.") from exc
    return email


@transaction.atomic
def start_email_verification(*, user, raw_email: str) -> EmailVerification:
    """Send a code to the address. Asking again for the same one is a resend.

    A resend replaces the code on the live request and carries its attempt
    counter, exactly as on the phone, so "resend" is never a fresh budget of
    guesses. Asking for a different address cancels the earlier request.
    """
    from django.core.mail import send_mail

    email = clean_email(raw_email)
    if user.email == email and user.is_email_verified:
        raise _field_error("email", "This address is already confirmed on your account.")
    if User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
        raise _field_error("email", "That email address is already in use.")

    hour_ago = timezone.now() - timedelta(hours=1)
    sends = (
        EmailVerification.objects.filter(user=user, created_at__gte=hour_ago).aggregate(
            total=models.Sum("send_count")
        )["total"]
        or 0
    )

    live = (
        EmailVerification.objects.select_for_update()
        .filter(user=user, status=ChallengeStatus.PENDING)
        .order_by("-created_at")
        .first()
    )
    if live is not None and (live.email != email or not live.is_live):
        live.status = ChallengeStatus.CANCELLED
        live.save(update_fields=["status", "updated_at"])
        live = None

    seconds_since = int((timezone.now() - live.last_sent_at).total_seconds()) if live else None
    verdict = otp_policy.may_send(
        sends_last_hour_phone=sends,
        sends_last_hour_ip=0,
        seconds_since_last_send=seconds_since,
        send_count_this_session=live.send_count if live else 0,
        locked_out_seconds_remaining=live.lockout_seconds_remaining if live else 0,
    )
    if verdict.decision is not Decision.ALLOW:
        raise RateLimited(verdict.message, details={"retry_after": verdict.retry_after_seconds})

    code = random_code(CODE_LENGTH)
    salt = random_token(8)
    code_hash = hash_secret(code, pepper=_pepper(), salt=salt)
    now = timezone.now()

    if live is not None:
        live.code_hash = code_hash
        live.code_salt = salt
        live.send_count += 1
        live.last_sent_at = now
        live.expires_at = now + timedelta(seconds=CODE_TTL_SECONDS)
        live.save(
            update_fields=[
                "code_hash",
                "code_salt",
                "send_count",
                "last_sent_at",
                "expires_at",
                "updated_at",
            ]
        )
        verification = live
    else:
        verification = EmailVerification.objects.create(
            user=user,
            email=email,
            code_hash=code_hash,
            code_salt=salt,
            last_sent_at=now,
            expires_at=now + timedelta(seconds=CODE_TTL_SECONDS),
        )

    subject, body = messages.email_verification(code)
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
    except Exception as exc:  # every transport failure is the same answer
        raise EmailDelivery() from exc

    record(
        action=AuditAction.UPDATE,
        aggregate_type="email_verification",
        aggregate_id=verification.id,
        actor=user,
        metadata={"sent": True, "send_count": verification.send_count},
    )
    return verification


def verify_email(*, user, verification_id, code: str) -> User:
    """Check the code and, if it is right, put the address on the account.

    Not one transaction: like ``verify_challenge``, the attempt counter and the
    lockout are committed before a failure is reported, so raising never rolls
    back the thing that limits guessing.
    """
    failure: ChallengeFailed | ValidationFailed | None = None

    with transaction.atomic():
        verification = (
            EmailVerification.objects.select_for_update()
            .filter(id=verification_id, user=user)
            .first()
        )
        if verification is None:
            raise ChallengeFailed("That code request has expired. Ask for a new one.")

        gate = otp_policy.may_verify(
            challenge_age_seconds=verification.age_seconds,
            attempts_used=verification.attempts,
            already_consumed=verification.status != ChallengeStatus.PENDING,
        )
        if gate.decision is not Decision.ALLOW:
            if gate.decision is Decision.EXPIRED and verification.status == ChallengeStatus.PENDING:
                verification.status = ChallengeStatus.EXPIRED
                verification.save(update_fields=["status", "updated_at"])
            failure = ChallengeFailed(gate.message)

        elif not verify_secret(
            code.strip(), verification.code_hash, pepper=_pepper(), salt=verification.code_salt
        ):
            verification.attempts += 1
            outcome = otp_policy.after_incorrect(verification.attempts)
            if outcome.decision is Decision.TOO_MANY_ATTEMPTS:
                verification.status = ChallengeStatus.FAILED
                verification.locked_until = timezone.now() + timedelta(
                    seconds=otp_policy.LOCKOUT_SECONDS
                )
            verification.save(update_fields=["attempts", "status", "locked_until", "updated_at"])
            failure = ChallengeFailed(
                outcome.message, details={"attempts_remaining": outcome.attempts_remaining}
            )

        elif User.objects.filter(email__iexact=verification.email).exclude(pk=user.pk).exists():
            # Somebody else confirmed this address while the code was in flight.
            verification.status = ChallengeStatus.CANCELLED
            verification.save(update_fields=["status", "updated_at"])
            failure = _field_error("email", "That email address is already in use.")

        else:
            verification.status = ChallengeStatus.VERIFIED
            verification.consumed_at = timezone.now()
            verification.save(update_fields=["status", "consumed_at", "updated_at"])

            before = user.email
            user.email = verification.email
            user.is_email_verified = True
            user.save(update_fields=["email", "is_email_verified", "updated_at"])
            record(
                action=AuditAction.UPDATE,
                aggregate_type="user",
                aggregate_id=user.id,
                actor=user,
                changes={"email": [before, user.email], "is_email_verified": [False, True]},
            )

    if failure is not None:
        raise failure
    return user


def clear_email(*, user) -> User:
    """Take the address off the account. Nothing to prove: it only removes."""
    before = user.email
    user.email = None
    user.is_email_verified = False
    user.save(update_fields=["email", "is_email_verified", "updated_at"])
    EmailVerification.objects.filter(user=user, status=ChallengeStatus.PENDING).update(
        status=ChallengeStatus.CANCELLED, updated_at=timezone.now()
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        changes={"email": [before, None]},
    )
    return user
