"""Google Identity Services verification and short-lived registration proof.

The browser never decides that a Google credential is valid. It forwards the
opaque ID token here, where Google's maintained verifier checks the signature,
issuer, audience and expiry. Only the stable ``sub`` claim identifies an
account; email is profile data and a conflict signal, never a merge key.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings

from apps.core.crypto import TokenExpired, TokenInvalid, sign_payload, verify_payload
from apps.core.exceptions import PermissionDenied, ProviderUnavailable

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
            google_requests.Request(),
            client_id,
        )
    except (ValueError, TypeError) as exc:
        raise PermissionDenied("Google could not verify that sign-in. Try again.") from exc
    except google_exceptions.GoogleAuthError as exc:
        raise ProviderUnavailable("Google sign-in is not available right now.") from exc
    except ImportError as exc:  # A broken release should fail closed, without leaking internals.
        raise ProviderUnavailable("Google sign-in is not available right now.") from exc

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
