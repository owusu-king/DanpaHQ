"""GhanaPost GPS digital address handling.

Ghana has patchy street naming and house numbering, so "the blue gate after the
junction, opposite the Melcom" is a normal address. The GhanaPost GPS scheme
(``GA-543-0125``) gives every 5x5m square a code, and it is the single most
useful location primitive available for this product.

This module validates **shape** only. A well-formed code can still point at a
lagoon. Authoritative resolution to coordinates requires the GhanaPost API, and
is modelled as a verified attribute of an address (evidence + source +
timestamp), never as a trusted user input.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["REGION_LETTERS", "DigitalAddressError", "normalise_digital_address"]

# Region letter is the first character of the code. Ghana moved to 16 regions in
# 2019; the letters below follow the GhanaPost scheme.
REGION_LETTERS: dict[str, str] = {
    "A": "Ashanti",
    "B": "Brong Ahafo / Bono",
    "C": "Central",
    "E": "Eastern",
    "G": "Greater Accra",
    "N": "Northern",
    "U": "Upper East",
    "X": "Upper West",
    "V": "Volta",
    "W": "Western",
}

_PATTERN = re.compile(r"^([A-Z])([A-Z0-9])-(\d{3})-(\d{4,5})$")


class DigitalAddressError(ValueError):
    """Raised when a digital address is not well-formed."""


@dataclass(frozen=True, slots=True)
class DigitalAddress:
    value: str
    region_letter: str
    district_code: str
    area_code: str
    unique_code: str

    @property
    def region_name(self) -> str | None:
        return REGION_LETTERS.get(self.region_letter)


def normalise_digital_address(raw: str) -> DigitalAddress:
    """Normalise ``ga-543-0125`` / ``GA 543 0125`` to ``GA-543-0125``."""
    if not raw or not raw.strip():
        raise DigitalAddressError("Enter a GhanaPost GPS address.")

    candidate = re.sub(r"[\s_]+", "-", raw.strip().upper())
    candidate = re.sub(r"-{2,}", "-", candidate)
    # Accept an unpunctuated run of characters too: GA5430125
    if "-" not in candidate and len(candidate) in (9, 10):
        candidate = f"{candidate[:2]}-{candidate[2:5]}-{candidate[5:]}"

    match = _PATTERN.match(candidate)
    if not match:
        raise DigitalAddressError(
            "That does not look like a GhanaPost GPS address. They look like GA-543-0125."
        )

    region_letter, district, area, unique = match.groups()
    if region_letter not in REGION_LETTERS:
        raise DigitalAddressError(f"{region_letter} is not a Ghanaian region code.")
    return DigitalAddress(
        value=f"{region_letter}{district}-{area}-{unique}",
        region_letter=region_letter,
        district_code=district,
        area_code=area,
        unique_code=unique,
    )
