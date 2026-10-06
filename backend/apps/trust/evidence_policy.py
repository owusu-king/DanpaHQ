"""What evidence a verification asks for, and why.

Requirements used to be a literal dict in `property/services.py` mapping a
relationship type to exactly one document. That could not vary by what the
property *is*: a two-bedroom flat, a shop and a hostel room all asked for the
same single file, and changing that meant editing code and shipping a release.

This resolves requirements at runtime from what the records already say —
relationship, property type, space type, bedroom and bathroom counts, declared
features — and returns a list of **slots**. A slot is a thing to be provided,
with a stable key, a label a person can act on, and the reason it is asked for.

Two rules shape the design:

**Property-level and space-level stay separate.** Proving you may let a
building is not the same question as showing what one flat inside it looks
like, they are reviewed at different times, and merging them would mean asking
for a title deed once per bedroom.

**Policy is data, not control flow.** The tables below are declarative and
carry a version. Moving them into database rows later changes where they are
read from and nothing else — no caller, no serializer, no migration of the
evidence already collected. That is the point of `POLICY_VERSION`: a submission
records which policy applied, so a later change does not retroactively make
someone's completed verification look deficient.

Nothing here decides whether evidence is *good*. It decides what to ask for. A
reviewer still judges what arrives, and no rule in this file asserts anything
about Ghanaian law.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import EvidenceType

#: Bumped whenever the requirements below change in a way that would alter what
#: a provider is asked for. Recorded against a submission so history stays
#: readable after a policy change.
#: `2026.08.2` named the three property views and the three space views
#: individually, and moved declared-feature evidence into `FEATURE_EVIDENCE`.
#: `2026.08.3` reduced the space review to one required photograph and two
#: invited ones, on the reasoning that the property above it has already been
#: reviewed and the space review only has to add what that could not show.
#: `2026.08.4` makes every selected Unit amenity a photographed claim. The
#: overview still establishes the space; each amenity adds its own named,
#: required slot so a kitchen photograph cannot silently stand in for a private
#: bathroom, or vice versa.
#: A verification submitted under an earlier version recorded that version
#: and is still judged against what it was actually asked for.
#: `2026.09.1` adds properties for sale: the title (and for land the site plan)
#: joins the authority review, and each kind of sale property is photographed
#: for what a buyer is buying — see `sale_title_slots` and
#: `sale_property_requirements`. Letting is unchanged.
POLICY_VERSION = "2026.09.1"


@dataclass(frozen=True)
class EvidenceSlot:
    """One thing to provide.

    ``key`` is stable and unique within a requirement set — `bedroom.2` stays
    `bedroom.2` — so an interface can track which slots are filled across
    several visits without matching on labels that may be reworded.
    """

    key: str
    evidence_type: str
    label: str
    #: Said in the product's voice, because a provider who understands why a
    #: thing is asked for provides a better version of it.
    why: str
    required: bool = True
    #: Which review this belongs to. Keeps the two questions apart.
    group: str = "condition"
    #: Alternatives that satisfy the same slot, e.g. a passport instead of a
    #: Ghana Card. Empty means the declared type is the only one.
    accepts: tuple[str, ...] = ()


# --- authority: may this person let this property? ---------------------------

#: One slot each, with the alternatives that genuinely satisfy it. This
#: replaces the old `{relationship_type: single_evidence_type}` dict, which had
#: no way to express "a lease assignment is also acceptable".
_AUTHORITY: dict[str, EvidenceSlot] = {
    "owner": EvidenceSlot(
        key="authority.ownership",
        evidence_type=EvidenceType.OWNERSHIP_DOCUMENT,
        label="Proof you own this property",
        why="Title, indenture or land document naming you.",
        group="authority",
        accepts=(EvidenceType.OWNERSHIP_DOCUMENT, EvidenceType.UTILITY_BILL),
    ),
    "agent": EvidenceSlot(
        key="authority.authorization",
        evidence_type=EvidenceType.AUTHORIZATION_LETTER,
        label="The owner's authorisation",
        why="The owner's letter naming you.",
        group="authority",
        accepts=(EvidenceType.AUTHORIZATION_LETTER, EvidenceType.AGENCY_LICENCE),
    ),
    "manager": EvidenceSlot(
        key="authority.management",
        evidence_type=EvidenceType.MANAGEMENT_AGREEMENT,
        label="Your management agreement",
        why="The agreement appointing you.",
        group="authority",
        accepts=(EvidenceType.MANAGEMENT_AGREEMENT, EvidenceType.AUTHORIZATION_LETTER),
    ),
    "company_representative": EvidenceSlot(
        key="authority.company",
        evidence_type=EvidenceType.BUSINESS_CERTIFICATE,
        label="Your company's registration",
        why="Your company's registration certificate.",
        group="authority",
        accepts=(EvidenceType.BUSINESS_CERTIFICATE, EvidenceType.AUTHORIZATION_LETTER),
    ),
}

_AUTHORITY["listing_manager"] = _AUTHORITY["agent"]


def authority_requirements(relationship_type: str, prop=None) -> list[EvidenceSlot]:
    """What proves this person may let — or sell — this property.

    An unknown relationship falls back to the owner's document rather than
    returning nothing: asking for something reviewable is safer than letting a
    claim through unevidenced because a new relationship type was added and
    this table was not updated.

    The relationship's own document always comes first, so a caller reading the
    first slot still gets the one that proves the relationship. A property for
    sale then adds its title, and land its site plan — see `sale_title_slots`.
    """
    slot = _AUTHORITY.get(relationship_type) or _AUTHORITY["owner"]
    return [slot, *sale_title_slots(prop)]


def _is_sale(prop) -> bool:
    return getattr(prop, "purpose", "") == "sale"


def sale_title_slots(prop) -> list[EvidenceSlot]:
    """The title to a property for sale. Stricter than letting, on purpose.

    Letting asks whether this person may let the place. Selling transfers the
    place itself, so the reviewer reads the title as well as the relationship:
    a Land Title Certificate or, where the land is not yet registered, the
    indenture. Land adds its surveyed site plan, because where a plot starts and
    stops is what land disputes here turn on (owner, 2026-09-28).
    """
    if not _is_sale(prop):
        return []
    slots = [
        EvidenceSlot(
            key="title.document",
            evidence_type=EvidenceType.LAND_TITLE_CERTIFICATE,
            label="The property's title",
            why="Land Title Certificate or indenture.",
            group="authority",
            accepts=(EvidenceType.LAND_TITLE_CERTIFICATE, EvidenceType.INDENTURE),
        )
    ]
    if getattr(prop, "property_type", "") == "land":
        slots.append(
            EvidenceSlot(
                key="title.site_plan",
                evidence_type=EvidenceType.SITE_PLAN,
                label="The site plan",
                why="Surveyed plan, signed by a surveyor.",
                group="authority",
            )
        )
    return slots


#: Every document type the authority review of a sale may carry, for checking an
#: upload's declared type before it is filed.
def authority_evidence_types(relationship_type: str, prop=None) -> set[str]:
    types: set[str] = set()
    for slot in authority_requirements(relationship_type, prop):
        types.update(slot.accepts or (slot.evidence_type,))
    return types


# --- the property itself ------------------------------------------------------


def property_requirements(prop) -> list[EvidenceSlot]:
    """What shows the building and where it sits.

    Asked once for the property, not once per space inside it.

    Three views, each named. Asking for "photos of the outside" is how a
    property gets verified from one flattering angle: a reviewer cannot tell
    whether the three files are three sides or the same wall three times, and
    the provider cannot tell what is still outstanding. Named slots make both
    answerable.

    A property for sale is shown for what a buyer is buying — see
    `sale_property_requirements`.
    """
    if _is_sale(prop):
        return sale_property_requirements(prop)
    slots = [
        EvidenceSlot(
            key="property.front",
            evidence_type=EvidenceType.PROPERTY_FRONT,
            label="The front of the property",
            why="How it looks from the street.",
            # Evidence gathered before these slots were named is still good
            # evidence. Accepted in place of the front view, never asked for.
            accepts=(EvidenceType.PROPERTY_FRONT, EvidenceType.EXTERIOR),
        ),
        EvidenceSlot(
            key="property.side",
            evidence_type=EvidenceType.PROPERTY_SIDE,
            label="The property from the side",
            why="A second angle of the building.",
        ),
        EvidenceSlot(
            key="property.surroundings",
            evidence_type=EvidenceType.PROPERTY_SURROUNDINGS,
            label="The wider area around it",
            why="The street and what is next door.",
            accepts=(
                EvidenceType.PROPERTY_SURROUNDINGS,
                EvidenceType.LOCATION_CONTEXT,
            ),
        ),
    ]

    if getattr(prop, "compound_type", "") in {"family_compound", "estate", "mixed_use"}:
        slots.append(
            EvidenceSlot(
                key="property.compound",
                evidence_type=EvidenceType.COMPOUND,
                label="The compound",
                why="The shared grounds.",
            )
        )

    # Utilities are the commonest source of a later argument, so they are shown
    # rather than described where the arrangement is shared or metered.
    if getattr(prop, "water_source", "") in {"borehole", "sachet", "none"}:
        slots.append(
            EvidenceSlot(
                key="property.water",
                evidence_type=EvidenceType.WATER_SOURCE_VIEW,
                label="The water source",
                why="Where the water comes from.",
                # Required, not optional. These three values are the arrangements
                # where water is a real question — a borehole, sachet delivery, or
                # none at all — and a tenant who discovers which one it is after
                # moving in has discovered it too late. A property on estate mains
                # is never asked.
                required=True,
            )
        )

    if getattr(prop, "power_meter_type", "") in {"prepaid", "shared", "generator"}:
        slots.append(
            EvidenceSlot(
                key="property.power",
                evidence_type=EvidenceType.POWER_METER_VIEW,
                label="The electricity meter",
                why="Shows who pays for power.",
                required=False,
            )
        )

    return slots


def sale_property_requirements(prop) -> list[EvidenceSlot]:
    """What shows a property for sale: the thing being bought, from each side.

    Asked once, and more than letting asks, because nothing below it is reviewed
    again — a property for sale has no Units whose own review adds what the
    building's could not show. So the interior is here, where letting leaves it
    to the space.
    """
    if getattr(prop, "property_type", "") == "land":
        return [
            EvidenceSlot(
                key="sale.plot",
                evidence_type=EvidenceType.PROPERTY_SURROUNDINGS,
                label="The plot itself",
                why="The plot as it stands.",
                accepts=(EvidenceType.PROPERTY_SURROUNDINGS, EvidenceType.LOCATION_CONTEXT),
            ),
            EvidenceSlot(
                key="sale.boundary",
                evidence_type=EvidenceType.PLOT_BOUNDARY,
                label="The boundary or corner pillars",
                why="Where the plot starts and stops.",
            ),
            EvidenceSlot(
                key="sale.access",
                evidence_type=EvidenceType.SPACE_ENTRANCE,
                label="The access road",
                why="How you reach the plot.",
            ),
        ]

    commercial = getattr(prop, "property_type", "") == "commercial"
    slots = [
        EvidenceSlot(
            key="sale.front",
            evidence_type=EvidenceType.PROPERTY_FRONT,
            label="The front of the property",
            why="How it looks from the street.",
            accepts=(EvidenceType.PROPERTY_FRONT, EvidenceType.EXTERIOR),
        ),
        EvidenceSlot(
            key="sale.side",
            evidence_type=EvidenceType.PROPERTY_SIDE,
            label="The property from the side",
            why="A second angle of the building.",
        ),
        EvidenceSlot(
            key="sale.surroundings",
            evidence_type=EvidenceType.PROPERTY_SURROUNDINGS,
            label="The wider area around it",
            why="The street and what is next door.",
            accepts=(EvidenceType.PROPERTY_SURROUNDINGS, EvidenceType.LOCATION_CONTEXT),
        ),
        EvidenceSlot(
            key="sale.interior",
            evidence_type=EvidenceType.INTERIOR_OVERVIEW,
            label="Inside the building" if commercial else "Inside the house",
            why="The usable space inside." if commercial else "The main living space.",
        ),
    ]
    if commercial:
        slots.append(
            EvidenceSlot(
                key="sale.storefront",
                evidence_type=EvidenceType.STOREFRONT,
                label="The frontage",
                why="The frontage, from the street.",
                required=False,
            )
        )
    else:
        slots.extend(
            [
                EvidenceSlot(
                    key="sale.kitchen",
                    evidence_type=EvidenceType.KITCHEN,
                    label="The kitchen",
                    why="Where cooking happens.",
                    required=False,
                ),
                EvidenceSlot(
                    key="sale.bathroom",
                    evidence_type=EvidenceType.BATHROOM,
                    label="A bathroom",
                    why="The fittings, as they are.",
                    required=False,
                ),
            ]
        )
    return slots


# --- the rentable space -------------------------------------------------------
#
# Deliberately much lighter than the property above, and this is the reason:
# the building has already been through a review. Its front, its side and its
# surroundings have been seen, and its authority document has been read. Asking
# for all of that again per room proved the same facts a second time, and cost a
# provider with eight rooms forty photographs to get a hostel onto the platform.
#
# What a *space* review adds is what the property review cannot show: this
# particular Unit's main view and the physical amenities claimed for it. The
# overview and each selected amenity are required; up to two context views are
# invited.
#
# What was given up, said plainly: a per-bedroom and per-bathroom photograph,
# which existed so that nobody arrives to fewer rooms than they agreed. That
# protection now rests on the declared counts, the provider's own photographs
# and the viewing rather than on the review. It is a real reduction, recorded
# here and in `docs/known-limitations.md` rather than left in a diff.

#: How many context views a space may offer beyond its required views. The media
#: endpoint reads the same number, so the slots offered and the uploads accepted
#: cannot drift.
ADDITIONAL_SPACE_PHOTOS = 2


def _residential_primary() -> EvidenceSlot:
    return EvidenceSlot(
        key="space.overview",
        evidence_type=EvidenceType.INTERIOR_OVERVIEW,
        label="The main room, inside",
        why="The first photo tenants see.",
    )


def _bed_space_primary() -> EvidenceSlot:
    return EvidenceSlot(
        key="space.bed",
        evidence_type=EvidenceType.BED_SPACE_VIEW,
        label="The bed space itself",
        why="The bed being rented.",
        accepts=(EvidenceType.BED_SPACE_VIEW, EvidenceType.INTERIOR_OVERVIEW),
    )


def _commercial_primary() -> EvidenceSlot:
    return EvidenceSlot(
        key="space.interior",
        evidence_type=EvidenceType.INTERIOR_OVERVIEW,
        label="Inside the space",
        why="The usable space inside.",
        accepts=(EvidenceType.INTERIOR_OVERVIEW, EvidenceType.STOREFRONT),
    )


def _land_primary() -> EvidenceSlot:
    return EvidenceSlot(
        key="space.plot",
        evidence_type=EvidenceType.PROPERTY_SURROUNDINGS,
        label="The plot itself",
        why="The plot being let.",
    )


#: Space type -> the one photograph it must provide.
_PRIMARY_SLOT = {
    "bed_space": _bed_space_primary,
    "shop": _commercial_primary,
    "office": _commercial_primary,
    "warehouse": _commercial_primary,
    "land": _land_primary,
    "_default": _residential_primary,
}

#: The invited views, per kind of space. Named rather than numbered wherever the
#: space suggests an obvious second and third view, because "another photo" is
#: the prompt that produces the same wall twice.
_ADDITIONAL_LABELS: dict[str, tuple[tuple[str, str, str], ...]] = {
    "land": (
        ("space.plot_boundary", "The boundary", EvidenceType.PLOT_BOUNDARY),
        ("space.plot_access", "The access road or entrance", EvidenceType.SPACE_ENTRANCE),
    ),
    "bed_space": (
        (
            "space.sleeping_arrangement",
            "The room's sleeping arrangement",
            EvidenceType.SLEEPING_ARRANGEMENT,
        ),
        ("space.bathroom.shared", "The washroom arrangement", EvidenceType.BATHROOM),
    ),
    "shop": (
        ("space.storefront", "The shopfront", EvidenceType.STOREFRONT),
        ("space.additional", "Another view of the space", EvidenceType.SPACE_ADDITIONAL),
    ),
    "office": (
        ("space.storefront", "The entrance", EvidenceType.STOREFRONT),
        ("space.additional", "Another view of the space", EvidenceType.SPACE_ADDITIONAL),
    ),
    "warehouse": (
        ("space.storefront", "The entrance", EvidenceType.STOREFRONT),
        ("space.additional", "Another view of the space", EvidenceType.SPACE_ADDITIONAL),
    ),
    "_default": (
        ("space.entrance", "The entrance to it", EvidenceType.SPACE_ENTRANCE),
        ("space.additional", "Another view of the space", EvidenceType.SPACE_ADDITIONAL),
    ),
}

_ADDITIONAL_WHY = {
    "space.entrance": "Which door is theirs.",
    "space.additional": "Another angle of the room.",
    "space.plot_boundary": "Where the plot starts and stops.",
    "space.plot_access": "How you reach the plot.",
    "space.sleeping_arrangement": "How the beds are arranged.",
    "space.bathroom.shared": "The shared washroom.",
    "space.storefront": "The shopfront, from the street.",
}


def _additional_slots(space_type: str) -> list[EvidenceSlot]:
    """The further views, never required."""
    rows = _ADDITIONAL_LABELS.get(space_type) or _ADDITIONAL_LABELS["_default"]
    return [
        EvidenceSlot(
            key=key,
            evidence_type=evidence_type,
            label=label,
            why=_ADDITIONAL_WHY.get(key, "Another view of the space."),
            required=False,
        )
        for key, label, evidence_type in rows[:ADDITIONAL_SPACE_PHOTOS]
    ]


def space_requirements(unit) -> list[EvidenceSlot]:
    """What shows this space: its overview, selected amenities, and context.

    The required slot is named for what the space actually is — a plot has no
    interior and a bed space is not a room — so the request means something for
    every kind of space rather than asking a shop for "the main room, inside".

    Amenities are claims about this exact Unit, not the Property around it.
    Each selected amenity therefore contributes one required, stable slot. The
    amenity row is reference data, so adding a new amenity automatically gains
    the same evidence rule without a client release or another boolean flag.
    """
    space_type = getattr(unit, "space_type", "") or ""
    primary = _PRIMARY_SLOT.get(space_type) or _PRIMARY_SLOT["_default"]
    return [primary(), *amenity_slots(unit), *_additional_slots(space_type)]


_AMENITY_EVIDENCE_BY_CATEGORY: dict[str, str] = {
    "bathroom": EvidenceType.BATHROOM,
    "kitchen": EvidenceType.KITCHEN,
    "water": EvidenceType.WATER_SOURCE_VIEW,
    "power": EvidenceType.POWER_METER_VIEW,
    "transport": EvidenceType.SPACE_ENTRANCE,
    "outdoor": EvidenceType.BALCONY,
    "other": EvidenceType.SPACE_ADDITIONAL,
}


def amenity_slots(unit) -> list[EvidenceSlot]:
    """One required photograph for every amenity currently claimed.

    Slot identity follows the reference-data id rather than its display name.
    Wording may improve later without making a saved photo look detached, and
    two amenities in the same category still require two different images.
    """
    prefetched = getattr(unit, "_prefetched_objects_cache", {}).get("unit_amenities")
    if prefetched is None:
        rows = list(
            unit.unit_amenities.filter(removed_at__isnull=True)
            .select_related("amenity")
            .order_by("amenity__category", "amenity__name")
        )
    else:
        rows = sorted(
            (row for row in prefetched if row.removed_at is None),
            key=lambda row: (row.amenity.category, row.amenity.name),
        )
    return [
        EvidenceSlot(
            key=f"amenity.{row.amenity_id}",
            evidence_type=_AMENITY_EVIDENCE_BY_CATEGORY.get(
                row.amenity.category, EvidenceType.SPACE_ADDITIONAL
            ),
            label=f"Photo of {row.amenity.name.lower()}",
            why=f"Show the actual {row.amenity.name.lower()}.",
            required=True,
        )
        for row in rows
    ]


@dataclass(frozen=True)
class FeatureEvidence:
    """A declared feature, and the photograph that would show it.

    The legacy Unit flags are still used by search and older installed clients.
    The canonical creation checklist now derives evidence from selected
    amenities above; this vocabulary remains for non-amenity flag callers.
    """

    field: str
    evidence_type: str
    key: str
    label: str
    why: str
    required: bool = False

    def slot(self) -> EvidenceSlot:
        return EvidenceSlot(
            key=self.key,
            evidence_type=self.evidence_type,
            label=self.label,
            why=self.why,
            required=self.required,
        )


#: Declared feature -> the evidence that would substantiate it.
FEATURE_EVIDENCE: tuple[FeatureEvidence, ...] = (
    FeatureEvidence(
        field="has_private_kitchen",
        evidence_type=EvidenceType.KITCHEN,
        key="space.kitchen",
        label="The kitchen",
        why="Where cooking happens.",
    ),
    FeatureEvidence(
        field="has_private_toilet",
        evidence_type=EvidenceType.BATHROOM,
        key="space.toilet.private",
        label="The private toilet",
        why="The private toilet itself.",
    ),
    FeatureEvidence(
        field="has_air_conditioning",
        evidence_type=EvidenceType.INTERIOR_OVERVIEW,
        key="space.air_conditioning",
        label="The air conditioning unit",
        why="The installed unit.",
    ),
)


def declared_feature_slots(unit) -> list[EvidenceSlot]:
    """Evidence that would substantiate whatever this space says it has.

    Offered, never required. Reads the table rather than a list of conditions,
    so a feature the record does not declare is not asked about.
    """
    return [spec.slot() for spec in FEATURE_EVIDENCE if getattr(unit, spec.field, False)]


# --- what a caller actually asks --------------------------------------------


def requirements(*, relationship_type: str = "", prop=None, unit=None) -> dict:
    """The full set for whatever is being verified, ready to serialize.

    Callers pass what they have: a relationship for an authority review, a
    property, a space, or several. Slots come back grouped, because a screen
    asking for a title deed and a photograph of a bathroom in one list is a
    screen nobody finishes.
    """
    groups: dict[str, list[EvidenceSlot]] = {}

    if relationship_type:
        groups.setdefault("authority", []).extend(authority_requirements(relationship_type, prop))
    if prop is not None:
        groups.setdefault("property", []).extend(property_requirements(prop))
    if unit is not None:
        groups.setdefault("space", []).extend(space_requirements(unit))

    return {
        "policy_version": POLICY_VERSION,
        "groups": [
            {
                "key": key,
                "slots": [as_dict(slot) for slot in slots],
                "required_count": sum(1 for slot in slots if slot.required),
            }
            for key, slots in groups.items()
        ],
    }


def as_dict(slot: EvidenceSlot) -> dict:
    return {
        "key": slot.key,
        "evidence_type": slot.evidence_type,
        "label": slot.label,
        "why": slot.why,
        "required": slot.required,
        "group": slot.group,
        "accepts": list(slot.accepts) or [slot.evidence_type],
    }


def missing_required(collected: list[str], slots: list[EvidenceSlot]) -> list[EvidenceSlot]:
    """Which required slots have nothing against them yet.

    Matching is by evidence type rather than slot key, because the four photos
    of four bedrooms all arrive as `bedroom` — the slot is a request, and what
    comes back is typed, not keyed.
    """
    have = list(collected)
    outstanding = []
    for slot in slots:
        if not slot.required:
            continue
        accepted = slot.accepts or (slot.evidence_type,)
        match = next((value for value in have if value in accepted), None)
        if match is None:
            outstanding.append(slot)
        else:
            have.remove(match)
    return outstanding
