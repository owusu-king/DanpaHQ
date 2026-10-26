"""Password/Google-first enrollment, shared by web, native and administrator login."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from reportlab.graphics.barcode.qrencoder import QRCode

from apps.core.crypto import hash_secret, hash_token, random_token
from apps.core.exceptions import PermissionDenied, ValidationFailed
from apps.core.throttling import count_attempt

from . import mfa
from .models import MFAChallenge


def _binding(user):
    standing = (
        user.role
        if hasattr(user, "role")
        else f"{user.is_staff}:{user.is_superuser}:{user.is_email_verified}"
    )
    return hash_secret(
        f"{user.password}:{user.mfa_policy}:{mfa.policy(user)}:{mfa.device_id(user)}:{standing}",
        pepper=mfa._key(),
        salt=f"mfa-login:{user.pk}",
    )


def _qr_svg(uri):
    # Generate locally. Never send enrollment secrets to an external QR service.
    qr = QRCode(version=None, errorCorrectLevel=1)
    qr.addData(uri)
    qr.make()
    size = len(qr.modules)
    path = " ".join(
        f"M{x + 4},{y + 4}h1v1h-1z"
        for y, row in enumerate(qr.modules)
        for x, dark in enumerate(row)
        if dark
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size + 8} {size + 8}">'
        f'<rect width="100%" height="100%" fill="white"/>'
        f'<path d="{path}" fill="black"/></svg>'
    )


def _payload(challenge, token, user):
    result = {
        "mfa_required": True,
        "challenge_token": token,
        "stage": challenge.stage,
        "can_skip": challenge.stage == "enroll" and not mfa.required(user),
        "expires_in": max(0, int((challenge.expires_at - timezone.now()).total_seconds())),
    }
    if challenge.stage == "enroll":
        secret = mfa._cipher().decrypt(challenge.secret_ciphertext.encode()).decode()
        uri = mfa.provisioning_uri(user=user, secret=secret)
        result.update(secret=secret, provisioning_uri=uri, qr_svg=_qr_svg(uri))
    return result


def begin(*, user, surface, context=None):
    """Called only after a valid primary credential; never from an email lookup."""
    if mfa.policy(user) == "disabled":
        return None
    scope = f"mfa-enrollment:{surface}:{user.pk}"
    if count_attempt(scope, window=300, scope="mfa_login") > 10:
        raise PermissionDenied("Too many sign-in attempts. Try again later.")
    token = random_token()
    secret = mfa.new_secret() if mfa.device_id(user) is None else ""
    challenge = MFAChallenge.objects.create(
        **mfa._principal(user),
        token_hash=hash_token(token),
        binding=_binding(user),
        surface=surface,
        stage="enroll" if secret else "verify",
        secret_ciphertext=mfa._cipher().encrypt(secret.encode()).decode() if secret else "",
        context=context or {},
        expires_at=timezone.now() + timedelta(minutes=5),
    )
    return _payload(challenge, token, user)


def finish(*, token, surface, code="", action="verify", client=""):
    """Consume once, with no application session until both factors are proved.

    Failed attempts commit before raising, so concurrent retries cannot reset the budget.
    """
    failure = None
    result = None
    with transaction.atomic():
        challenge = (
            MFAChallenge.objects.select_for_update()
            .filter(
                token_hash=hash_token(token),
                surface=surface,
            )
            .first()
        )
        if (
            challenge is None
            or challenge.consumed_at
            or challenge.expires_at <= timezone.now()
            or challenge.attempts >= 10
        ):
            raise PermissionDenied("This sign-in has expired. Sign in again.")
        principal = challenge.management_user or challenge.django_user
        user = type(principal).objects.select_for_update().get(pk=principal.pk)
        if (
            not user.is_active
            or (surface == "management" and user.is_locked)
            or (surface == "consumer" and (user.is_staff or not user.is_registration_complete))
            or challenge.binding != _binding(user)
            or challenge.context.get("client", "") != client
        ):
            raise PermissionDenied("This sign-in has changed. Sign in again.")
        challenge.attempts += 1
        challenge.save(update_fields=["attempts", "updated_at"])
        proof = None
        if action == "skip" and challenge.stage == "enroll" and not mfa.required(user):
            proof = mfa.Proof(True)
        elif action == "complete" and challenge.stage == "recovery":
            if mfa.session_valid(user, challenge.verified_device_id):
                proof = mfa.Proof(True, challenge.verified_device_id)
        elif action == "verify" and challenge.stage == "verify":
            proof = mfa.verify(user, code)
        elif action == "verify" and challenge.stage == "enroll":
            secret = mfa._cipher().decrypt(challenge.secret_ciphertext.encode()).decode()
            enrollment_attempts = count_attempt(
                f"mfa-enroll-proof:{surface}:{user.pk}",
                window=300,
                scope="mfa_login",
            )
            if (
                enrollment_attempts <= 10
                and mfa._matching_counter(secret, code.strip()) is not None
            ):
                recovery = mfa.enroll(
                    user=user,
                    secret=secret,
                    code=code,
                    allow_consumer=surface == "consumer",
                )
                challenge.stage = "recovery"
                challenge.secret_ciphertext = ""
                challenge.verified_device_id = mfa.device_id(user)
                challenge.binding = _binding(user)
                challenge.save(
                    update_fields=[
                        "stage",
                        "secret_ciphertext",
                        "verified_device_id",
                        "binding",
                        "updated_at",
                    ]
                )
                result = {**_payload(challenge, token, user), "recovery_codes": recovery}
        if proof and proof.accepted:
            challenge.consumed_at = timezone.now()
            challenge.secret_ciphertext = ""
            challenge.save(update_fields=["consumed_at", "secret_ciphertext", "updated_at"])
            context = {key: value for key, value in challenge.context.items() if key != "client"}
            if surface == "consumer":
                from apps.identity.services import _establish_session

                result = _establish_session(
                    user=user,
                    created=False,
                    mfa_proof=proof,
                    **context,
                )
            elif surface == "management":
                from .services import _complete_management_login

                result = _complete_management_login(user=user, mfa_proof=proof, **context)
            else:
                user._admin_mfa_device_id = proof.credential_id
                result = user
        if result is None:
            failure = ValidationFailed("That code did not match. Try again.")
    if failure:
        raise failure
    return result


def resume(*, token, surface, client=""):
    """Redisplay only an existing enrollment after an invalid form submission."""
    challenge = MFAChallenge.objects.filter(
        token_hash=hash_token(token),
        surface=surface,
        consumed_at__isnull=True,
        expires_at__gt=timezone.now(),
        attempts__lt=10,
    ).first()
    if challenge is None or challenge.context.get("client", "") != client:
        return None
    user = challenge.management_user or challenge.django_user
    if challenge.binding != _binding(user) or not user.is_active:
        return None
    return _payload(challenge, token, user)
