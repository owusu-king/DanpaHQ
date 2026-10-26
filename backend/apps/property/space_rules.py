"""What may be let inside what.

A property type is a *category* — residential, commercial, hostel — and it
decides which kinds of rentable space can exist inside it. That relationship was
previously nowhere: `property_type` held a building kind (house, villa, shop),
`Unit.unit_type` borrowed the same enum, and nothing connected the two. A plot
of land could be given bedrooms and a hostel bed could be attached to a
warehouse, because no layer had an opinion.

This module is that opinion, in one place, so the backend, the two clients and
the tests cannot each hold a slightly different version of it.

### Why the matrix is here and not in the model

The model can only say "this field has these choices". It cannot say "these
choices, *given* the value of another field on another table". That is what makes
combination rules leak into forms — each client ends up with its own copy, and a
request that bypasses the form bypasses the rule with it.

So the rules live here as data, `allowed_space_types` is served to the clients
over the API, and the same function backs the validation. A client cannot show
an option the backend would refuse, and refusing does not depend on the client
having asked.
"""

from __future__ import annotations

from apps.core.exceptions import ValidationFailed

from .models import PropertyType, RentableSpaceType

#: What each category may contain.
#:
#: A hostel is deliberately narrow. Its room may be let whole or by the bed, and
#: nothing else belongs in one — a hostel with a warehouse in it is a mixed-use
#: property that should be recorded as two properties, not one with a confused
#: category.
ALLOWED_SPACE_TYPES: dict[str, tuple[str, ...]] = {
    PropertyType.RESIDENTIAL: (
        RentableSpaceType.APARTMENT,
        RentableSpaceType.HOUSE,
        RentableSpaceType.STUDIO,
        RentableSpaceType.ROOM,
    ),
    #: No land. A plot is its own Property, sold whole through the sale flow;
    #: a plot "inside" a commercial building was never a real arrangement
    #: (owner, 2026-10-05). Existing land Units stay readable.
    PropertyType.COMMERCIAL: (
        RentableSpaceType.SHOP,
        RentableSpaceType.OFFICE,
        RentableSpaceType.WAREHOUSE,
    ),
    PropertyType.HOSTEL: (
        RentableSpaceType.ROOM,
        RentableSpaceType.BED_SPACE,
    ),
}

#: Space types that can be subdivided into individual bed spaces.
#:
#: Only a room. A bed space is already the smallest thing let, and subdividing a
#: shop or a plot is not an arrangement this product models.
ACCEPTS_BED_SPACES: frozenset[str] = frozenset({RentableSpaceType.ROOM})

#: Space types with no interior to describe.
#:
#: Land is the case that motivated this: it has no bedrooms, no bathrooms, no
#: beds and no interior photograph, and letting it carry those fields produced
#: records claiming a plot had two bathrooms.
WITHOUT_INTERIOR: frozenset[str] = frozenset({RentableSpaceType.LAND})

#: Space types that are one sleeping place inside a shared room.
SHARED_ROOM_SPACES: frozenset[str] = frozenset({RentableSpaceType.BED_SPACE})

#: The only space types whose bedrooms are worth counting. A studio, a room or
#: a bed *is* the sleeping space, and a shop or an office has none; asking
#: "how many bedrooms?" of either invites nonsense (owner, 2026-10-05).
COUNTS_BEDROOMS: frozenset[str] = frozenset(
    {RentableSpaceType.APARTMENT, RentableSpaceType.HOUSE}
)

#: Where bathrooms are counted rather than simply present or not. Everywhere
#: else with an interior, one question is enough: does it have its own?
COUNTS_BATHROOMS: frozenset[str] = COUNTS_BEDROOMS

#: No bathroom question at all: a bed shares its room's, a plot has none.
WITHOUT_BATHROOM: frozenset[str] = frozenset(
    {RentableSpaceType.BED_SPACE, RentableSpaceType.LAND}
)

#: Where a floor number means something. A house is the building; a warehouse
#: is a ground-level shed; a bed takes its room's floor.
HAS_FLOOR: frozenset[str] = frozenset(
    {
        RentableSpaceType.APARTMENT,
        RentableSpaceType.STUDIO,
        RentableSpaceType.ROOM,
        RentableSpaceType.SHOP,
        RentableSpaceType.OFFICE,
    }
)


def questions_for(space_type: str) -> dict:
    """Which details a form should ask about a space of this kind.

    `bathrooms` is "count", "yes_no" or "none". Served to both clients so each
    asks the same questions, and backing `normalise_interior` so a client that
    sends a default anyway does not store a shop with a bedroom.
    """
    if space_type in COUNTS_BATHROOMS:
        bathrooms = "count"
    elif space_type in WITHOUT_BATHROOM:
        bathrooms = "none"
    else:
        bathrooms = "yes_no"
    return {
        "bedrooms": space_type in COUNTS_BEDROOMS,
        "bathrooms": bathrooms,
        "floor": space_type in HAS_FLOOR,
    }


def normalise_interior(*, space_type: str, data: dict) -> dict:
    """Clear what this kind of space is not asked, and cap yes/no answers at one.

    Run on creation, where older clients still send a form's defaults (one
    bedroom, one bathroom) whatever was chosen. Clearing is right there: the
    value was never a claim, only an unanswered field.
    """
    asks = questions_for(space_type)
    cleaned = dict(data)
    if not asks["bedrooms"]:
        cleaned["bedrooms"] = 0
    if asks["bathrooms"] == "none":
        cleaned["bathrooms"] = 0
    elif asks["bathrooms"] == "yes_no":
        cleaned["bathrooms"] = 1 if (cleaned.get("bathrooms", 1) or 0) > 0 else 0
    if not asks["floor"]:
        cleaned["floor_level"] = None
    if "bathrooms" in cleaned and asks["bathrooms"] != "count":
        cleaned["has_private_bathroom"] = cleaned["bathrooms"] > 0
    return cleaned


def allowed_space_types(property_type: str) -> tuple[str, ...]:
    """What may be let inside a property of this category.

    Returns an empty tuple for an unknown category rather than guessing. An
    unrecognised category should surface as "nothing may be added yet", not as a
    permissive default that lets anything through.
    """
    return ALLOWED_SPACE_TYPES.get(property_type, ())


def space_type_options(property_type: str) -> list[dict]:
    """The same answer, shaped for a form.

    Served to the clients so neither builds its own copy of the matrix. Labels
    come from the enum, so a reworded choice reaches both clients at once.
    """
    labels = dict(RentableSpaceType.choices)
    return [
        {
            "value": value,
            "label": labels.get(value, value),
            "accepts_bed_spaces": (
                property_type == PropertyType.HOSTEL and value in ACCEPTS_BED_SPACES
            ),
            "has_interior": value not in WITHOUT_INTERIOR,
            "asks": questions_for(value),
        }
        for value in allowed_space_types(property_type)
    ]


def assert_space_type_allowed(*, property_type: str, space_type: str) -> None:
    """Refuse a combination the category does not permit."""
    permitted = allowed_space_types(property_type)
    if not permitted:
        raise ValidationFailed(
            "This property has no category set, so nothing can be added to it yet."
        )
    if space_type not in permitted:
        labels = dict(RentableSpaceType.choices)
        category = dict(PropertyType.choices).get(property_type, property_type)
        readable = ", ".join(labels.get(v, v).lower() for v in permitted)
        raise ValidationFailed(
            f"A {category.lower()} property cannot contain "
            f"{labels.get(space_type, space_type).lower()}. It may contain: {readable}."
        )


def assert_interior_is_coherent(
    *, space_type: str, bedrooms: int | None = None, bathrooms: int | None = None
) -> None:
    """Refuse counts a space of this kind cannot have.

    The rule land motivated. A plot with two bathrooms is not a plot, and
    recording one means every later screen has to decide whether to believe it.
    """
    if space_type not in WITHOUT_INTERIOR:
        return
    if (bedrooms or 0) > 0 or (bathrooms or 0) > 0:
        labels = dict(RentableSpaceType.choices)
        raise ValidationFailed(
            f"{labels.get(space_type, space_type)} has no rooms to count. "
            "Leave bedrooms and bathrooms at zero."
        )


def assert_asked(*, space_type: str, label: str, payload: dict) -> None:
    """Refuse an edit that sets a detail this kind of space is never asked.

    Only what the edit sends is checked, so an older record carrying a default
    (a shop saved with "1 bedroom") can still have its other details corrected.
    """
    asks = questions_for(space_type)
    if not asks["bedrooms"] and (payload.get("bedrooms") or 0) > 0:
        raise ValidationFailed(f"A {label.lower()} has no bedrooms to count.")
    if asks["bathrooms"] == "none" and (payload.get("bathrooms") or 0) > 0:
        raise ValidationFailed(f"A {label.lower()} has no bathroom of its own.")
    if asks["bathrooms"] == "yes_no" and (payload.get("bathrooms") or 0) > 1:
        raise ValidationFailed(f"A {label.lower()} has one bathroom at most.")
    if not asks["floor"] and payload.get("floor_level") not in (None, ""):
        raise ValidationFailed(f"A {label.lower()} has no floor to record.")


def assert_accepts_bed_spaces(*, unit) -> None:
    """Refuse a bed on a space that cannot hold one.

    Checked here rather than left to the caller because a bed attached to a shop
    is not a data-entry slip that can be corrected later — occupancy, leases and
    the exclusion constraints all read the bed, and by the time it is noticed
    somebody may be living under it.
    """
    space_type = getattr(unit, "space_type", "") or ""
    if is_hostel_room(unit):
        return

    labels = dict(RentableSpaceType.choices)
    property_type = getattr(getattr(unit, "property", None), "property_type", "")
    if property_type != PropertyType.HOSTEL:
        raise ValidationFailed("Beds can only be added to rooms in a hostel property.")
    raise ValidationFailed(
        f"{labels.get(space_type, space_type)} cannot be divided into bed spaces. "
        "Only a hostel room can."
    )


def is_hostel_room(unit) -> bool:
    """A room in a hostel, which may be let whole or by the bed.

    The distinction the hostel structure turns on: the same `room` space type
    means a single room let to one household in a residential property, and a
    shared room let by the bed in a hostel. What separates them is the category
    of the property above.
    """
    space_type = getattr(unit, "space_type", "") or ""
    property_type = getattr(getattr(unit, "property", None), "property_type", "")
    return space_type == RentableSpaceType.ROOM and property_type == PropertyType.HOSTEL
