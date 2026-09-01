"""Cryptographic primitives for authentication.

Framework-independent so it can be tested directly and reused by workers and
one-off scripts. Nothing here invents a cipher: it composes HMAC-SHA256 and
`secrets` in the specific shapes this product needs.

Three ideas do the work:

* **Peppered hashing** for short secrets. A six-digit OTP has only a million
  possibilities, so a plain SHA-256 of it is reversible by anyone who reaches the
  database. The pepper lives in the application's secret store, not the database,
  so a database dump alone does not yield the codes.
* **Constant-time comparison** everywhere a secret is checked. Early-exit
  comparison leaks how many leading characters were right.
* **Signed, expiring tokens** with a version prefix, so the signing scheme can be
  rotated without invalidating the concept of a token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

__all__ = [
    "TokenError",
    "TokenExpired",
    "TokenInvalid",
    "hash_secret",
    "hash_token",
    "random_code",
    "random_token",
    "sign_payload",
    "verify_payload",
    "verify_secret",
]


# --- short secrets (OTP codes, PINs) ----------------------------------------


def hash_secret(secret: str, *, pepper: str, salt: str = "") -> str:
    """HMAC-SHA256 of a short secret under an application-held pepper."""
    material = f"{salt}:{secret}".encode()
    return hmac.new(pepper.encode(), material, hashlib.sha256).hexdigest()


def verify_secret(secret: str, expected_hash: str, *, pepper: str, salt: str = "") -> bool:
    return hmac.compare_digest(hash_secret(secret, pepper=pepper, salt=salt), expected_hash)


def random_code(digits: int = 6) -> str:
    """A numeric OTP.

    Uniform over the whole range including codes with leading zeros - excluding
    them would shrink the space and bias the first digit.
    """
    if not 4 <= digits <= 10:
        raise ValueError("OTP length must be between 4 and 10 digits")
    upper = 10**digits
    return str(secrets.randbelow(upper)).zfill(digits)


# --- long secrets (refresh tokens, invite links) -----------------------------


def random_token(nbytes: int = 32) -> str:
    """URL-safe random string with at least 256 bits of entropy by default."""
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Store this, never the token.

    No pepper and no salt: the input already has 256 bits of entropy, so there is
    nothing to brute-force and a plain digest keeps lookup a single indexed read.
    """
    return hashlib.sha256(token.encode()).hexdigest()


# --- signed payloads (access tokens) -----------------------------------------


class TokenError(Exception):
    """Base class for token failures."""


class TokenExpired(TokenError):
    pass


class TokenInvalid(TokenError):
    pass


@dataclass(frozen=True, slots=True)
class TokenSpec:
    version: str = "v1"
    algorithm: str = "sha256"


SPEC = TokenSpec()


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def sign_payload(payload: dict, *, key: str, ttl_seconds: int, now: int | None = None) -> str:
    """Return ``v1.<payload>.<signature>``.

    Deliberately not JWT. JWT's `alg` header is a well-known footgun (the `none`
    algorithm, and confusion between HMAC and RSA verification), and this product
    needs exactly one algorithm with no negotiation. The version prefix gives a
    rotation path without importing that complexity.
    """
    issued = int(time.time()) if now is None else now
    body = {**payload, "iat": issued, "exp": issued + ttl_seconds}
    encoded = _b64encode(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    signature = hmac.new(key.encode(), f"{SPEC.version}.{encoded}".encode(), hashlib.sha256)
    return f"{SPEC.version}.{encoded}.{_b64encode(signature.digest())}"


def verify_payload(token: str, *, key: str, now: int | None = None) -> dict:
    """Verify and decode. Raises rather than returning ``None``.

    Order matters: the signature is checked before the payload is trusted for
    anything, including its own expiry.
    """
    try:
        version, encoded, provided = token.split(".")
    except ValueError as exc:
        raise TokenInvalid("Malformed token.") from exc

    if version != SPEC.version:
        raise TokenInvalid("Unsupported token version.")

    expected = hmac.new(key.encode(), f"{version}.{encoded}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64encode(expected), provided):
        raise TokenInvalid("Signature does not match.")

    try:
        body = json.loads(_b64decode(encoded))
    except (ValueError, UnicodeDecodeError) as exc:
        raise TokenInvalid("Unreadable token payload.") from exc

    current = int(time.time()) if now is None else now
    if current >= body.get("exp", 0):
        raise TokenExpired("Token has expired.")
    if body.get("iat", 0) > current + 60:  # tolerate a minute of clock skew
        raise TokenInvalid("Token is not valid yet.")

    return body
