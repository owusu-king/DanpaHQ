"""Authentication and session services.

Everything that creates, proves or destroys a session lives here. The rules that
shape this file:

* **Never leak whether an account exists**, except on sign-up and recovery.
  Those two answer at the number, because the alternative is spending someone an
  SMS and a wait to tell them what was knowable immediately. Every other purpose
  behaves identically for a known and an unknown number.
* **Never create an account until someone asks to join.** Proving a number is
  not joining: it yields a signed, expiring ticket, and the account is created
  in the same transaction that validates the registration form. Abandon the
  form and nothing was written.
* **Refresh tokens rotate, and reuse revokes the family.** A stolen token used
  after the real device rotated is detectable, and the response is to sign the
  family out and tell the person why.
* **Every security-relevant transition writes an audit entry**, including the
  failures. A sign-in that did not happen is evidence too.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.context import get_context
from apps.core.crypto import (
    hash_secret,
    hash_token,
    random_code,
    random_token,
    sign_payload,
    verify_secret,
)
from apps.core.events import DomainEvent
from apps.core.exceptions import (
    Conflict,
    DomainError,
    PermissionDenied,
    RateLimited,
    ValidationFailed,
)
from apps.core.phone import format_national, normalise_ghana_msisdn
from apps.outbox.services import emit

from . import messages, otp_policy
from .models import (
    AuthChallenge,
    ChallengePurpose,
    ChallengeStatus,
    Device,
    DevicePlatform,
    Profile,
    Role,
    Session,
    User,
    UserRole,
)
from .otp_policy import CODE_LENGTH, CODE_TTL_SECONDS, Decision
from .providers import get_sms_provider
from .risk import RiskSignals, assess

ACCESS_TOKEN_TTL_SECONDS = 15 * 60
REFRESH_TOKEN_TTL_DAYS = 30


class OtpDelivery(DomainError):
    code = "otp_delivery_failed"
    status_code = 502
    message = "We could not send the code. Check the number and try again."


class ChallengeFailed(DomainError):
    code = "challenge_failed"
    status_code = 400


class AccountExists(DomainError):
    """Raised when a sign-up is attempted for a number that already has one.

    The code is upper-case where the rest of this API is lower-case. That is
    deliberate and requested: clients branch on it to show "sign in instead"
    rather than an error, so it is a contract rather than a label, and changing
    its shape later would silently turn that branch back into a generic failure.
    """

    code = "ACCOUNT_EXISTS"
    status_code = 409
    message = "This number already has an account."


class NoAccount(DomainError):
    """Raised when recovery is attempted for a number that has no account.

    Upper-case and contractual for the same reason as ACCOUNT_EXISTS: it is the
    mirror image of it, and the clients answer it with an offer to create an
    account rather than a red banner.
    """

    code = "NO_ACCOUNT"
    status_code = 404
    message = "There is no account for that number. " "Create one to get started."


class NotAProvider(DomainError):
    """Raised when a non-provider account asks for the provider experience.

    Its own code, like ACCOUNT_EXISTS, because the clients treat it as an
    outcome rather than an error: it is answered with a screen offering the
    tenant space or a way out, not a red banner.
    """

    code = "NOT_A_PROVIDER"
    status_code = 403
    message = (
        "This account is not registered as a property provider. "
        "Provider accounts are created at sign-up."
    )


def _pepper() -> str:
    return getattr(settings, "OTP_PEPPER", None) or settings.SECRET_KEY


def _signing_key() -> str:
    return getattr(settings, "ACCESS_TOKEN_KEY", None) or settings.SECRET_KEY


# --- challenges --------------------------------------------------------------


@transaction.atomic
def start_challenge(
    *,
    raw_phone: str,
    purpose: str = ChallengePurpose.CONTINUE,
    ip_address: str | None = None,
    device_fingerprint: str = "",
    user=None,
) -> AuthChallenge:
    """Issue an OTP. Same behaviour whether or not the number has an account,
    except on sign-up — see below.
    """
    phone = normalise_ghana_msisdn(raw_phone)

    # Sign-up is the one purpose that answers differently for a known number.
    #
    # It is a deliberate trade against the enumeration resistance the rest of
    # this endpoint keeps: someone who sends purpose="sign_up" can learn whether
    # a number is registered. What it buys is that a person signing up with the
    # number they already use is told so *here*, instead of waiting for an SMS,
    # typing six digits, and only then being turned away. The per-number and
    # per-IP throttles on this view still bound how fast that can be farmed.
    #
    # Checked before the rate-limit bookkeeping and long before the send, so no
    # message goes out and no challenge row is created for a refused sign-up.
    if purpose == ChallengePurpose.SIGN_UP:
        existing = User.objects.filter(phone=phone).first()
        # An unfinished sign-up is not an account anyone can sign in to — it has
        # no password. Sending those back to sign-in would strand them, so they
        # get a code and carry on where they left off.
        if existing is not None and (existing.is_registration_complete or existing.is_staff):
            raise AccountExists()

    # Recovery is the mirror image, and refused here for the same reason: there
    # is nothing to recover for a number with no account, and finding that out
    # after an SMS, six digits and a wait is a worse way to learn it. The
    # enumeration trade is the one already accepted above, bounded by the same
    # per-number and per-IP throttles.
    if purpose == ChallengePurpose.RECOVER_ACCOUNT:
        existing = User.objects.filter(phone=phone).first()
        # Staff recover through the operations sign-in, so this surface has no
        # account for them and says so rather than confirming the number.
        if existing is None or existing.is_staff:
            raise NoAccount()
        # `password_required` is a real member who predates passwords: sign-in
        # sends them here to set one, so this is the door that has to open.
        # Anything earlier in the state machine never finished becoming an
        # account and has no password to reset.
        if existing.registration_state not in {"complete", "password_required"}:
            raise NoAccount()
        if not existing.is_active:
            raise PermissionDenied(
                "This account is closed. Contact support if you think that is wrong."
            )

    hour_ago = timezone.now() - timedelta(hours=1)
    sends_phone = AuthChallenge.objects.filter(phone=phone, created_at__gte=hour_ago).count()
    sends_ip = (
        AuthChallenge.objects.filter(ip_address=ip_address, created_at__gte=hour_ago).count()
        if ip_address
        else 0
    )

    live = (
        AuthChallenge.objects.select_for_update()
        .filter(phone=phone, purpose=purpose, status=ChallengeStatus.PENDING)
        .order_by("-created_at")
        .first()
    )

    seconds_since = int((timezone.now() - live.last_sent_at).total_seconds()) if live else None
    verdict = otp_policy.may_send(
        sends_last_hour_phone=sends_phone,
        sends_last_hour_ip=sends_ip,
        seconds_since_last_send=seconds_since,
        send_count_this_session=live.send_count if live else 0,
        locked_out_seconds_remaining=live.lockout_seconds_remaining if live else 0,
    )
    if verdict.decision is not Decision.ALLOW:
        raise RateLimited(verdict.message, details={"retry_after": verdict.retry_after_seconds})

    code = random_code(CODE_LENGTH)
    salt = random_token(8)

    if live and live.is_live:
        # Resend replaces the code on the existing challenge, so the attempt
        # counter carries over. Otherwise five wrong guesses then "resend" would
        # be an unlimited guessing budget.
        live.code_hash = hash_secret(code, pepper=_pepper(), salt=salt)
        live.code_salt = salt
        live.send_count += 1
        live.last_sent_at = timezone.now()
        live.expires_at = timezone.now() + timedelta(seconds=CODE_TTL_SECONDS)
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
        challenge = live
    else:
        challenge = AuthChallenge.objects.create(
            phone=phone,
            user=user or User.objects.filter(phone=phone).first(),
            purpose=purpose,
            code_hash=hash_secret(code, pepper=_pepper(), salt=salt),
            code_salt=salt,
            expires_at=timezone.now() + timedelta(seconds=CODE_TTL_SECONDS),
            ip_address=ip_address,
            device_fingerprint=device_fingerprint,
        )

    body = messages.BY_PURPOSE.get(purpose, messages.otp_sign_in)(code)
    result = get_sms_provider().send(to=phone, body=body, reference=str(challenge.id))
    if not result.accepted:
        raise OtpDelivery(details={"provider": result.provider})

    record(
        action=AuditAction.LOGIN,
        aggregate_type="auth_challenge",
        aggregate_id=challenge.id,
        actor=challenge.user,
        metadata={"purpose": purpose, "sent": True, "provider": result.provider},
    )
    return challenge


def verify_challenge(
    *,
    challenge_id,
    code: str,
    ip_address: str | None = None,
) -> AuthChallenge:
    """Check a code. Raises with a specific, honest message on every failure.

    Not decorated with ``transaction.atomic``. The attempt counter, the lockout
    and the LOGIN_FAILED audit entry are the *product* of a failed verification,
    and raising inside the transaction that wrote them would roll every one of
    them back - which would leave the attempt cap counting to five forever and
    an attacker with unlimited guesses. So the decision is taken and committed
    inside the block below, and only reported once it has.
    """
    failure: ChallengeFailed | None = None

    with transaction.atomic():
        challenge = AuthChallenge.objects.select_for_update().filter(id=challenge_id).first()
        if challenge is None:
            raise ChallengeFailed("That code request has expired. Start again.")

        gate = otp_policy.may_verify(
            challenge_age_seconds=challenge.age_seconds,
            attempts_used=challenge.attempts,
            already_consumed=challenge.status != ChallengeStatus.PENDING,
        )
        if gate.decision is not Decision.ALLOW:
            if gate.decision is Decision.EXPIRED and challenge.status == ChallengeStatus.PENDING:
                challenge.status = ChallengeStatus.EXPIRED
                challenge.save(update_fields=["status", "updated_at"])
            failure = ChallengeFailed(gate.message)

        elif not verify_secret(
            code.strip(), challenge.code_hash, pepper=_pepper(), salt=challenge.code_salt
        ):
            challenge.attempts += 1
            outcome = otp_policy.after_incorrect(challenge.attempts)
            if outcome.decision is Decision.TOO_MANY_ATTEMPTS:
                challenge.status = ChallengeStatus.FAILED
                challenge.locked_until = timezone.now() + timedelta(
                    seconds=otp_policy.LOCKOUT_SECONDS
                )
            challenge.save(update_fields=["attempts", "status", "locked_until", "updated_at"])

            record(
                action=AuditAction.LOGIN_FAILED,
                aggregate_type="auth_challenge",
                aggregate_id=challenge.id,
                actor=challenge.user,
                metadata={"attempts": challenge.attempts, "purpose": challenge.purpose},
            )
            failure = ChallengeFailed(
                outcome.message, details={"attempts_remaining": outcome.attempts_remaining}
            )

        else:
            challenge.status = ChallengeStatus.VERIFIED
            challenge.consumed_at = timezone.now()
            challenge.save(update_fields=["status", "consumed_at", "updated_at"])

    if failure is not None:
        raise failure
    return challenge


# --- accounts ----------------------------------------------------------------

#: How long someone has to fill in the registration form after proving their
#: number. Generous, because the form asks for a date of birth and a password on
#: what is often a slow connection, and a ticket that dies mid-form sends them
#: back for another SMS.
REGISTRATION_TICKET_TTL_SECONDS = 30 * 60


def issue_registration_ticket(challenge: AuthChallenge) -> str:
    """A proved number, signed and expiring, held by the client until it registers.

    This is what replaced creating the account here. A ticket carries the same
    fact the old empty row carried — *this number has been proved* — without
    that fact existing as a member of the platform. Someone who proves a number
    and then closes the app leaves nothing behind at all, which is the whole
    point: they never asked to join.

    It authorises exactly one thing, creating an account on this number, and it
    is not a session: it reads nothing and can act on nothing.
    """
    return sign_payload(
        {"pho": challenge.phone, "cha": str(challenge.id), "act": "registration"},
        key=_signing_key(),
        ttl_seconds=REGISTRATION_TICKET_TTL_SECONDS,
    )


def open_registration_ticket(ticket: str) -> tuple[str, str]:
    """Verify a ticket and return the phone number and challenge it was cut for."""
    from apps.core.crypto import TokenExpired, TokenInvalid, verify_payload

    try:
        payload = verify_payload(ticket, key=_signing_key())
    except TokenExpired as exc:
        raise PermissionDenied(
            "That took too long and the confirmation expired. Start again with your number."
        ) from exc
    except TokenInvalid as exc:
        raise PermissionDenied("That confirmation is not valid. Start again.") from exc

    if payload.get("act") != "registration":
        raise PermissionDenied("That token does not authorise creating an account.")
    return payload["pho"], payload.get("cha", "")


@transaction.atomic
def complete_sign_in(
    *,
    challenge: AuthChallenge,
    device_fingerprint: str = "",
    platform: str = DevicePlatform.ANDROID,
    device_label: str = "",
    app_version: str = "",
    os_version: str = "",
    ip_address: str | None = None,
    user_agent: str = "",
) -> dict:
    """Turn a proved number into either a registration ticket or a session.

    This is no longer a way to sign in. Proving control of a number establishes
    *which* account is being registered, not that the person at the keyboard is
    its owner — a reissued SIM proves the former and not the latter. Once an
    account is finished it has a password, and that is the only way back into
    it; an OTP from here on is for proving a number or recovering a password.

    A number with no account gets a ticket and no row. It used to get an account
    created here, on the strength of a confirmed SMS alone, which made everyone
    who tapped through an OTP and then thought better of it a member of the
    platform with no name, no password and no intention of having either.
    Membership now begins where it should: when the person finishes saying who
    they are. See :func:`issue_registration_ticket`.

    A number that already has an *unfinished* row — one created before this
    changed — still gets a registration session, so those can be finished rather
    than stranded.
    """
    if challenge.status != ChallengeStatus.VERIFIED:
        raise PermissionDenied("Confirm the code before continuing.")
    if challenge.consumed_at and timezone.now() - challenge.consumed_at > timedelta(minutes=10):
        raise PermissionDenied("That confirmation has expired. Start again.")

    from apps.trust.services import record_phone_verification

    user = challenge.user or User.objects.filter(phone=challenge.phone).first()

    if user is None:
        if challenge.purpose not in {
            ChallengePurpose.CONTINUE,
            ChallengePurpose.SIGN_UP,
        }:
            raise ValidationFailed(
                "There is no account for this number. Continue with phone to get started."
            )
        return {
            "registration_required": True,
            "registration_ticket": issue_registration_ticket(challenge),
            "phone_display": format_national(challenge.phone),
            "expires_in": REGISTRATION_TICKET_TTL_SECONDS,
        }

    created = False

    if not user.is_active:
        raise PermissionDenied(
            "This account is closed. Contact support if you think that is wrong."
        )
    if user.is_staff and challenge.purpose in {
        ChallengePurpose.CONTINUE,
        ChallengePurpose.SIGN_IN,
        ChallengePurpose.SIGN_UP,
    }:
        raise PermissionDenied("Administrative accounts must use the separate operations sign-in.")
    if not created and user.is_registration_complete:
        # The number is proved, but this account already has a credential. Handing
        # out a session here would restore OTP sign-in through the registration
        # door and put every account back within reach of a SIM swap.
        raise PermissionDenied(
            "This number already has an account. Sign in with your password, "
            "or reset it if you have forgotten it."
        )

    if not user.is_phone_verified:
        user.mark_phone_verified()
    record_phone_verification(user, challenge_id=str(challenge.id))

    return _establish_session(
        user=user,
        created=created,
        device_fingerprint=device_fingerprint,
        platform=platform,
        device_label=device_label,
        app_version=app_version,
        os_version=os_version,
        ip_address=ip_address,
        user_agent=user_agent,
        audit_metadata={"challenge_id": str(challenge.id), "method": "otp"},
    )


@transaction.atomic
def _establish_session(
    *,
    user,
    created: bool,
    device_fingerprint: str = "",
    platform: str = DevicePlatform.ANDROID,
    device_label: str = "",
    app_version: str = "",
    os_version: str = "",
    ip_address: str | None = None,
    user_agent: str = "",
    audit_metadata: dict | None = None,
) -> dict:
    """Open a session for a user who has already been authenticated.

    Shared by every way in — a proved phone during registration, a password, a
    completed recovery. Whatever established that the person is who they say,
    the device bookkeeping, the unfamiliar-device warning and the audit entry
    are the same, and a second copy of them would be a second place to forget
    one of the three.
    """
    device, device_is_new = _upsert_device(
        user=user,
        fingerprint=device_fingerprint,
        platform=platform,
        label=device_label,
        app_version=app_version,
        os_version=os_version,
    )

    if device is not None:
        # A refresh session represents the browser/app installation, not every
        # time its owner types a password. Re-signing in on the same device
        # supersedes its earlier token family. Device-less sessions are legacy
        # clients that gave the server no installation id; once this client can
        # identify itself, keeping those indistinguishable sessions alive only
        # leaves the account screen full of unactionable "Unknown device" rows.
        Session.objects.filter(user=user, revoked_at__isnull=True).filter(
            models.Q(device=device) | models.Q(device__isnull=True)
        ).update(
            revoked_at=timezone.now(),
            revoked_reason="device_signed_in_again",
        )

    session, refresh_token = _open_session(
        user=user, device=device, ip_address=ip_address, user_agent=user_agent
    )

    if device_is_new and not created:
        # Only warn on a new device for an existing account: telling a brand-new
        # user their brand-new phone is unrecognised is noise.
        get_sms_provider().send(
            to=user.phone, body=messages.new_device_alert(device.label or platform)
        )
        emit(
            DomainEvent(
                "identity.new_device_signed_in.v1",
                "user",
                str(user.id),
                {"device_id": str(device.id), "platform": platform},
            )
        )

    record(
        action=AuditAction.LOGIN,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        metadata={
            "created": created,
            "device_new": device_is_new,
            "platform": platform,
            **(audit_metadata or {}),
        },
    )
    if created:
        emit(
            DomainEvent(
                "identity.user_registered.v1",
                "user",
                str(user.id),
                {"platform": platform},
            )
        )

    return {
        "user": user,
        "created": created,
        "session": session,
        "device": device,
        "access_token": issue_access_token(user, session),
        "refresh_token": refresh_token,
        "expires_in": ACCESS_TOKEN_TTL_SECONDS,
    }


def _upsert_device(*, user, fingerprint, platform, label, app_version, os_version):
    """Record the installation signing in, and answer whether it is unfamiliar.

    A device the owner *removed* is allowed back. Removal signs an installation
    out; it does not bar the handset for good, and treating it as a bar left
    people permanently locked out of their own phone with no route back — the
    column was set in one place and cleared in none.

    A returning removed device counts as unfamiliar, so the caller sends the
    new-device alert. That is the useful signal: if somebody removed a device
    and it signs in again, its owner should hear about it.

    A *blocked* device is still refused. That state now means only what its
    owner said it meant: the handset is lost or stolen.
    """
    if not fingerprint:
        return None, False

    device, created = Device.objects.get_or_create(
        user=user,
        fingerprint=fingerprint,
        defaults={
            "platform": platform,
            "label": label,
            "app_version": app_version,
            "os_version": os_version,
        },
    )
    if device.is_blocked:
        raise PermissionDenied(
            "This device was reported lost or stolen, so it cannot sign in. Contact support."
        )

    returning = False
    if not created:
        returning = device.is_removed
        device.removed_at = None
        device.last_seen_at = timezone.now()
        device.label = label or device.label
        device.app_version = app_version or device.app_version
        device.os_version = os_version or device.os_version
        device.save(
            update_fields=[
                "removed_at",
                "last_seen_at",
                "label",
                "app_version",
                "os_version",
            ]
        )

    return device, created or returning


# --- devices a person acts on ------------------------------------------------


def _end_device_sessions(*, device, reason: str) -> int:
    return Session.objects.filter(
        user_id=device.user_id, device=device, revoked_at__isnull=True
    ).update(revoked_at=timezone.now(), revoked_reason=reason)


@transaction.atomic
def forget_device(*, device, actor=None) -> int:
    """Sign an installation out and drop it from the owner's device list.

    Reversible on purpose. Signing in again needs a one-time code to the
    account's own number, which is the control that actually protects the
    account; barring the handset forever protected nothing an attacker could
    not undo with a reinstall, and cost the owner their own phone.
    """
    device.removed_at = timezone.now()
    device.save(update_fields=["removed_at"])
    revoked = _end_device_sessions(device=device, reason="device_removed")
    record(
        action=AuditAction.UPDATE,
        aggregate_type="device",
        aggregate_id=device.id,
        actor=actor,
        changes={"removed_at": [None, device.removed_at.isoformat()]},
        metadata={"sessions_ended": revoked, "reason": "removed by owner"},
    )
    return revoked


@transaction.atomic
def block_device(*, device, reason: str, actor=None, management_actor=None) -> int:
    """Bar an installation from signing in. Only Management can lift it.

    For a handset the owner says is lost or stolen — never for the ordinary
    "sign this one out", which is `forget_device`.
    """
    device.blocked_at = timezone.now()
    device.blocked_reason = reason
    device.save(update_fields=["blocked_at", "blocked_reason"])
    revoked = _end_device_sessions(device=device, reason="device_blocked")
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="device",
        aggregate_id=device.id,
        actor=actor,
        management_actor=management_actor,
        changes={"blocked_at": [None, device.blocked_at.isoformat()]},
        metadata={"sessions_ended": revoked, "reason": reason},
    )
    return revoked


@transaction.atomic
def restore_device(*, device, management_actor, reason: str = "") -> None:
    """Lift a block so the handset can sign in again.

    The route back that did not exist. `blocked_at` was set in one place and
    cleared in none, so "Contact support" resolved to somebody editing the row
    by hand in Django admin.

    The device is left *removed* rather than trusted: lifting the bar restores
    the ability to sign in, and signing in is what re-registers it — with the
    unfamiliar-device alert going to the account's own number.
    """
    was = device.blocked_at
    device.blocked_at = None
    device.blocked_reason = ""
    device.removed_at = device.removed_at or timezone.now()
    device.save(update_fields=["blocked_at", "blocked_reason", "removed_at"])
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="device",
        aggregate_id=device.id,
        management_actor=management_actor,
        changes={"blocked_at": [was.isoformat() if was else None, None]},
        metadata={"reason": reason},
    )


# --- sessions and tokens -----------------------------------------------------


def issue_access_token(user, session) -> str:
    """Short-lived, stateless, and carries only what the API needs.

    Roles are embedded so the common permission check needs no database read, and
    the token is short-lived precisely because that snapshot goes stale: a revoked
    role takes effect within 15 minutes, which is the trade we accept for the
    read saved on every request.
    """
    return sign_payload(
        {
            "sub": str(user.id),
            "sid": str(session.id),
            "roles": sorted(user.roles),
            "phv": user.is_phone_verified,
        },
        key=_signing_key(),
        ttl_seconds=ACCESS_TOKEN_TTL_SECONDS,
    )


def _open_session(*, user, device, ip_address, user_agent, family_id=None, generation=0):
    token = random_token(32)
    session = Session.objects.create(
        user=user,
        device=device,
        refresh_token_hash=hash_token(token),
        expires_at=timezone.now() + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
        ip_address=ip_address,
        user_agent=user_agent[:300],
        client=get_context().source[:20],
        generation=generation,
        **({"family_id": family_id} if family_id else {}),
    )
    return session, token


def rotate_session(
    *,
    refresh_token: str,
    ip_address: str | None = None,
    user_agent: str = "",
    device_fingerprint: str = "",
    platform: str = DevicePlatform.ANDROID,
    device_label: str = "",
    app_version: str = "",
    os_version: str = "",
):
    """Exchange a refresh token for a new pair, detecting reuse.

    A token presented twice means either a stolen copy or a client that failed
    mid-rotation. We cannot distinguish them, so we treat it as theft: the whole
    family is revoked and everyone signs in again. Inconveniencing a user beats
    leaving an attacker holding a live session.

    Not decorated with ``transaction.atomic``, for the same reason as
    ``verify_challenge``: the revocation *is* the security response, and raising
    inside the transaction that performed it would undo it, leaving the attacker
    holding exactly the live session this is meant to take away.
    """
    token_hash = hash_token(refresh_token)
    reuse_detected = False

    with transaction.atomic():
        session = Session.objects.select_for_update().filter(refresh_token_hash=token_hash).first()

        if session is None:
            raise PermissionDenied("Your session has ended. Sign in again.")

        if session.revoked_at is not None or session.rotated_at is not None:
            revoked = Session.objects.filter(
                family_id=session.family_id, revoked_at__isnull=True
            ).update(revoked_at=timezone.now(), revoked_reason="token_reuse_detected")

            record(
                action=AuditAction.PERMISSION_CHANGE,
                aggregate_type="user",
                aggregate_id=session.user_id,
                actor=session.user,
                metadata={"event": "refresh_token_reuse", "sessions_revoked": revoked},
            )
            emit(
                DomainEvent(
                    "identity.session_reuse_detected.v1",
                    "user",
                    str(session.user_id),
                    {"family_id": str(session.family_id)},
                )
            )
            reuse_detected = True

        elif not session.is_active:
            raise PermissionDenied("Your session has expired. Sign in again.")

        else:
            if session.device_id is None and device_fingerprint:
                # Upgrade a live session created by an older web build. Revoke
                # indistinguishable legacy rows (and any older row already
                # attached to this installation) before assigning the device,
                # so rollout fixes the account screen on the next refresh and
                # still preserves every row as security history.
                device, _ = _upsert_device(
                    user=session.user,
                    fingerprint=device_fingerprint,
                    platform=platform,
                    label=device_label,
                    app_version=app_version,
                    os_version=os_version,
                )
                Session.objects.filter(
                    user=session.user,
                    revoked_at__isnull=True,
                ).exclude(id=session.id).filter(
                    models.Q(device=device) | models.Q(device__isnull=True)
                ).update(
                    revoked_at=timezone.now(),
                    revoked_reason="legacy_device_recognised",
                )
                session.device = device

            session.rotated_at = timezone.now()
            session.last_used_at = timezone.now()
            session.revoked_at = timezone.now()
            session.revoked_reason = "rotated"
            session.save(
                update_fields=[
                    "device",
                    "rotated_at",
                    "last_used_at",
                    "revoked_at",
                    "revoked_reason",
                ]
            )

            successor, token = _open_session(
                user=session.user,
                device=session.device,
                ip_address=ip_address,
                user_agent=user_agent,
                family_id=session.family_id,
                generation=session.generation + 1,
            )

    if reuse_detected:
        # Raised after the revocation has committed.
        raise PermissionDenied("For your security we signed you out everywhere. Sign in again.")

    return {
        "session": successor,
        "access_token": issue_access_token(session.user, successor),
        "refresh_token": token,
        "expires_in": ACCESS_TOKEN_TTL_SECONDS,
    }


@transaction.atomic
def sign_out(*, session, reason: str = "user_signed_out") -> None:
    Session.objects.filter(id=session.id, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )
    record(
        action=AuditAction.LOGIN,
        aggregate_type="user",
        aggregate_id=session.user_id,
        actor=session.user,
        metadata={"event": "sign_out", "reason": reason},
    )


@transaction.atomic
def sign_out_everywhere(*, user, except_session=None, reason: str = "user_signed_out_all") -> int:
    queryset = Session.objects.filter(user=user, revoked_at__isnull=True)
    if except_session is not None:
        queryset = queryset.exclude(id=except_session.id)
    count = queryset.update(revoked_at=timezone.now(), revoked_reason=reason)
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        metadata={"event": "sign_out_all", "sessions": count},
    )
    return count


# --- risk --------------------------------------------------------------------


def assess_user_risk(user, *, device=None):
    """Gather the signals we can actually see and score them."""
    from apps.trust.models import (
        SubjectType,
        Verification,
        VerificationKind,
        VerificationStatus,
    )

    phone_change = (
        Verification.objects.for_subject(SubjectType.USER, user.id)
        .filter(kind=VerificationKind.PHONE, status=VerificationStatus.SUPERSEDED)
        .order_by("-updated_at")
        .first()
    )
    hours_since_phone_change = (
        (timezone.now() - phone_change.updated_at).total_seconds() / 3600 if phone_change else None
    )

    day_ago = timezone.now() - timedelta(days=1)
    failed = AuthChallenge.objects.filter(
        user=user, status=ChallengeStatus.FAILED, updated_at__gte=day_ago
    ).count()

    return assess(
        RiskSignals(
            hours_since_phone_change=hours_since_phone_change,
            # No provider integration yet, so this stays None rather than being
            # guessed. See docs/security.md.
            hours_since_sim_change_reported=None,
            hours_since_device_first_seen=device.hours_since_first_seen if device else None,
            device_is_new=device is None,
            failed_verifications_last_day=failed,
        )
    )


@transaction.atomic
def require_step_up(*, user, action: str, ip_address: str | None = None) -> AuthChallenge:
    """Send a fresh code before a sensitive action.

    Re-entering a code proves the person holding this session still holds the
    number now. That is exactly what a borrowed unlocked phone does not.
    """
    return start_challenge(
        raw_phone=user.phone,
        purpose=ChallengePurpose.STEP_UP,
        ip_address=ip_address,
        user=user,
    )


@transaction.atomic
def confirm_step_up(*, user, challenge_id, code: str, action: str) -> bool:
    challenge = verify_challenge(challenge_id=challenge_id, code=code)
    if challenge.user_id != user.id or challenge.purpose != ChallengePurpose.STEP_UP:
        raise PermissionDenied("That confirmation does not match this action.")

    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        metadata={"event": "step_up_confirmed", "action": action},
    )
    return True


# --- roles -------------------------------------------------------------------


@transaction.atomic
def grant_role(*, user, role: str, granted_by=None, make_primary: bool = False) -> UserRole:
    if role in (Role.ADMIN, Role.SUPPORT) and (granted_by is None or not granted_by.is_staff):
        raise PermissionDenied("Only staff can grant staff roles.")

    existing = user.role_assignments.filter(role=role, revoked_at__isnull=True).first()
    if existing:
        if make_primary and not existing.is_primary:
            user.role_assignments.filter(is_primary=True, revoked_at__isnull=True).update(
                is_primary=False
            )
            existing.is_primary = True
            existing.save(update_fields=["is_primary"])
        return existing

    if make_primary:
        user.role_assignments.filter(is_primary=True, revoked_at__isnull=True).update(
            is_primary=False
        )

    assignment = UserRole.objects.create(
        user=user, role=role, is_primary=make_primary, granted_by=granted_by
    )
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=granted_by or user,
        changes={"roles": [sorted(user.roles - {role}), sorted(user.roles)]},
        metadata={"granted": role},
    )
    emit(DomainEvent("identity.role_granted.v1", "user", str(user.id), {"role": role}))
    return assignment


@transaction.atomic
def select_onboarding_intent(*, user, intent: str):
    """Persist product intent separately from resource-scoped authorization."""
    from .models import Intent, UserIntent

    if not (user.first_name.strip() and user.last_name.strip()):
        raise ValidationFailed("Tell us your first and last name before choosing what to do.")
    # Choosing "I own or manage property" used to grant the landlord role here,
    # which made a dropdown selection the whole of the check. It now grants
    # nothing: the intent is recorded, and provider standing is decided by the
    # verification that exists to decide it.
    roles_by_intent = {
        Intent.FIND_PROPERTY: [Role.TENANT],
        Intent.CURRENT_TENANT: [Role.TENANT],
        Intent.MANAGE_PROPERTY: [],
    }
    if intent not in roles_by_intent:
        raise ValidationFailed("Choose find a property, current tenant, or own/manage property.")
    selected = roles_by_intent[intent]

    UserIntent.objects.filter(user=user, is_primary=True).exclude(intent=intent).update(
        is_primary=False
    )
    selection, _ = UserIntent.objects.get_or_create(
        user=user,
        intent=intent,
        defaults={"is_primary": True},
    )
    if not selection.is_primary:
        selection.is_primary = True
    selection.last_selected_at = timezone.now()
    selection.save(update_fields=["is_primary", "last_selected_at"])

    assignments = []
    for index, selected_role in enumerate(selected):
        assignments.append(
            grant_role(
                user=user,
                role=selected_role,
                granted_by=user,
                make_primary=user.primary_role is None and index == 0,
            )
        )
    was_complete = user.onboarding_completed_at is not None
    if not was_complete:
        user.onboarding_completed_at = timezone.now()
        user.save(update_fields=["onboarding_completed_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        changes={
            "onboarding_state": [
                "complete" if was_complete else "intent_required",
                "complete",
            ]
        },
        metadata={"selected_intent": intent, "compatibility_roles": selected},
    )
    return selection


@transaction.atomic
def select_onboarding_role(*, user, role: str | None = None, intent: str | None = None):
    """Compatibility adapter for installed clients using the old vocabulary."""
    legacy = {
        Role.TENANT: "find_property",
        Role.LANDLORD: "manage_property",
        Role.AGENT: "manage_property",
        "find_rental": "find_property",
        "list_property": "manage_property",
    }
    if intent == "both":
        select_onboarding_intent(user=user, intent="find_property")
        return select_onboarding_intent(user=user, intent="manage_property")
    return select_onboarding_intent(user=user, intent=legacy.get(intent or role, intent or role))


@transaction.atomic
def complete_onboarding(*, user, data: dict) -> None:
    """Save the minimum name step before intent selection."""
    preferred_name = str(data.get("preferred_name", "")).strip()
    first_name = str(data.get("first_name", "")).strip()
    last_name = str(data.get("last_name", "")).strip()
    effective_first = first_name or user.first_name.strip()
    effective_last = last_name or user.last_name.strip()
    if not effective_first or not effective_last:
        raise ValidationFailed("Enter both your first name and last name.")

    changed_fields = []
    for field, value in (
        ("preferred_name", preferred_name),
        ("first_name", first_name),
        ("last_name", last_name),
    ):
        if value and getattr(user, field) != value:
            setattr(user, field, value)
            changed_fields.append(field)

    was_incomplete = user.onboarding_completed_at is None
    # Compatibility for older installed clients that selected a context before
    # updating to the new name-first flow. New accounts have no role here and
    # remain signed in at intent_required.
    if was_incomplete and user.primary_role is not None:
        user.onboarding_completed_at = timezone.now()
        changed_fields.append("onboarding_completed_at")

    if changed_fields:
        user.save(update_fields=[*changed_fields, "updated_at"])
    if was_incomplete and user.primary_role is not None:
        record(
            action=AuditAction.UPDATE,
            aggregate_type="user",
            aggregate_id=user.id,
            actor=user,
            changes={"onboarding_state": ["required", "complete"]},
            metadata={"initial_context": user.primary_role},
        )


@transaction.atomic
def revoke_role(*, user, role: str, revoked_by=None, reason: str = "") -> None:
    assignment = user.role_assignments.filter(role=role, revoked_at__isnull=True).first()
    if assignment is None:
        raise ValidationFailed("That role is not currently held.")

    # There used to be a "an account must keep at least one role" rule here,
    # because a roleless account had no navigation to fall back on. It now does:
    # holding no role is exactly what a declared provider awaiting review looks
    # like, and they land on discovery. Keeping the rule would have meant a
    # revoked provider kept the landlord role forever for want of a replacement,
    # which is the state this release exists to make impossible.
    was_primary = assignment.is_primary
    assignment.revoked_at = timezone.now()
    assignment.revoked_reason = reason
    assignment.is_primary = False
    assignment.save(update_fields=["revoked_at", "revoked_reason", "is_primary"])

    # Keep a deterministic presentation default when the primary grant is
    # removed. This does not grant or revoke any authorization.
    if was_primary:
        replacement = (
            user.role_assignments.filter(revoked_at__isnull=True).order_by("granted_at").first()
        )
        if replacement:
            replacement.is_primary = True
            replacement.save(update_fields=["is_primary"])

    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=revoked_by,
        metadata={"revoked": role, "reason": reason},
    )
    # Roles are embedded in access tokens, so a revoked role lingers until the
    # token expires. Signing the user's sessions out closes that window
    # immediately, which is the right trade when removing access.
    sign_out_everywhere(user=user, reason="role_revoked")


# --- registration ------------------------------------------------------------

#: Ghanaian contract law puts capacity at 18, and both sides of this product are
#: contracts: a tenancy on one side, a letting on the other.
MINIMUM_AGE_YEARS = 18


def _field_error(field: str, message: str) -> ValidationFailed:
    """A validation failure a form can attach to the input that caused it.

    ``details.fields`` matches the shape DRF's own serializer errors arrive in,
    so clients have one code path for both and can highlight the field rather
    than showing a sentence next to a form and leaving the person to guess which
    box it is about.
    """
    return ValidationFailed(message, details={"fields": {field: [message]}})


def password_messages(password: str, *, user) -> list[str]:
    """Everything wrong with this password, or an empty list.

    Returns rather than raises, so a form can be told about the password and the
    date of birth in one response instead of one per attempt.
    """
    from django.contrib.auth.password_validation import validate_password
    from django.core.exceptions import ValidationError as DjangoValidationError

    if not password:
        return ["Choose a password."]
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        return list(exc.messages)
    return []


def _validate_password(password: str, *, user, field: str = "password") -> str:
    problems = password_messages(password, user=user)
    if problems:
        raise ValidationFailed(" ".join(problems), details={"fields": {field: problems}})
    return password


def date_of_birth_message(value) -> str | None:
    """What is wrong with this date of birth, or None."""
    from datetime import date

    if value is None:
        return "Enter your date of birth."
    today = date.today()
    if value > today:
        return "That date of birth is in the future."
    age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
    if age < MINIMUM_AGE_YEARS:
        return f"You must be at least {MINIMUM_AGE_YEARS} to hold an account."
    if age > 120:
        return "Check that date of birth."
    return None


def _validate_date_of_birth(value):
    message = date_of_birth_message(value)
    if message:
        raise _field_error("date_of_birth", message)
    return value


@transaction.atomic
def complete_registration(*, user=None, ticket: str = "", data: dict) -> User:
    """Create the account: what they came to be, who they are, a credential.

    Separate from onboarding on purpose. Onboarding is a product journey someone
    can abandon and resume; this is the single point at which someone becomes a
    member of the platform at all.

    Two ways in. A ``ticket`` is the normal one — a number proved minutes ago
    with no row behind it — and the account is created here, inside this
    transaction, so a form that fails validation leaves nothing: the row is
    rolled back with everything else. A ``user`` is an unfinished row from
    before tickets existed, finished in place.
    """
    from apps.trust.services import record_phone_verification

    from .models import AccountType

    created_now = False
    challenge_id = ""

    if user is None:
        if not ticket:
            raise PermissionDenied("Confirm your phone number first.")
        phone, challenge_id = open_registration_ticket(ticket)
        existing = User.objects.filter(phone=phone).first()
        if existing is not None:
            # Someone finished registering on this number between the ticket
            # being cut and it being spent. Two tabs, usually.
            if existing.is_registration_complete:
                raise AccountExists()
            user = existing
        else:
            # The profile comes from the get_or_create further down, which every
            # path already goes through.
            user = User.objects.create_user(
                phone=phone,
                is_phone_verified=True,
                phone_verified_at=timezone.now(),
            )
            created_now = True

    if user.is_registration_complete:
        raise Conflict("This account is already set up.")
    if not user.is_phone_verified:
        raise PermissionDenied("Confirm your phone number first.")

    # Every problem is collected before anything is raised. A form that reports
    # one fault per submission makes someone with four faults submit five times,
    # which on a slow connection is how a sign-up gets abandoned.
    errors: dict[str, list[str]] = {}

    account_type = data.get("account_type")
    if account_type not in AccountType.values:
        errors["account_type"] = ["Choose whether you are a tenant or a property provider."]

    first_name = str(data.get("first_name", "")).strip()
    last_name = str(data.get("last_name", "")).strip()
    if not first_name:
        errors["first_name"] = ["Enter your first name."]
    if not last_name:
        errors["last_name"] = ["Enter your last name."]

    date_of_birth = data.get("date_of_birth")
    date_problem = date_of_birth_message(date_of_birth)
    if date_problem:
        errors["date_of_birth"] = [date_problem]

    email = str(data.get("email") or "").strip().lower()
    if email and User.objects.filter(email=email).exclude(pk=user.pk).exists():
        errors["email"] = ["That email address is already in use."]

    password = str(data.get("password") or "")
    password_problems = password_messages(password, user=user)
    if password_problems:
        errors["password"] = password_problems

    if errors:
        raise ValidationFailed("Some of the details need fixing.", details={"fields": errors})

    user.account_type = account_type
    user.first_name = first_name
    user.last_name = last_name
    user.preferred_name = str(data.get("preferred_name", "")).strip()
    user.date_of_birth = date_of_birth
    user.email = email or None
    user.set_password(password)
    user.save(
        update_fields=[
            "account_type",
            "first_name",
            "last_name",
            "preferred_name",
            "date_of_birth",
            "email",
            "password",
            "updated_at",
        ]
    )
    Profile.objects.get_or_create(user=user)

    # The dated, evidenced record of the number being proved, which used to be
    # written at the OTP step. It belongs to an account, so it waits until there
    # is one.
    if created_now:
        record_phone_verification(user, challenge_id=challenge_id)

    # Tenant capability is the one that costs nobody anything to hold: everything
    # behind it either needs the other party's agreement or is reversible.
    # Provider capability is granted at no account type here — that is what
    # provider verification decides, and granting it on a self-declaration would
    # be the exact hole this design exists to close.
    if account_type == AccountType.TENANT:
        grant_role(user=user, role=Role.TENANT, granted_by=user, make_primary=True)

    record(
        action=AuditAction.UPDATE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        metadata={"registration_completed": True, "account_type": account_type},
    )
    emit(
        DomainEvent(
            "identity.registration_completed.v1",
            "user",
            str(user.id),
            {"account_type": account_type},
        )
    )
    return user


# --- password authentication -------------------------------------------------

PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60


def sign_in_with_password(
    *,
    raw_phone: str,
    password: str,
    device_fingerprint: str = "",
    platform: str = DevicePlatform.ANDROID,
    device_label: str = "",
    app_version: str = "",
    os_version: str = "",
    ip_address: str | None = None,
    user_agent: str = "",
) -> dict:
    """The normal way in. One generic failure for almost every way it can fail.

    Wrong number, wrong password, closed account and unfinished registration
    answer alike, because distinguishing them turns this endpoint into an oracle
    for which numbers hold accounts. The one deliberate exception is an account
    with no password at all: those predate password sign-in, and staying generic
    would leave their owners locked out with no idea why.

    Deliberately not wrapped in a transaction. The audit entry for a failed
    attempt is written and then an exception is raised, so an enclosing atomic
    block would roll that record back — and a sign-in that did not happen is
    evidence too. The session write that follows is atomic on its own.
    """
    generic = PermissionDenied("That phone number and password do not match.")
    try:
        phone = normalise_ghana_msisdn(raw_phone)
    except DomainError as exc:
        raise generic from exc

    user = User.objects.filter(phone=phone).first()
    if user is None:
        raise generic
    if user.is_staff:
        raise PermissionDenied("The phone number and password do not match")
    if not user.has_usable_password():
        raise PermissionDenied(
            "This account was created before passwords. Choose 'Forgot password' "
            "to set one using a code sent to your number."
        )
    if not user.check_password(password):
        record(
            action=AuditAction.LOGIN_FAILED,
            aggregate_type="user",
            aggregate_id=user.id,
            metadata={"reason": "bad_password"},
        )
        raise generic
    if not user.is_active:
        raise PermissionDenied(
            "This account is closed. Contact support if you think that is wrong."
        )
    if not user.is_registration_complete:
        raise PermissionDenied("This account was never finished. Start again to complete it.")

    return _establish_session(
        user=user,
        created=False,
        device_fingerprint=device_fingerprint,
        platform=platform,
        device_label=device_label,
        app_version=app_version,
        os_version=os_version,
        ip_address=ip_address,
        user_agent=user_agent,
        audit_metadata={"method": "password"},
    )


def verify_password_reset(*, challenge_id, code: str, ip_address: str | None = None) -> str:
    """Exchange a recovery code for a short-lived token authorising one reset.

    A token rather than a session: proving the number should let someone set a
    password and nothing else. If a swapped SIM gets this far, the attacker's
    reach ends at a password change the real owner is told about by SMS.
    """
    challenge = verify_challenge(challenge_id=challenge_id, code=code, ip_address=ip_address)
    if challenge.purpose != ChallengePurpose.RECOVER_ACCOUNT:
        raise PermissionDenied("That code was not issued for a password reset.")

    user = challenge.user or User.objects.filter(phone=challenge.phone).first()
    if user is None:
        raise PermissionDenied("There is no account for that number.")

    return sign_payload(
        {"sub": str(user.id), "act": "password_reset", "cha": str(challenge.id)},
        key=_signing_key(),
        ttl_seconds=PASSWORD_RESET_TOKEN_TTL_SECONDS,
    )


@transaction.atomic
def complete_password_reset(*, reset_token: str, new_password: str) -> User:
    """Set the new password and end every existing session.

    Ending the other sessions is as much the point as the new password: someone
    resetting has usually lost control of something, and leaving live sessions
    open would leave whoever took it still signed in.
    """
    from apps.core.crypto import TokenExpired, TokenInvalid, verify_payload

    try:
        payload = verify_payload(reset_token, key=_signing_key())
    except TokenExpired as exc:
        raise PermissionDenied("That reset has expired. Start again.") from exc
    except TokenInvalid as exc:
        raise PermissionDenied("That reset is not valid. Start again.") from exc

    if payload.get("act") != "password_reset":
        raise PermissionDenied("That token does not authorise a password reset.")

    user = User.objects.filter(id=payload.get("sub")).first()
    if user is None or not user.is_active:
        raise PermissionDenied("That account is not available.")

    _validate_password(new_password, user=user, field="new_password")
    user.set_password(new_password)
    user.save(update_fields=["password", "updated_at"])

    sign_out_everywhere(user=user, reason="password_reset")
    get_sms_provider().send(to=user.phone, body=messages.password_changed())
    record(
        action=AuditAction.PASSWORD_CHANGE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        metadata={"method": "reset"},
    )
    emit(DomainEvent("identity.password_reset.v1", "user", str(user.id), {}))
    return user


def change_password(*, user, current_password: str, new_password: str, except_session=None) -> User:
    """Change a known password. The old one is required even inside a session.

    The checks run outside the transaction so a rejected attempt still leaves an
    audit entry; only the change itself is atomic.
    """
    if not user.has_usable_password():
        raise PermissionDenied(
            "This account has no password yet. Use 'Forgot password' to set one."
        )
    if not user.check_password(current_password):
        record(
            action=AuditAction.LOGIN_FAILED,
            aggregate_type="user",
            aggregate_id=user.id,
            actor=user,
            metadata={"reason": "bad_current_password"},
        )
        raise PermissionDenied("That current password is not right.")
    if current_password == new_password:
        raise ValidationFailed("Choose a password different from your current one.")
    _validate_password(new_password, user=user, field="new_password")

    with transaction.atomic():
        user.set_password(new_password)
        user.save(update_fields=["password", "updated_at"])

        # The session doing the changing survives; every other one does not, so
        # a password change doubles as the way to evict a device you no longer
        # hold.
        sign_out_everywhere(user=user, except_session=except_session, reason="password_changed")
        record(
            action=AuditAction.PASSWORD_CHANGE,
            aggregate_type="user",
            aggregate_id=user.id,
            actor=user,
            metadata={"method": "change"},
        )
    get_sms_provider().send(to=user.phone, body=messages.password_changed())
    return user


# --- provider standing -------------------------------------------------------

#: What a reviewer will accept as proof of who is asking to operate here.
PROVIDER_EVIDENCE_TYPES = {
    "ghana_card_front",
    "ghana_card_back",
    "passport",
    "drivers_licence",
    "selfie",
    "business_certificate",
    "agency_licence",
}


def provider_verification(user):
    """The account's newest provider decision, whatever it decided.

    Superseded rows are skipped: they are history, and a re-check in progress
    should read as in progress rather than as whatever it replaced.
    """
    from apps.trust.models import SubjectType, Verification, VerificationKind, VerificationStatus

    return (
        Verification.objects.for_subject(SubjectType.USER, user.id)
        .filter(kind=VerificationKind.PROVIDER)
        .exclude(status=VerificationStatus.SUPERSEDED)
        .first()
    )


@transaction.atomic
def start_provider_verification(*, user, documents: list[dict]):
    """Ask to operate as a provider. One submission, one review, one decision.

    This used to demand a current identity check *first*, on the reasoning that
    "who is this" and "may they operate here" are different questions. They are
    — but the evidence is the same government ID, and requiring the answers in
    sequence meant asking someone to upload their Ghana Card, wait for a human,
    and then upload it again. The provider screen offered no way to do the first
    step, so the second could never be reached.

    Identity is an *input* to this decision, not a gate in front of it. The
    reviewer examines the document and decides whether this person may operate;
    approving that also establishes who they are, and
    ``apply_provider_decision`` records the identity verification to say so.
    """
    from apps.trust import services as trust_services
    from apps.trust.models import SubjectType, VerificationKind, VerificationMethod

    if not user.is_phone_verified:
        raise PermissionDenied("Confirm your phone number first.")
    if not user.is_registration_complete:
        raise PermissionDenied("Finish setting up your account first.")
    if not documents:
        raise ValidationFailed("Attach at least one supporting document.")

    verification = trust_services.start_verification(
        subject_type=SubjectType.USER,
        subject_id=user.id,
        kind=VerificationKind.PROVIDER,
        method=VerificationMethod.DOCUMENT_REVIEW,
        submitted_by=user,
    )
    for document in documents:
        evidence_type = document.get("evidence_type")
        if evidence_type not in PROVIDER_EVIDENCE_TYPES:
            raise ValidationFailed("That document type is not accepted here.")
        file = document.get("file")
        if file is None or not file.is_usable or not file.is_owned_by(user):
            raise PermissionDenied("Every document must be ready and uploaded by you.")
        trust_services.attach_evidence(
            verification,
            evidence_type=evidence_type,
            file=file,
            collected_by=user,
            notes="Submitted with provider verification.",
        )
    return verification


@transaction.atomic
def apply_provider_decision(
    *, verification, approved: bool, decided_by=None, management_actor=None
) -> None:
    """Keep the coarse provider role in step with the account-level decision.

    The verification is the authority; this role only decides which navigation a
    client is offered. Nothing reads it to answer whether an action is allowed,
    which is why it can be maintained here as a consequence rather than being
    something a client can ask for.

    Approval is also the moment somebody becomes a provider, and a provider is
    somebody with a Portfolio — so Rooomly provisions it here. It is the only
    place in the product where a Portfolio comes into existence: a workspace
    that is furnished when its owner first walks into it, rather than a setup
    form standing between them and the work they came to do.
    """
    user = User.objects.filter(id=verification.subject_id).first()
    if user is None:
        return
    if approved:
        _record_identity_from_provider_review(
            user=user,
            verification=verification,
            decided_by=decided_by,
            management_actor=management_actor,
        )
        if not user.has_role(Role.LANDLORD):
            grant_role(user=user, role=Role.LANDLORD, granted_by=None, make_primary=True)
        from apps.organization.services import provision_provider_portfolio

        provision_provider_portfolio(user=user, actor=decided_by)
        return
    if user.has_role(Role.LANDLORD):
        revoke_role(
            user=user,
            role=Role.LANDLORD,
            reason="provider verification is no longer approved",
        )


def _record_identity_from_provider_review(
    *, user, verification, decided_by, management_actor=None
) -> None:
    """Write down that approving a provider also established who they are.

    A reviewer who approves a provider has just examined their government ID, so
    the identity question is answered — but only a record says so, and the rest
    of the product reads records rather than inferences. The evidence is copied
    onto the new verification rather than referenced, so an identity dispute can
    be re-examined against its own attachments instead of following a trail into
    a different decision.

    Never overwrites a current identity check: a person who verified separately
    keeps the check they already have.
    """
    from apps.trust.models import (
        VALIDITY_DAYS,
        SubjectType,
        Verification,
        VerificationEvidence,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )
    from apps.trust.services import current_for

    if current_for(SubjectType.USER, user.id, VerificationKind.IDENTITY) is not None:
        return

    # A live-but-undecided identity check is left alone; two live rows of one
    # kind is exactly what the trust domain's uniqueness constraint forbids.
    if (
        Verification.objects.for_subject(SubjectType.USER, user.id)
        .filter(
            kind=VerificationKind.IDENTITY,
            status__in=[VerificationStatus.PENDING, VerificationStatus.NEEDS_MORE],
        )
        .exists()
    ):
        return

    days = VALIDITY_DAYS.get(VerificationKind.IDENTITY)
    identity = Verification.objects.create(
        subject_type=SubjectType.USER,
        subject_id=str(user.id),
        kind=VerificationKind.IDENTITY,
        method=VerificationMethod.DOCUMENT_REVIEW,
        status=VerificationStatus.APPROVED,
        submitted_by=user,
        decided_by=decided_by,
        # Reviews come from the operations portal, whose principals are not
        # identity.User rows — so without this the derived record would name
        # nobody, and "who approved this identity" would have no answer.
        decided_by_management_id=getattr(management_actor, "id", None),
        decided_at=timezone.now(),
        expires_at=timezone.now() + timedelta(days=days) if days else None,
        decision_note="Established from the government ID reviewed for provider verification.",
        internal_note=f"Derived from provider verification {verification.id}.",
    )
    for evidence in verification.evidence.all():
        VerificationEvidence.objects.create(
            verification=identity,
            evidence_type=evidence.evidence_type,
            file=evidence.file,
            reference=evidence.reference,
            checksum_at_attach=evidence.checksum_at_attach,
            collected_by=evidence.collected_by,
            notes="Copied from the provider verification it was submitted with.",
        )


#: The three experiences a person can be *in*, as distinct from anything they
#: are allowed to do. Discovery needs no account at all; the other two need a
#: capability, which is a separate question answered below.
WORKSPACE_DISCOVERY = "discovery"
WORKSPACE_TENANT = "tenant"
WORKSPACE_PROVIDER = "provider"

#: Which experience each stated journey corresponds to. The welcome screen picks
#: a journey; this is the only thing that picking one does.
WORKSPACE_BY_INTENT = {
    "find_property": WORKSPACE_DISCOVERY,
    "current_tenant": WORKSPACE_TENANT,
    "manage_property": WORKSPACE_PROVIDER,
}


def declared_provider_journey(user) -> bool:
    """Has this person entered the provider journey on their own account.

    True for an account registered as a provider and for one with a provider
    verification of any outcome. Both mean "show them the provider journey";
    neither means "let them operate", which is what the verification decides.

    Deliberately not true for somebody who merely asked for the provider
    workspace. That used to count, back when asking was itself a declaration —
    and once Team members could open the workspace too it would have put every
    invited manager in front of an independent provider verification they do not
    need and were never asked for.
    """
    from .models import AccountType

    if user.account_type == AccountType.PROVIDER:
        return True
    return provider_verification(user) is not None


def _may_enter_provider(user) -> bool:
    """Whether the provider experience is open to this account at all.

    Two independent doors. The first is their own journey; the second is a
    Portfolio somebody else stands behind, which is what an accepted Team
    invitation is — and the reason a member is never routed to onboarding.
    """
    from apps.organization.services import operates_through_membership

    return declared_provider_journey(user) or operates_through_membership(user)


def account_capabilities(user) -> dict:
    """What this account may actually reach, decided here and nowhere else.

    Clients render from this. They do not compute it, and specifically they do
    not infer provider access from ``account_type``: that field records what
    someone said they came here to be, and saying it is not being it.

    Three separate ideas live here and are deliberately not collapsed:

    * **which experience the person is currently in** (``active_workspace``) —
      a navigation fact, changed by asking, granting nothing;
    * **which experiences they may enter** (``available_workspaces``) — what the
      capabilities below actually permit;
    * **what they may do there** — the per-side blocks, decided by verification.

    Conflating the first two is what let a workspace choice act as a grant.
    Conflating the last two is what let a role name act as an approval.
    """
    from apps.trust.models import SubjectType, VerificationKind, VerificationStatus
    from apps.trust.services import current_for

    latest = provider_verification(user)
    approved = current_for(SubjectType.USER, user.id, VerificationKind.PROVIDER)

    if latest is None:
        status = "not_started"
    elif latest.status == VerificationStatus.APPROVED and approved is None:
        # Approved but no longer current. Saying "approved" here would promise
        # access the next call will refuse.
        status = "expired"
    else:
        status = latest.status

    from apps.organization.services import operates_through_membership

    provider_exists = declared_provider_journey(user)
    tenant_access = user.has_role(Role.TENANT)
    # The second way into the provider workspace, and the one this used to miss:
    # a Portfolio somebody else stands behind, entered by invitation. It opens
    # the workspace without making the member a provider — `exists` stays false
    # for them, because they declared nothing and are owed no review of their
    # own. What they may do inside is decided per Portfolio; see
    # `organization.services.membership_access`.
    team_access = operates_through_membership(user)

    # Onboarding is finished the moment evidence is submitted. Waiting on a
    # reviewer is not an unfinished account, and treating it as one would send
    # someone who has done everything asked of them back to the form.
    onboarding_complete = latest is not None

    # The workspace opens on approval, and not before.
    #
    # A submitted-but-pending provider was briefly let in, on the reasoning that
    # they had done everything asked of them. In practice there was nothing for
    # them to do once inside — every action in the workspace begins with owning
    # a property, and that waits for the decision — so the room was empty and
    # the emptiness read as a broken account. The verification screen answers
    # the question they actually have, which is "where is my review".
    approved_to_operate = approved is not None

    available = [WORKSPACE_DISCOVERY]
    if tenant_access:
        available.append(WORKSPACE_TENANT)
    if provider_exists or team_access:
        available.append(WORKSPACE_PROVIDER)

    return {
        "account_type": user.account_type or None,
        "registration_state": user.registration_state,
        "phone_verified": user.is_phone_verified,
        "active_workspace": active_workspace(user),
        "available_workspaces": available,
        "provider": {
            "exists": provider_exists,
            "verification_status": status if provider_exists else None,
            "onboarding_complete": onboarding_complete,
            # Two questions that no longer have the same answer, which is why
            # they were always named separately. The workspace opens on this
            # person's own approval *or* on a Portfolio membership; creating a
            # Property as oneself still waits for the person's own approval. A
            # Team administrator creates against their Portfolio's standing
            # instead — `organization.membership_access` carries that answer,
            # per Portfolio, because it is a fact about one Portfolio and not
            # about the account.
            "workspace_access": approved_to_operate or team_access,
            "can_create_property": approved_to_operate,
        },
        "tenant": {
            "workspace_access": tenant_access,
        },
    }


def active_workspace(user) -> str:
    """Which experience this person is currently in.

    Read from their stated journey, falling back to what they registered as.
    Never read from a role or a verification: someone whose provider review was
    rejected is still *in* the provider experience, looking at why.
    """
    from .models import AccountType

    selection = (
        user.intent_selections.filter(is_primary=True).values_list("intent", flat=True).first()
    )
    if selection in WORKSPACE_BY_INTENT:
        chosen = WORKSPACE_BY_INTENT[selection]
        # The one thing that overrides the stated choice: a provider workspace
        # nobody can enter. Somebody whose Team membership ended keeps the
        # choice they made while they had one, and reporting it would leave them
        # standing in a workspace that is no longer theirs.
        if chosen != WORKSPACE_PROVIDER or _may_enter_provider(user):
            return chosen
    if user.account_type == AccountType.PROVIDER:
        return WORKSPACE_PROVIDER
    if user.has_role(Role.TENANT):
        return WORKSPACE_TENANT
    return WORKSPACE_DISCOVERY


def ensure_tenant_capability(user):
    """Record tenant capability the first time someone acts as one.

    Applying for a place and asking to view one *are* the acts of being a
    tenant, so this is where the capability is established rather than at a gate
    in front of them. That is deliberate: the product's own entry path is an
    anonymous browser who signs in at the moment they want to apply, and
    refusing them there for want of a capability they are in the middle of
    acquiring would be a wall across the main road.

    What matters for authorization is that the capability is a backend-owned
    record and not an assumption — it is granted here, audited, and readable in
    ``capabilities``. Nothing behind it can be done without the other party's
    agreement, which is why acquiring it on demand costs nobody anything. The
    provider side works the opposite way for the opposite reason.
    """
    if user.has_role(Role.TENANT):
        return None
    return grant_role(user=user, role=Role.TENANT, granted_by=user)


@transaction.atomic
def choose_workspace(*, user, workspace: str):
    """Move between experiences. Navigation, and nothing else.

    This is the whole of what the welcome screen's choice does. It records which
    experience someone wants to be in, and it is explicitly *not* an
    authorization decision:

    * it never touches provider verification, in progress or decided;
    * it never revokes a capability, so switching to the tenant side leaves a
      pending provider review exactly where it was;
    * it never ends the session or creates a second account.

    The one thing it grants is the tenant capability, and only when the tenant
    workspace is asked for. That is the deliberate business rule: everything
    behind tenant capability needs the other party's agreement, so letting
    someone take it on request costs nobody anything.

    The provider side is the reverse, and asymmetric on purpose: this call will
    not put someone into the provider experience who did not register as one.
    It briefly did — a tenant asking for the provider journey was entered into
    it — which made the welcome screen a way to declare yourself a provider, and
    filled the review queue with accounts that had only clicked a button.
    Becoming a provider starts at registration.
    """
    from .models import Intent

    intent_by_workspace = {
        WORKSPACE_DISCOVERY: Intent.FIND_PROPERTY,
        WORKSPACE_TENANT: Intent.CURRENT_TENANT,
        WORKSPACE_PROVIDER: Intent.MANAGE_PROPERTY,
    }
    intent = intent_by_workspace.get(workspace)
    if intent is None:
        raise ValidationFailed("Choose the discovery, tenant or provider experience.")
    if not user.is_registration_complete:
        raise PermissionDenied("Finish setting up your account first.")

    # Asking for the provider side does not make anybody a provider. It is
    # allowed for an account that already declared one, and for a Team member,
    # whose Portfolio was declared by whoever invited them — being invited is
    # the declaration, made by somebody the platform already approved.
    if workspace == WORKSPACE_PROVIDER and not _may_enter_provider(user):
        raise NotAProvider()

    if workspace == WORKSPACE_TENANT and not user.has_role(Role.TENANT):
        grant_role(user=user, role=Role.TENANT, granted_by=user)

    select_onboarding_intent(user=user, intent=intent)
    record(
        action=AuditAction.UPDATE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        metadata={"workspace_selected": workspace},
    )
    return account_capabilities(user)
