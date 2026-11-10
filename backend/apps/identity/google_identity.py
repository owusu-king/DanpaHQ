"""Google Identity Services verification and short-lived registration proof.

The browser never decides that a Google credential is valid. It forwards the
opaque ID token here, where Google's maintained verifier checks the signature,
issuer, audience and expiry. Only the stable ``sub`` claim identifies an
account; email is profile data and a conflict signal, never a merge key.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from functools import partial

from django.conf import settings

from apps.core.crypto import TokenExpired, TokenInvalid, sign_payload, verify_payload
from apps.core.exceptions import PermissionDenied, ProviderUnavailable

logger = logging.getLogger(__name__)

# Small measured host/Google clock drift is allowed for issued-at only.
GOOGLE_ISSUED_AT_SKEW_SECONDS = 10

GOOGLE_REGISTRATION_TICKET_TTL_SECONDS = 15 * 60


@dataclass(frozen=True, slots=True)
class GoogleClaims:
    subject: str
    email: str
    first_name: str
    last_name: str


def verify_google_credential(credential: str) -> GoogleClaims:
    """Verify one GIS ID token and return only claims registration needs."""
    client_id = str(getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or "").strip()
    if not client_id:
        raise ProviderUnavailable("Google sign-in is not configured right now.")
    if not credential or len(credential) > 10_000:
        raise PermissionDenied("Google could not verify that sign-in. Try again.")

    try:
        from google.auth import exceptions as google_exceptions
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        payload = id_token.verify_oauth2_token(
            credential,
            partial(google_requests.Request(), timeout=5),
            client_id,
            clock_skew_in_seconds=GOOGLE_ISSUED_AT_SKEW_SECONDS,
        )
        # Google's tolerance applies to both iat and exp. Keep expiry strict:
        # the tolerance fixes small future-issued timestamps, never stale proof.
        expires = payload.get("exp")
        if isinstance(expires, bool) or not isinstance(expires, int | float):
            raise ValueError("Token expiry is missing or malformed")
        if time.time() >= expires:
            raise ValueError("Token expired")
    except ImportError as exc:  # A broken release should fail closed, without leaking internals.
        raise ProviderUnavailable("Google sign-in is not available right now.") from exc
    except (ValueError, TypeError) as exc:
        reason = _google_failure_reason(exc)
        logger.warning("google_sign_in_rejected reason=%s", reason)
        messages = {
            "expired": "That Google sign-in expired. Continue with Google again.",
            "not_yet_valid": (
                "Google sign-in could not confirm the server time. Please try again shortly."
            ),
            "audience": "Google sign-in does not match the app configuration. Contact support.",
        }
        raise PermissionDenied(
            messages.get(reason, "Google could not verify that sign-in. Try again."),
            details={"reason": reason},
        ) from exc
    except google_exceptions.TransportError as exc:
        logger.warning("google_sign_in_unavailable reason=certificate_transport")
        raise ProviderUnavailable("Google sign-in is not available right now.") from exc
    except google_exceptions.GoogleAuthError as exc:
        # Invalid issuers and other rejected proofs are credential failures,
        # not an unavailable Google service. Never log the token or exception.
        logger.warning("google_sign_in_rejected reason=issuer_or_claims")
        raise PermissionDenied(
            "Google could not verify that sign-in. Try again.",
            details={"reason": "issuer_or_claims"},
        ) from exc

    subject = str(payload.get("sub") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    if not subject or len(subject) > 255 or not email or payload.get("email_verified") is not True:
        raise PermissionDenied("Use a Google account with a verified email address.")

    return GoogleClaims(
        subject=subject,
        email=email,
        first_name=str(payload.get("given_name") or "").strip()[:80],
        last_name=str(payload.get("family_name") or "").strip()[:80],
    )


def _google_failure_reason(error: Exception) -> str:
    """Categorize verifier failures without emitting credentials or raw claims."""
    message = str(error).lower()
    if "expired" in message:
        return "expired"
    if "too early" in message or "not yet valid" in message:
        return "not_yet_valid"
    if "audience" in message:
        return "audience"
    if "signature" in message or "certificate" in message:
        return "signature"
    return "malformed"


def issue_google_registration_ticket(claims: GoogleClaims, *, account_type: str) -> str:
    """Proof that Google authenticated this subject for this selected journey."""
    return sign_payload(
        {
            "sub": claims.subject,
            "gem": claims.email,
            "act": "google_registration",
            "typ": account_type,
        },
        key=_signing_key(),
        ttl_seconds=GOOGLE_REGISTRATION_TICKET_TTL_SECONDS,
    )


def open_google_registration_ticket(ticket: str) -> dict[str, str]:
    try:
        payload = verify_payload(ticket, key=_signing_key())
    except TokenExpired as exc:
        raise PermissionDenied(
            "That Google confirmation expired. Continue with Google again."
        ) from exc
    except TokenInvalid as exc:
        raise PermissionDenied("That Google confirmation is not valid. Start again.") from exc

    if payload.get("act") != "google_registration":
        raise PermissionDenied("That token does not authorise creating an account.")
    return {
        "subject": str(payload.get("sub") or ""),
        "email": str(payload.get("gem") or "").strip().lower(),
        "account_type": str(payload.get("typ") or ""),
    }


def _signing_key() -> str:
    return getattr(settings, "ACCESS_TOKEN_KEY", None) or settings.SECRET_KEY
