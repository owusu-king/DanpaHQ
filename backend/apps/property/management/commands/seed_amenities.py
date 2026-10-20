"""Seed the amenity reference table.

Amenities are reference data, not user input: a provider picks from this list
rather than typing, so the same feature does not arrive as "borehole", "Bore
hole" and "BH" and make filtering useless.

Two things every row now carries beyond a name:

* **scope** — whether it describes the compound or one space inside it. A
  borehole belongs to the property; a self meter belongs to a flat. Serving one
  list to both screens is what put "swimming pool" in front of somebody
  describing a single room.
* **space_types** — which kinds of rentable space it is worth asking about.
  Empty means all of them. A porch is not a question you ask about a bed space.

Idempotent, and it updates the scope and applicability of rows that already
exist, so re-running after a change to this file corrects the table rather than
leaving the first version in place.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.property.models import Amenity, AmenityCategory, AmenityScope, RentableSpaceType

RESIDENTIAL_INTERIORS = [
    RentableSpaceType.APARTMENT,
    RentableSpaceType.HOUSE,
    RentableSpaceType.STUDIO,
    RentableSpaceType.ROOM,
]

#: name, category, scope, space types (empty = all), mirrored Unit flag
AMENITIES: list[tuple[str, str, str, list[str], str]] = [
    # --- the property: facts about the compound ------------------------------
    ("Security guard", AmenityCategory.SECURITY, AmenityScope.PROPERTY, [], ""),
    ("CCTV", AmenityCategory.SECURITY, AmenityScope.PROPERTY, [], ""),
    ("Parking space", AmenityCategory.PARKING, AmenityScope.PROPERTY, [], ""),
    ("Swimming pool", AmenityCategory.RECREATION, AmenityScope.PROPERTY, [], ""),
    ("Gym", AmenityCategory.RECREATION, AmenityScope.PROPERTY, [], ""),
    ("Laundry room", AmenityCategory.LAUNDRY, AmenityScope.PROPERTY, [], ""),
    ("Internet / fibre", AmenityCategory.CONNECTIVITY, AmenityScope.BOTH, [], ""),
    # --- the space: what this unit has, as distinct from the building --------
    #
    # The five the product starts with. Each is something a tenant asks about
    # before agreeing to a room, and each genuinely varies between two rooms at
    # one address — which is the test for belonging here rather than above.
    (
        "Self meter",
        AmenityCategory.POWER,
        AmenityScope.UNIT,
        [],
        "",
    ),
    (
        "Private bathroom",
        AmenityCategory.BATHROOM,
        AmenityScope.UNIT,
        [*RESIDENTIAL_INTERIORS, RentableSpaceType.BED_SPACE],
        "has_private_bathroom",
    ),
    (
        "Water in the unit",
        AmenityCategory.WATER,
        AmenityScope.UNIT,
        [],
        "",
    ),
    (
        "Porch",
        AmenityCategory.OUTDOOR,
        AmenityScope.UNIT,
        RESIDENTIAL_INTERIORS,
        "",
    ),
    (
        "Kitchen",
        AmenityCategory.KITCHEN,
        AmenityScope.UNIT,
        RESIDENTIAL_INTERIORS,
        "has_private_kitchen",
    ),
    # Already expressible as Unit flags, listed so the provider manages one set
    # rather than a checklist here and two switches somewhere else.
    (
        "Private toilet",
        AmenityCategory.BATHROOM,
        AmenityScope.UNIT,
        [*RESIDENTIAL_INTERIORS, RentableSpaceType.BED_SPACE],
        "has_private_toilet",
    ),
    ("Furnished", AmenityCategory.COMFORT, AmenityScope.UNIT, [], "is_furnished"),
    (
        "Air conditioning",
        AmenityCategory.COMFORT,
        AmenityScope.UNIT,
        [],
        "has_air_conditioning",
    ),
    ("Tiled floors", AmenityCategory.COMFORT, AmenityScope.UNIT, RESIDENTIAL_INTERIORS, ""),
    ("Balcony", AmenityCategory.OUTDOOR, AmenityScope.UNIT, RESIDENTIAL_INTERIORS, ""),
    (
        "Wardrobe",
        AmenityCategory.COMFORT,
        AmenityScope.UNIT,
        [*RESIDENTIAL_INTERIORS, RentableSpaceType.BED_SPACE],
        "",
    ),
    (
        "Study desk",
        AmenityCategory.COMFORT,
        AmenityScope.UNIT,
        [RentableSpaceType.ROOM, RentableSpaceType.BED_SPACE],
        "",
    ),
    ("Shop frontage", AmenityCategory.OTHER, AmenityScope.UNIT, [RentableSpaceType.SHOP], ""),
    (
        "Loading access",
        AmenityCategory.TRANSPORT,
        AmenityScope.UNIT,
        [RentableSpaceType.WAREHOUSE, RentableSpaceType.SHOP],
        "",
    ),
]


#: Rows an earlier seed created that now say the same thing as a row above.
#:
#: Deactivated rather than deleted: a unit may already record one, and deleting
#: the reference would take that answer with it. An inactive amenity stops being
#: offered and keeps meaning what it meant.
RETIRED: dict[str, str] = {
    "Modern kitchen": "Kitchen",
    "En-suite bathroom": "Private bathroom",
    # Answered by the property's details now (owner, 2026-10-20): water by the
    # water source, the wall and gate by the compound. Asking twice is how the
    # two answers come to disagree.
    "Generator": "",
    "Water storage tank": "Water source",
    "Borehole water": "Water source",
    "Walled and gated": "Compound",
    "Garden / compound": "Compound",
}


class Command(BaseCommand):
    help = "Seed property and rentable-space amenities."

    @transaction.atomic
    def handle(self, *args, **options):
        created = 0
        updated = 0
        for name, category, scope, space_types, flag in AMENITIES:
            amenity, is_new = Amenity.objects.get_or_create(
                name=name,
                defaults={
                    "category": category,
                    "scope": scope,
                    "space_types": list(space_types),
                    "unit_flag_field": flag,
                },
            )
            if is_new:
                created += 1
                continue
            # Correct a row seeded before this file said where it belongs.
            changes = {}
            if amenity.category != category:
                changes["category"] = category
            if amenity.scope != scope:
                changes["scope"] = scope
            if list(amenity.space_types) != list(space_types):
                changes["space_types"] = list(space_types)
            if amenity.unit_flag_field != flag:
                changes["unit_flag_field"] = flag
            if changes:
                for field, value in changes.items():
                    setattr(amenity, field, value)
                amenity.save(update_fields=[*changes, "updated_at"])
                updated += 1

        retired = Amenity.objects.filter(name__in=RETIRED, is_active=True).update(is_active=False)

        self.stdout.write(
            self.style.SUCCESS(
                f"Amenities: {created} created, {updated} corrected, {retired} retired, "
                f"{Amenity.objects.filter(is_active=True).count()} active."
            )
        )
