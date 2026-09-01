"""Ghana Card number handling.

The Ghana Card (National Identification Authority) number looks like
``GHA-123456789-0``. It is the single most useful identity artefact available
for verification here.

Two rules this module exists to enforce:

1. **Format is checked, identity is not.** A well-formed number proves nothing.
   Only a check against the NIA - or a reviewed document plus a liveness match -
   establishes identity, and that is recorded as evidence with a source and a
   date.
2. **The full number is never stored in the clear.** We keep a peppered hash for
   duplicate detection and the last four digits so a support agent can confirm
   which card a person is talking about. The image lives in object storage under
   the sensitive-file rules, with a retention date.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["GhanaCard", "NationalIdError", "normalise_ghana_card"]

_PATTERN = re.compile(r"^GHA-?(\d{9})-?(\d)$")


class NationalIdError(ValueError):
    """Raised when a Ghana Card number is not well-formed."""


@dataclass(frozen=True, slots=True)
class GhanaCard:
    normalised: str  # GHA-123456789-0
    digits: str  # 1234567890, for hashing
    last4: str


def normalise_ghana_card(raw: str) -> GhanaCard:
    if not raw or not raw.strip():
        raise NationalIdError("Enter your Ghana Card number.")

    candidate = re.sub(r"[\s]+", "", raw.strip().upper())
    if candidate.isdigit() and len(candidate) == 10:
        candidate = f"GHA-{candidate[:9]}-{candidate[9]}"

    match = _PATTERN.match(candidate)
    if not match:
        raise NationalIdError("That is not a Ghana Card number. They look like GHA-123456789-0.")

    body, check = match.groups()
    return GhanaCard(
        normalised=f"GHA-{body}-{check}",
        digits=f"{body}{check}",
        last4=f"{body}{check}"[-4:],
    )
