"""Property domain — the physical things, separate from how they are advertised.

Two separate domains:

* **Property / Unit** — the physical reality: the building, its address, the
  rooms in it, the utilities, the owner. These facts do not change when a
  listing is published or withdrawn. A three-bedroom house is still a
  three-bedroom house when it is between tenants.
* **Listing** (apps.listing) — the advertisement: the rent, the conditions,
  the availability window, the photos chosen for that campaign. A property can
  have multiple listings over its lifetime. A listing is ephemeral; a property
  is not.

Keeping them separate means a landlord's history of what they own is not
entangled with what they are currently renting out, and a tenant who found a
property through one listing can find its record even after the listing closes.

Ghana-specific fields that earn their place here (not on a global template):
* ``water_source`` — a borehole with a pump to a polytank, GWL mains straight to
  the tap, a hand-dug well, or none. Matters to a tenant's monthly cost and
  planning.
* ``power_meter_type`` — prepaid vs postpaid changes the household economics
  materially.
* ``compound_type`` — walled and gated, fenced without a gate, or open. Says
  how the grounds are closed off, which is the security question a tenant asks.

A property is the address and the Units inside it; there is no level between
the two. Blocks were tried as a `Building` row and removed (owner,
2026-10-20): a Unit's `wing` already names the block where one is named.
* ``advance_months`` — up to two-year advance is common and is the most
  consequential constraint on whether a tenant can actually rent at all.
"""

from __future__ import annotations

import secrets

from django.contrib.postgres.fields import ArrayField
from django.core.validators import MaxValueValidator
from django.db import models

from apps.core.models import BaseModel, SoftDeleteModel


def generate_join_code() -> str:
    """Legacy migration callable; new credentials come from ``access_codes.rotate``."""
    return secrets.token_hex(5).upper()


class PropertyType(models.TextChoices):
    """What kind of property this is, as a category.

    Deliberately three broad categories rather than a list of building kinds.
    This field's job is to decide what may be *let* inside the property — see
    `apps.property.space_rules` — and a list mixing `apartment` with `land` could
    not do that job, because it described the building and the rentable space
    with one word and so distinguished neither.

    The granularity did not disappear: `RentableSpaceType` carries it, where an
    apartment, a house and a studio are things that can be let rather than
    labels for the whole address.
    """

    RESIDENTIAL = "residential", "Residential"
    COMMERCIAL = "commercial", "Commercial"
    HOSTEL = "hostel", "Hostel"
    #: Only a property *for sale* may be land. A plot that is let is a Unit of
    #: space type `land` inside a commercial property — see `space_rules` — so
    #: this category never reaches the letting flow; `LETTING_TYPES` and
    #: `SALE_TYPES` below say which categories each purpose may choose.
    LAND = "land", "Land"


class PropertyPurpose(models.TextChoices):
    """Why the property is on the platform: to be let space by space, or sold whole.

    Fixed when the property is created. The two are different products that share
    a building and its verification, not two states of one property: a property
    for sale has no Units, no tenancies and no rent, and is advertised as itself
    the moment its verification passes (owner, 2026-09-28).
    """

    LETTING = "letting", "To let"
    SALE = "sale", "For sale"


#: What each purpose may be. Hostels are a letting business; land is only sold.
LETTING_TYPES = frozenset({PropertyType.RESIDENTIAL, PropertyType.COMMERCIAL, PropertyType.HOSTEL})
SALE_TYPES = frozenset({PropertyType.RESIDENTIAL, PropertyType.COMMERCIAL, PropertyType.LAND})


#: The value every one of the three facts below starts at: not answered yet.
#: Stored, never offered — `UNANSWERED_FACT` is filtered out of the vocabulary,
#: so a provider picks a real answer and setup can tell "not yet" from one.
UNANSWERED_FACT = "unknown"


class WaterSource(models.TextChoices):
    BOREHOLE_PUMP = "borehole_pump", "Borehole with automated pump (Polytank)"
    GWL_MAINS = "gwl_mains", "GWL mains only (direct to tap)"
    WELL = "well", "Hand-dug well / manual well"
    NONE = "none", "No water source"
    UNKNOWN = UNANSWERED_FACT, "Not stated"


class PowerMeterType(models.TextChoices):
    PREPAID = "prepaid", "Prepaid (credit meter)"
    POSTPAID = "postpaid", "Postpaid (ECG bill)"
    NONE = "none", "No electricity"
    UNKNOWN = UNANSWERED_FACT, "Not stated"


class CompoundType(models.TextChoices):
    WALLED_GATED = "walled_gated", "Walled and gated"
    FENCED = "fenced", "Fenced (no gate)"
    OPEN = "open", "Open compound"
    UNKNOWN = UNANSWERED_FACT, "Not stated"


class RentableSpaceType(models.TextChoices):
    """What is actually let. Named for what it is, not for the row it sits on.

    `PropertyType` says what category of property this is. This says what is
    being let inside it, and which values are available depends on that category
    — a hostel offers a room or a bed space, a commercial property offers a shop,
    an office, a warehouse or a plot. The matrix lives in
    `apps.property.space_rules`, because a rule about the relationship between
    two fields cannot be expressed as either field's choices.

    Replaces `Unit.unit_type`, which borrowed the property enum and so could not
    express a room or a bed space at all — the reason hostel inventory could be
    modelled but never classified.
    """

    APARTMENT = "apartment", "Apartment / flat"
    HOUSE = "house", "House"
    STUDIO = "studio", "Studio"
    #: A room let on its own. Two quite different arrangements share this value —
    #: the common Ghanaian single room, and a hostel room — and what separates
    #: them is the category of the property above, not this field.
    ROOM = "room", "Room"
    #: One sleeping place in a shared room. The hostel unit of trade.
    BED_SPACE = "bed_space", "Bed space"
    SHOP = "shop", "Shop"
    OFFICE = "office", "Office"
    WAREHOUSE = "warehouse", "Warehouse"
    #: A plot. Has no interior, no rooms and no beds — see
    #: `space_rules.WITHOUT_INTERIOR`.
    LAND = "land", "Land"


#: The old name, kept as an alias for one release so nothing importing it breaks
#: mid-upgrade. Both point at the same enum; there is no second vocabulary.
SpaceType = RentableSpaceType


class Property(SoftDeleteModel):
    """A piece of real estate. One row per physical address.

    A property is owned by a person (``owner``), who may or may not be the one
    listing it. Agents list on behalf of owners; property managers list on
    behalf of many owners. The distinction matters for trust: a verified owner
    and a verified agent are both trustworthy, but for different reasons, and
    the evidence behind each is different.
    """

    owner = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="owned_properties",
        help_text="Legacy individual owner shortcut; organization authority is canonical.",
    )
    managed_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="managed_properties",
        help_text="Set when a property manager or agent handles this on the owner's behalf.",
    )
    created_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="properties_created",
    )
    title = models.CharField(
        max_length=120,
        help_text="Internal label. Not what tenants see — the listing has its own headline.",
    )
    property_type = models.CharField(max_length=20, choices=PropertyType.choices)
    #: Letting or sale, fixed at creation. See `PropertyPurpose`.
    purpose = models.CharField(
        max_length=10,
        choices=PropertyPurpose.choices,
        default=PropertyPurpose.LETTING,
        db_index=True,
    )

    address = models.ForeignKey("geo.Address", on_delete=models.PROTECT, related_name="properties")

    water_source = models.CharField(
        max_length=16, choices=WaterSource.choices, default=WaterSource.UNKNOWN
    )
    power_meter_type = models.CharField(
        max_length=16, choices=PowerMeterType.choices, default=PowerMeterType.UNKNOWN
    )
    compound_type = models.CharField(
        max_length=20, choices=CompoundType.choices, default=CompoundType.UNKNOWN
    )

    notes = models.TextField(blank=True, max_length=1000)
    amenities_confirmed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text=(
            "When a provider explicitly confirmed the property's shared-amenity checklist, "
            "including the valid answer that the compound shares none."
        ),
    )

    class Meta:
        db_table = "property_property"
        indexes = [
            models.Index(fields=["owner", "-created_at"], name="property_owner_idx"),
        ]

    def __str__(self) -> str:
        return self.title or f"Property {self.id}"

    @property
    def is_for_sale(self) -> bool:
        return self.purpose == PropertyPurpose.SALE

    def is_managed_by(self, user) -> bool:
        legacy_access = (
            str(self.owner_id) == str(user.id)
            or (self.managed_by_id is not None and str(self.managed_by_id) == str(user.id))
            or self.relationships.filter(
                user=user,
                ended_at__isnull=True,
                relationship_type__in=PropertyRelationshipType.management_types(),
            ).exists()
            or user.is_staff
        )
        if legacy_access:
            return True
        from apps.organization.services import can_manage_property

        return can_manage_property(prop=self, user=user)


class PropertyRelationshipType(models.TextChoices):
    OWNER = "owner", "Owner"
    MANAGER = "manager", "Property manager"
    AGENT = "agent", "Agent"
    COMPANY_REPRESENTATIVE = "company_representative", "Company representative"
    LISTING_MANAGER = "listing_manager", "Listing manager"

    @classmethod
    def management_types(cls) -> tuple[str, ...]:
        return (
            cls.OWNER,
            cls.MANAGER,
            cls.AGENT,
            cls.COMPANY_REPRESENTATIVE,
            cls.LISTING_MANAGER,
        )


class PropertyRelationship(BaseModel):
    """A person's authority over a property, separate from global roles."""

    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="relationships")
    user = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="property_relationships"
    )
    relationship_type = models.CharField(max_length=24, choices=PropertyRelationshipType.choices)
    granted_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    granted_by_management_id = models.UUIDField(null=True, blank=True, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True)
    authority_verification_id = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Trust verification that approved this exact relationship.",
    )
    authority_verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "property_relationship"
        constraints = [
            models.UniqueConstraint(
                fields=["property", "user", "relationship_type"],
                condition=models.Q(ended_at__isnull=True),
                name="property_unique_active_relationship",
            )
        ]
        indexes = [
            models.Index(fields=["user", "relationship_type"], name="property_actor_rel_idx"),
            models.Index(
                fields=["property", "relationship_type"], name="property_resource_rel_idx"
            ),
        ]


class ProviderApplicationStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    IDENTITY_REQUIRED = "identity_verification", "Identity verification required"
    PROPERTY_VERIFICATION = "property_verification", "Property verification"
    PENDING_REVIEW = "pending_review", "Pending review"
    NEEDS_MORE = "needs_more_info", "More information required"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    SUSPENDED = "suspended", "Suspended"
    EXPIRED = "expired", "Expired"
    #: Taken back by the provider before anyone decided it.
    #:
    #: Distinct from `REJECTED`, which is a verdict, and from `EXPIRED`, which is
    #: time passing. Without a word for it a withdrawal had to be recorded as one
    #: of those two, and both say something about the claim that is not true.
    #: The row stays either way — a claim somebody made and took back is still
    #: history, and `ADR 0021` says anything a counterparty has seen is kept.
    WITHDRAWN = "withdrawn", "Withdrawn by the provider"


class PropertyProviderApplication(BaseModel):
    """The verification submission for one property.

    The historical class name remains because changing the Python and database
    identity would add migration risk without changing the domain. For a
    property created in the provider workspace this row is the submission
    envelope: authority documents and condition photographs are evidence checks
    inside one property-verification decision. It is intentionally not a
    ``Property`` and a claimant is never made an owner merely for creating it.
    """

    applicant = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="provider_applications"
    )
    organization = models.ForeignKey(
        "organization.Organization",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="provider_applications",
        help_text="Workspace claiming authority over an already-created private property.",
    )
    relationship_type = models.CharField(
        max_length=24,
        choices=[
            (PropertyRelationshipType.OWNER, "Owner"),
            (PropertyRelationshipType.AGENT, "Authorized agent"),
            (PropertyRelationshipType.MANAGER, "Property manager"),
            (PropertyRelationshipType.COMPANY_REPRESENTATIVE, "Company representative"),
        ],
    )
    title = models.CharField(max_length=120)
    property_type = models.CharField(max_length=20, choices=PropertyType.choices)
    address = models.ForeignKey(
        "geo.Address", on_delete=models.PROTECT, related_name="provider_applications"
    )
    owner_name = models.CharField(max_length=160, blank=True)
    owner_phone = models.CharField(max_length=16, blank=True)
    company_name = models.CharField(max_length=180, blank=True)
    status = models.CharField(
        max_length=32,
        choices=ProviderApplicationStatus.choices,
        default=ProviderApplicationStatus.DRAFT,
        db_index=True,
    )
    authority_verification_id = models.UUIDField(null=True, blank=True, unique=True)
    # Kept as UUIDs rather than cross-app foreign keys for the same reason as
    # ``authority_verification_id``: trust owns Verification and property owns
    # the submission aggregate. The explicit pair prevents operations from
    # having to rediscover which two queue entries happen to belong together.
    condition_verification_id = models.UUIDField(null=True, blank=True, unique=True)
    property = models.OneToOneField(
        Property,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="provider_application",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_by_management_id = models.UUIDField(null=True, blank=True, db_index=True)
    decision_note = models.TextField(blank=True, max_length=600)

    class Meta:
        db_table = "property_provider_application"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["applicant", "-created_at"], name="provider_applicant_idx"),
            models.Index(fields=["status", "created_at"], name="provider_review_idx"),
        ]


class Unit(BaseModel):
    """A rentable unit within a property.

    A property with five self-contained flats has five Unit rows, each of which
    can have its own listing. A three-bedroom house rented as a whole is one
    unit. The distinction matters because a landlord may want to rent rooms
    separately while the property address and utilities are shared.
    """

    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="units")

    label = models.CharField(
        max_length=40,
        blank=True,
        help_text="Flat A, Room 3, Ground floor. How the landlord refers to it internally.",
    )
    #: What this space is, in the provider's own words.
    #:
    #: On the unit rather than the listing, because it describes the thing being
    #: let and survives the advertisement being withdrawn. A listing's
    #: `description` is a sales pitch written for one campaign; this is what the
    #: room is, and a tenant invited privately never sees a listing at all.
    description = models.TextField(
        blank=True,
        max_length=1500,
        help_text="What this space is. Shown privately and publicly; outlives any listing.",
    )
    #: The hash of the possession secret a tenant quotes to ask for access to
    #: *this space*. The raw code is returned only when created or rotated.
    #:
    #: On the unit, not the property. Somebody joins a flat, a room or a bed —
    #: never a building — and one code for a whole hostel meant handing every
    #: student the same secret and trusting each to claim only their own room.
    #: Never used for management access, only to ask.
    access_code_hash = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        default=None,
        help_text="Peppered hash of the private share code; never the raw credential.",
    )
    access_code_issued_at = models.DateTimeField(null=True, blank=True)
    access_code_expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    access_code_revoked_at = models.DateTimeField(null=True, blank=True)
    access_code_version = models.PositiveIntegerField(default=0)

    #: What is let here. The only field describing that — `unit_type` used to sit
    #: beside it holding the property enum, which meant two fields answered one
    #: question and nothing decided which was right.
    #:
    #: Which values are valid depends on the property's category; that rule is in
    #: `apps.property.space_rules` and is enforced in `services`, not here, because
    #: a field's `choices` cannot see another table.
    space_type = models.CharField(
        max_length=20,
        choices=RentableSpaceType.choices,
        db_index=True,
    )

    # Bedrooms and bathrooms: the two fields a Ghanaian tenant searches on first.
    bedrooms = models.PositiveSmallIntegerField(
        validators=[MaxValueValidator(20)],
        help_text="0 for a studio / room, 1 for a chamber-and-hall, and so on.",
    )
    bathrooms = models.PositiveSmallIntegerField(validators=[MaxValueValidator(10)])

    floor_area_sqm = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    floor_level = models.SmallIntegerField(
        null=True,
        blank=True,
        help_text="0 = ground. Negative for basement. Null when not applicable.",
    )

    # --- where inside the property -------------------------------------------
    #
    # Only what differs *within* one address. The address itself, its locality,
    # its coordinates and its digital address stay on the property and are read
    # through the relationship: copying them onto every unit would produce a
    # building whose flats disagree about where the building is.
    wing = models.CharField(
        max_length=40,
        blank=True,
        help_text="Wing, block or side of the building, where one is named.",
    )
    entrance_note = models.CharField(
        max_length=200,
        blank=True,
        help_text="How to find this particular door — the commonest thing missing in a compound.",
    )

    # These repeat from the parent property but may differ per unit.
    has_private_bathroom = models.BooleanField(default=True)
    has_private_toilet = models.BooleanField(default=True)
    has_private_kitchen = models.BooleanField(default=True)
    is_furnished = models.BooleanField(default=False)
    has_air_conditioning = models.BooleanField(default=False)

    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "property_unit"
        ordering = ("property", "label")
        indexes = [
            models.Index(fields=["property", "is_active"], name="unit_property_idx"),
        ]

    def __str__(self) -> str:
        label = self.label or f"Unit {self.id}"
        return f"{label} at {self.property}"


class Bed(BaseModel):
    """Optional allocatable place inside a unit/room, primarily for hostels."""

    unit = models.ForeignKey(Unit, on_delete=models.CASCADE, related_name="beds")
    label = models.CharField(max_length=40)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "property_bed"
        ordering = ("unit", "sort_order", "label")
        constraints = [
            models.UniqueConstraint(fields=["unit", "label"], name="property_unique_bed_label")
        ]

    def __str__(self) -> str:
        return f"{self.label} in {self.unit}"


class PropertyMedia(BaseModel):
    """Photos and documents attached to a property (not to a listing).

    Property-level photos survive listing changes: the exterior has not changed
    because the rent did. Listing-level media (the curated photos chosen for a
    specific campaign) lives on the Listing, which is a separate model.
    """

    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="media")
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(
        max_length=20,
        choices=[
            ("exterior", "Exterior"),
            ("interior", "Interior"),
            ("floor_plan", "Floor plan"),
            ("document", "Document"),
            ("other", "Other"),
        ],
    )
    caption = models.CharField(max_length=120, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "property_media"
        ordering = ("property", "kind", "sort_order")


class AmenityScope(models.TextChoices):
    """Which record an amenity is a fact about.

    The property and the space are different questions — a compound has a
    borehole, a room has its own meter — and a single list served to both puts
    the wrong options in front of the provider at both levels.
    """

    PROPERTY = "property", "The property"
    UNIT = "unit", "The rentable space"
    BOTH = "both", "Either"


class AmenityCategory(models.TextChoices):
    WATER = "water", "Water"
    POWER = "power", "Power"
    SECURITY = "security", "Security"
    RECREATION = "recreation", "Recreation"
    TRANSPORT = "transport", "Transport"
    KITCHEN = "kitchen", "Kitchen"
    BATHROOM = "bathroom", "Bathroom"
    LAUNDRY = "laundry", "Laundry"
    CONNECTIVITY = "connectivity", "Connectivity"
    PARKING = "parking", "Parking"
    OUTDOOR = "outdoor", "Outdoor"
    COMFORT = "comfort", "Comfort"
    OTHER = "other", "Other"


class UnitMedia(BaseModel):
    """Photographs of one rentable space.

    Distinct from `PropertyMedia`, which shows the building, and from
    `ListingMedia`, which is a campaign's chosen selection. This is what the
    space *is*: it survives the listing being withdrawn, and a tenant invited
    privately — who never sees a listing — still needs to see the room.

    These are the same photographs the space verification is decided on. One
    upload, two consequences: the provider is not asked to photograph the room
    once for a reviewer and again for a tenant, which is how the two came to
    disagree in every product that asks twice. `services.attach_unit_media`
    files the evidence at the same time it stores the photo.

    Public by consequence, so the file must be a property photo and must not be
    sensitive — enforced at attach time, the same rule listing media applies.
    """

    unit = models.ForeignKey(Unit, on_delete=models.CASCADE, related_name="media")
    file = models.ForeignKey("files.StoredFile", on_delete=models.PROTECT, related_name="+")
    #: The first image. One per space, enforced by the database rather than by
    #: whichever screen happened to write last.
    is_primary = models.BooleanField(default=False)
    caption = models.CharField(max_length=120, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    #: Which evidence slot this photograph answers, when it answers one. Kept so
    #: removing a photo can say what it would leave outstanding.
    slot_key = models.CharField(max_length=60, blank=True)

    class Meta:
        db_table = "property_unit_media"
        ordering = ("unit", "-is_primary", "sort_order", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["unit"],
                condition=models.Q(is_primary=True),
                name="property_one_primary_unit_photo",
            )
        ]
        indexes = [
            models.Index(fields=["unit", "sort_order"], name="unit_media_idx"),
        ]

    def __str__(self) -> str:
        return f"{'Primary' if self.is_primary else 'Photo'} of {self.unit}"


class Amenity(BaseModel):
    """A named physical feature: swimming pool, borehole, backup generator.

    Stored as reference data rather than boolean flags on the unit, so new
    amenities can be added without a schema migration and the list stays
    manageable. Seeded by a management command; never created ad-hoc from
    user input, so the same feature does not appear eleven times with eleven
    different spellings.

    Belongs in the property domain, not the listing domain: a borehole is a
    fact about a unit, not a fact about a rental campaign. A listing may
    *highlight* certain amenities, but it does not define them.
    """

    name = models.CharField(max_length=60, unique=True)
    category = models.CharField(max_length=30, choices=AmenityCategory.choices, blank=True)
    #: Which record this belongs to. A borehole is a fact about the compound; a
    #: self meter is a fact about one flat in it, and offering both lists in both
    #: places is how a provider ends up recording the generator eleven times.
    scope = models.CharField(
        max_length=10, choices=AmenityScope.choices, default=AmenityScope.BOTH, db_index=True
    )
    #: Which rentable-space types this is worth asking about. Empty means all of
    #: them. Data rather than a branch, so offering a new amenity to hostels only
    #: is a row, not a release.
    space_types = ArrayField(
        models.CharField(max_length=20, choices=RentableSpaceType.choices),
        default=list,
        blank=True,
        help_text="Space types this applies to. Empty means every type.",
    )
    #: The `Unit` boolean this amenity mirrors, where one exists.
    #:
    #: `has_private_kitchen` and friends predate this table and are load-bearing:
    #: `trust.evidence_policy.FEATURE_EVIDENCE` reads them to decide what must be
    #: photographed, and public search filters on `is_furnished`. Two independent
    #: ways to say "this room has a kitchen" would disagree the first week, so the
    #: amenity carries the name of the flag and the service writes both.
    unit_flag_field = models.CharField(
        max_length=40,
        blank=True,
        help_text="Unit boolean kept in step with this amenity, e.g. has_private_kitchen.",
    )
    icon = models.CharField(max_length=40, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "property_amenity"
        ordering = ("category", "name")
        indexes = [
            models.Index(fields=["scope", "is_active"], name="amenity_scope_idx"),
        ]

    def __str__(self) -> str:
        return self.name

    def applies_to_space_type(self, space_type: str) -> bool:
        """Whether this is worth asking about for a space of this kind."""
        return not self.space_types or space_type in self.space_types


class UnitAmenity(BaseModel):
    """One amenity that a specific unit has.

    A separate table rather than a ManyToManyField on Unit, because the
    relationship carries data: a unit may have *metered* electricity and
    *unmetered* water, or a generator that runs specific hours only. The
    ``notes`` field carries that without pushing it into flags that would
    need a migration every time a new variation appears.

    Using a through model also makes it possible to record *when* an amenity
    was confirmed or removed, which matters for disputes ("the generator was
    working when I signed" versus the current state).
    """

    unit = models.ForeignKey(Unit, on_delete=models.CASCADE, related_name="unit_amenities")
    amenity = models.ForeignKey(Amenity, on_delete=models.PROTECT, related_name="unit_amenities")
    notes = models.CharField(
        max_length=200,
        blank=True,
        help_text="Optional detail, e.g. 'Borehole water - shared pump, available 6am to 10pm'.",
    )
    confirmed_at = models.DateField(
        null=True,
        blank=True,
        help_text="When this amenity was last verified as present.",
    )
    #: Set instead of deleting the row, so "the generator was working when I
    #: signed" stays answerable after the generator is gone.
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "property_unit_amenity"
        constraints = [
            # Scoped to amenities still present: a removed one must not block
            # the same amenity being recorded again later.
            models.UniqueConstraint(
                fields=["unit", "amenity"],
                condition=models.Q(removed_at__isnull=True),
                name="property_unique_unit_amenity",
            )
        ]

    def __str__(self) -> str:
        return f"{self.amenity.name} at {self.unit}"


class PropertyAmenity(BaseModel):
    """One amenity the property as a whole has.

    The sibling of :class:`UnitAmenity`, and the reason unit amenities can be
    managed separately: a borehole, a wall, a guard and a car park belong to the
    compound, and recording them once against the property is what stops every
    flat inside repeating them — differently, since nothing would keep the copies
    in step.

    Carries the same ``notes`` / ``confirmed_at`` / ``removed_at`` columns as the
    unit table for the same reason: "the generator was working when I signed" has
    to stay answerable after the generator is gone.
    """

    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, related_name="property_amenities"
    )
    amenity = models.ForeignKey(
        Amenity, on_delete=models.PROTECT, related_name="property_amenities"
    )
    notes = models.CharField(
        max_length=200,
        blank=True,
        help_text="Optional detail, e.g. 'Generator runs 6pm to 11pm'.",
    )
    confirmed_at = models.DateField(null=True, blank=True)
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "property_property_amenity"
        constraints = [
            models.UniqueConstraint(
                fields=["property", "amenity"],
                condition=models.Q(removed_at__isnull=True),
                name="property_unique_property_amenity",
            )
        ]

    def __str__(self) -> str:
        return f"{self.amenity.name} at {self.property}"
