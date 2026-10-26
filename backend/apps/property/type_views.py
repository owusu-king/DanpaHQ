"""What a property may contain, read rather than duplicated in each client.

Both clients need to offer the right rentable-space types for the chosen
category, and the obvious way to do that is a lookup table in each of them. Then
there are three copies of the matrix, the backend's is the only one enforced, and
the two clients drift from it at different rates.

So this serves the same `space_rules` the validation uses. A client cannot offer
an option the backend would refuse, and the backend refusing does not depend on
the client having asked.

Open to anyone, and cached hard: it is a description of the product's
vocabulary, not of anybody's data. Public because the listing browser needs it
while signed out — a renter filtering by "hostel" has to be offered the word the
backend actually stores, and hardcoding the list in a public page is how that
filter came to offer four categories that no longer exist and matched nothing.
"""

from __future__ import annotations

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    LETTING_TYPES,
    SALE_TYPES,
    UNANSWERED_FACT,
    CompoundType,
    PowerMeterType,
    PropertyType,
    WaterSource,
)
from .space_rules import space_type_options

#: How each sale category reads to a seller choosing it.
SALE_LABELS = {
    PropertyType.RESIDENTIAL: "House or apartment",
    PropertyType.COMMERCIAL: "Commercial property",
    PropertyType.LAND: "Land",
}


def _options(choices) -> list[dict]:
    # "Not stated" is where a fact starts, never an answer somebody picks.
    return [
        {"value": value, "label": label} for value, label in choices if value != UNANSWERED_FACT
    ]


class PropertyTypeOptionsView(APIView):
    """GET /property-types/ — the property vocabulary, whole.

    The categories and what each may contain, plus the three Ghana-specific
    facts a property is described by: where its water comes from, how its
    electricity is metered, and what kind of compound it sits in.

    Those three are here rather than hardcoded in a form because they are not
    presentation. `trust.evidence_policy` reads them to decide what the property
    is asked to photograph — a borehole or sachet supply makes the water source a
    required view, a family compound or estate adds the compound — so a client
    offering a value the backend does not have would produce a checklist nobody
    can complete. Same reason the space-type matrix is served: one vocabulary,
    read by everyone, drifting nowhere.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "property_types": [
                    {
                        "value": value,
                        "label": label,
                        "space_types": space_type_options(value),
                    }
                    for value, label in PropertyType.choices
                    # The letting categories only: land is sold, never let as a
                    # Property, and a letting form offering it would create a
                    # property no Unit could go into.
                    if value in LETTING_TYPES
                ],
                #: What a property *for sale* may be, named for a buyer.
                "sale_types": [
                    {"value": value, "label": SALE_LABELS[value]}
                    for value, _ in PropertyType.choices
                    if value in SALE_TYPES
                ],
                "water_sources": _options(WaterSource.choices),
                "power_meter_types": _options(PowerMeterType.choices),
                "compound_types": _options(CompoundType.choices),
            }
        )
