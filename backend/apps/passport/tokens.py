"""Passport share link tokens.

A share token is derived, not stored: ``HMAC-SHA256(pepper, salt)``, where the
salt is 128 random bits kept on the row and the pepper lives in the secret
store. The row keeps only the token's SHA-256 for lookup.

Why derived rather than random-and-forgotten (the Unit access code's choice in
ADR 0026): the owner has to be able to copy their link again from the list of
active links — sending it to a landlord is the whole point, and "make a new
one, the old one still works" would leave live links nobody can see. Deriving
it keeps that possible without any readable token in the database: a dump alone
yields digests and salts, and turning a salt into a token needs the pepper.
The links are bounded by expiry (at most 30 days) and revocable one at a time.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from django.conf import settings

from apps.core.crypto import hash_token


def _pepper() -> str:
    return getattr(settings, "PASSPORT_SHARE_PEPPER", None) or settings.SECRET_KEY


def new_salt() -> str:
    return secrets.token_hex(16)


def token_for(salt: str) -> str:
    mac = hmac.new(_pepper().encode(), f"passport-share:{salt}".encode(), hashlib.sha256)
    return base64.urlsafe_b64encode(mac.digest()).rstrip(b"=").decode()


def digest(token: str) -> str:
    return hash_token(token)


def looks_like_token(value: str) -> bool:
    """Cheap shape check before any database read: 43 url-safe characters."""
    return (
        isinstance(value, str)
        and len(value) == 43
        and all(ch.isalnum() or ch in "-_" for ch in value)
    )
