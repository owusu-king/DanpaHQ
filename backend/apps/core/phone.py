"""Ghanaian phone number handling.

The phone number is the spine of this product's identity model: it is how a
tenant signs in, how a landlord is reached, and how mobile money settles. That
makes normalisation a correctness problem, not a formatting nicety - the same
person must not be able to create two accounts by typing ``0241234567`` once and
``+233 24 123 4567`` the next time.

Everything is stored in E.164 (``+233241234567``). Display formatting happens at
the edges only.

Important limitation, deliberately encoded here: **prefix does not tell you the
network.** Ghana has had mobile number portability since 2011, so 024 numbers
routinely sit on Telecel or AirtelTigo. ``guess_network`` returns the *original
allocation* and is only ever a UI hint or an analytics prior. Payment routing
must resolve the live network through the provider, never through this table.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = [
    "GHANA_COUNTRY_CODE",
    "NetworkHint",
    "PhoneNumberError",
    "format_national",
    "guess_network",
    "normalise_ghana_msisdn",
]

GHANA_COUNTRY_CODE = "233"
_NSN_LENGTH = 9  # national significant number, excluding the trunk 0

_NON_DIGITS = re.compile(r"[^\d+]")

# Original NCA allocations. Kept as data, reviewed as data - see
# docs/architecture/adr/0004-phone-first-identity.md for the update process.
_ALLOCATIONS: dict[str, str] = {
    "24": "MTN",
    "54": "MTN",
    "55": "MTN",
    "59": "MTN",
    "25": "MTN",
    "20": "TELECEL",
    "50": "TELECEL",
    "27": "AIRTELTIGO",
    "57": "AIRTELTIGO",
    "26": "AIRTELTIGO",
    "56": "AIRTELTIGO",
    "23": "GLO",
}
MOBILE_PREFIXES = frozenset(_ALLOCATIONS)


class PhoneNumberError(ValueError):
    """Raised when input cannot be resolved to a valid Ghanaian number."""


@dataclass(frozen=True, slots=True)
class NetworkHint:
    network: str
    confident: bool  # always False today: portability makes prefix a hint only
    reason: str


def normalise_ghana_msisdn(raw: str, *, mobile_only: bool = True) -> str:
    """Return E.164 (``+233XXXXXXXXX``) or raise :class:`PhoneNumberError`.

    Accepts the shapes people actually type: ``0241234567``, ``024 123 4567``,
    ``+233241234567``, ``00233241234567``, ``233241234567``, ``241234567``.
    """
    if not raw or not raw.strip():
        raise PhoneNumberError("Enter a phone number.")

    cleaned = _NON_DIGITS.sub("", raw.strip())
    if cleaned.startswith("+"):
        cleaned = cleaned[1:]
    if cleaned.startswith("00"):
        cleaned = cleaned[2:]

    if cleaned.startswith(GHANA_COUNTRY_CODE):
        nsn = cleaned[len(GHANA_COUNTRY_CODE) :]
    elif cleaned.startswith("0"):
        nsn = cleaned[1:]
    else:
        nsn = cleaned

    if not nsn.isdigit():
        raise PhoneNumberError("Phone numbers can only contain digits.")
    if len(nsn) != _NSN_LENGTH:
        raise PhoneNumberError(
            "That number is not the right length. A Ghanaian number has 10 digits, "
            "like 024 123 4567."
        )
    if nsn.startswith("0"):
        raise PhoneNumberError("Check the number - it has an extra 0.")
    if mobile_only and nsn[:2] not in MOBILE_PREFIXES:
        raise PhoneNumberError("Use a mobile number so we can send you a verification code.")
    return f"+{GHANA_COUNTRY_CODE}{nsn}"


def format_national(e164: str) -> str:
    """``+233241234567`` -> ``024 123 4567`` for display."""
    nsn = e164.removeprefix(f"+{GHANA_COUNTRY_CODE}")
    if len(nsn) != _NSN_LENGTH or not nsn.isdigit():
        return e164
    return f"0{nsn[:2]} {nsn[2:5]} {nsn[5:]}"


def mask(e164: str) -> str:
    """``+233241234567`` -> ``024 *** 4567`` for logs, receipts and support UIs."""
    nsn = e164.removeprefix(f"+{GHANA_COUNTRY_CODE}")
    if len(nsn) != _NSN_LENGTH or not nsn.isdigit():
        return "***"
    return f"0{nsn[:2]} *** {nsn[5:]}"


def guess_network(e164: str) -> NetworkHint | None:
    """Original network allocation for a number, or ``None`` if unknown."""
    nsn = e164.removeprefix(f"+{GHANA_COUNTRY_CODE}")
    network = _ALLOCATIONS.get(nsn[:2])
    if network is None:
        return None
    return NetworkHint(
        network=network,
        confident=False,
        reason="Prefix allocation only; number portability means the live network "
        "must be confirmed with the payment provider.",
    )
