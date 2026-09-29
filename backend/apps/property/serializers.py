from rest_framework import serializers

from .models import (
    Amenity,
    Bed,
    Building,
    Property,
    PropertyAmenity,
    PropertyMedia,
    PropertyProviderApplication,
    PropertyType,
    RentableSpaceType,
    Unit,
    UnitAmenity,
    UnitMedia,
)


class AddressShortSerializer(serializers.Serializer):
    """Enough of an address to show where a property is, without a second call."""

    id = serializers.UUIDField(read_only=True)
    locality_name = serializers.CharField(source="locality_label", read_only=True)
    district_name = serializers.CharField(source="district_label", read_only=True)
    region_name = serializers.CharField(source="region_label", read_only=True)
    digital_address = serializers.CharField(read_only=True)
    street = serializers.CharField(read_only=True)
    house_number = serializers.CharField(read_only=True)
    landmark = serializers.CharField(read_only=True)


class AmenityOptionSerializer(serializers.ModelSerializer):
    """One amenity a provider may pick, with what it applies to.

    Deliberately not the `AmenitySerializer` in `apps.listing`: that one is the
    public wire shape for a listing's highlighted amenities and its fields are
    read by installed mobile builds. This one is the picker, and carries the
    scope and applicability those clients have no use for. Two shapes for two
    audiences beats one shape that grows fields half its readers ignore.
    """

    class Meta:
        model = Amenity
        fields = ["id", "name", "category", "icon", "scope", "space_types"]
        read_only_fields = fields


class UnitAmenitySerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="amenity.id", read_only=True)
    name = serializers.CharField(source="amenity.name", read_only=True)
    category = serializers.CharField(source="amenity.category", read_only=True)
    icon = serializers.CharField(source="amenity.icon", read_only=True)

    class Meta:
        model = UnitAmenity
        fields = ["id", "name", "category", "icon", "notes", "confirmed_at"]
        read_only_fields = fields


class PropertyAmenitySerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="amenity.id", read_only=True)
    name = serializers.CharField(source="amenity.name", read_only=True)
    category = serializers.CharField(source="amenity.category", read_only=True)
    icon = serializers.CharField(source="amenity.icon", read_only=True)

    class Meta:
        model = PropertyAmenity
        fields = ["id", "name", "category", "icon", "notes", "confirmed_at"]
        read_only_fields = fields


class UnitMediaSerializer(serializers.ModelSerializer):
    """A photograph of the space.

    `download_url` is a short-lived presigned URL when the space is publicly
    advertised, and the authenticated file endpoint otherwise. The distinction
    matters: these photographs exist before anything is published, and a URL
    anyone could fetch would put an unpublished provider's rooms on the open
    internet.
    """

    file_id = serializers.UUIDField(source="file.id", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = UnitMedia
        fields = [
            "id",
            "file_id",
            "is_primary",
            "caption",
            "sort_order",
            "slot_key",
            "download_url",
            "created_at",
        ]
        read_only_fields = fields

    def get_download_url(self, obj) -> str | None:
        if not obj.file.is_usable:
            return None

        from apps.files.photos import inline_image_url, viewable_url

        # A public read is offered nothing but a photograph.
        if self.context.get("public"):
            return inline_image_url(obj.file)
        # A provider reading their own Unit gets something that renders. This
        # used to hand back the files endpoint, which answers JSON and needs a
        # bearer token, so every provider-side photograph was a broken frame.
        return viewable_url(obj.file, obj.file_id)


def unit_publication(unit) -> dict:
    """Whether this space is currently offered to the public, and as what.

    Read from the listing rather than stored on the unit. The listing already
    carries publication and availability as their own axes (see
    `apps.listing.models`), and a second copy on the space would be a second
    thing to keep in step.
    """
    from apps.listing.models import Listing, PublicationState

    listing = (
        Listing.objects.filter(unit=unit).exclude(status="rejected").order_by("-created_at").first()
    )
    if listing is None:
        return {
            "state": "private",
            "label": "Private",
            "listing_id": None,
            "listing_status": None,
        }
    labels = {
        PublicationState.DRAFT: ("private", "Private"),
        PublicationState.PUBLISHED: ("published", "Published"),
        PublicationState.WITHDRAWN: ("withdrawn", "Withdrawn"),
    }
    state, label = labels.get(listing.publication_state, ("private", "Private"))
    from apps.occupancy.services import unit_is_occupied

    if state == "published" and unit_is_occupied(unit):
        # Defence for legacy/inconsistent rows. Public search applies the same
        # occupancy exclusion and new occupancies reconcile the listing itself.
        state, label = "withdrawn", "Not public while occupied"
    return {
        "state": state,
        "label": label,
        "listing_id": str(listing.id),
        "listing_status": listing.status,
    }


def unit_availability(unit) -> dict:
    """Whether the space can still be taken.

    Occupancy is the truth here, not the listing: a room can be let privately
    with no advertisement at all, and a listing that says "available" while
    somebody lives there is the single most damaging thing this product could
    show a tenant.
    """
    from apps.occupancy.services import unit_is_occupied

    if unit_is_occupied(unit):
        return {"state": "occupied", "label": "Occupied"}

    from apps.listing.models import AvailabilityState, Listing

    listing = (
        Listing.objects.filter(unit=unit, publication_state="published")
        .order_by("-created_at")
        .first()
    )
    if listing is not None and listing.availability_state == AvailabilityState.EXPIRED:
        return {"state": "expired", "label": "Listing expired"}
    return {"state": "available", "label": "Available"}


#: A unit and its property can both be restricted; the stricter state is in force.
_ACCESS_ORDER = {"full": 0, "wind_down": 1, "read_only": 2}


def _billing_states(serializer, *, wanted: set[str], key) -> dict:
    """The plan restrictions the rows being rendered touch, read once per response.

    Asking per row would put a query on every property and unit in a list, so the
    collection's answer is read the first time and held on the list serializer;
    anything it did not cover, such as a nested record, is read when asked for.
    Presentation only — the services refuse restricted actions whatever this says.
    """
    from django.db.models import Model

    from apps.billing import enforcement as billing

    holder = (
        serializer.parent
        if isinstance(serializer.parent, serializers.ListSerializer)
        else serializer
    )
    cache = getattr(holder, "_billing_state_cache", None)
    if cache is None:
        cache = {"checked": set(), "properties": {}, "units": {}}
        holder._billing_state_cache = cache
        instances = holder.instance
        if instances is not None:
            rows = [instances] if isinstance(instances, Model) else list(instances)
            wanted = {*wanted, *(str(key(row)) for row in rows)}
    missing = {identifier for identifier in wanted if identifier not in cache["checked"]}
    if missing:
        states = billing.access_states(property_ids=missing)
        cache["properties"].update(states["properties"])
        cache["units"].update(states["units"])
        cache["checked"].update(missing)
    return cache


class UnitSerializer(serializers.ModelSerializer):
    """A rentable space, as its provider sees it.

    Three lifecycles, deliberately three fields. `verification` says whether the
    space has been checked, `publication` whether it is being offered publicly,
    and `availability` whether it can still be taken. They move independently — a
    verified space can be private and unoccupied at once — and the single status
    field this replaces could not say that without lying about two of the three.
    """

    #: Whether this space has been checked. The older vocabulary, kept because
    #: installed mobile builds read it.
    condition_state = serializers.SerializerMethodField()
    verification = serializers.SerializerMethodField()
    publication = serializers.SerializerMethodField()
    availability = serializers.SerializerMethodField()
    space_type_label = serializers.CharField(source="get_space_type_display", read_only=True)
    #: Needed when a Unit is read outside its Property — the portfolio-wide list
    #: has no other way to say where it is.
    property_title = serializers.CharField(source="property.title", read_only=True)
    amenities = serializers.SerializerMethodField()
    primary_photo = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    permitted_actions = serializers.SerializerMethodField()
    access_code = serializers.SerializerMethodField()
    #: Where this space stands against its Portfolio's plan allowance. Rendered,
    #: never decided on: the services refuse restricted actions regardless.
    billing_access = serializers.SerializerMethodField()
    # Deprecated compatibility field for installed clients. Raw access codes
    # are no longer readable after their one-time creation response.
    join_code = serializers.SerializerMethodField()

    class Meta:
        model = Unit
        fields = [
            "id",
            "property_id",
            "property_title",
            "building_id",
            "label",
            "space_type",
            "space_type_label",
            "description",
            "bedrooms",
            "bathrooms",
            "floor_area_sqm",
            "floor_level",
            "wing",
            "entrance_note",
            "has_private_bathroom",
            "has_private_toilet",
            "has_private_kitchen",
            "is_furnished",
            "has_air_conditioning",
            "is_active",
            "condition_state",
            "verification",
            "publication",
            "availability",
            "amenities",
            "primary_photo",
            "photo_count",
            "permitted_actions",
            "access_code",
            "join_code",
            "billing_access",
            "created_at",
        ]
        read_only_fields = ["id", "property_id", "access_code", "join_code", "created_at"]

    # One read, two vocabularies. Cached per instance because `condition_state`
    # and `verification` are separate serializer fields asking the same question.
    def _snapshot(self, obj) -> dict:
        cache = self.context.setdefault("_condition", {})
        key = str(obj.id)
        if key not in cache:
            from apps.trust.condition import snapshot

            cache[key] = snapshot(obj)
        return cache[key]

    def get_condition_state(self, obj) -> str:
        return self._snapshot(obj)["condition_state"]

    def get_verification(self, obj) -> dict:
        snap = dict(self._snapshot(obj))
        snap.pop("condition_state", None)
        return snap

    def get_join_code(self, obj) -> str | None:
        return None

    def get_access_code(self, obj) -> dict:
        """Where this Unit's private share code stands, for this reader.

        `snapshot` answers from the Unit alone — whether a code exists, and
        whether the space is in a state that could carry one. It does not know
        who is asking, so `can_rotate` and `can_revoke` come back true for
        somebody who may read the Unit but may not share it.

        The Portfolio read model already narrowed them by the `tenant_access`
        capability; this one did not, so the same Unit answered two different
        ways depending on which screen asked. It now answers once: a control the
        service would refuse is not offered here either.
        """
        from .access_codes import snapshot
        from .capabilities import PropertyCapability, property_capabilities

        code = snapshot(obj)
        user = self.context.get("user") or getattr(self.context.get("request"), "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return {**code, "can_rotate": False, "can_revoke": False, "can_manage": False}

        allowed = property_capabilities(prop=obj.property, user=user)[
            PropertyCapability.TENANT_ACCESS.value
        ]["allowed"]
        return {
            **code,
            "can_rotate": bool(code["can_rotate"] and allowed),
            "can_revoke": bool(code["can_revoke"] and allowed),
            "can_manage": bool(allowed),
        }

    def get_publication(self, obj) -> dict:
        return unit_publication(obj)

    def get_availability(self, obj) -> dict:
        return unit_availability(obj)

    def get_amenities(self, obj) -> list:
        rows = obj.unit_amenities.filter(removed_at__isnull=True).select_related("amenity")
        return UnitAmenitySerializer(rows, many=True).data

    def get_primary_photo(self, obj) -> dict | None:
        photo = (
            next(
                (row for row in obj.media.all() if row.is_primary),
                None,
            )
            or obj.media.all().first()
        )
        if photo is None:
            return None
        return UnitMediaSerializer(photo, context=self.context).data

    def get_photo_count(self, obj) -> int:
        return len(obj.media.all())

    def get_permitted_actions(self, obj) -> dict:
        """What this person may do to this space, decided by the backend.

        Clients render this instead of working it out — ADR 0021. A control this
        says no to may be hidden as a courtesy; the service refuses the call
        either way.
        """
        from apps.core.policy import permitted_actions

        user = self.context.get("user")
        if user is None:
            return {}
        return permitted_actions("space", actor=user, target=obj)

    def get_billing_access(self, obj) -> dict:
        """The space's access against its plan: its own, or its property's when stricter."""
        from apps.billing import enforcement as billing

        states = _billing_states(
            self, wanted={str(obj.property_id)}, key=lambda row: row.property_id
        )
        own = states["units"].get(str(obj.id), "full")
        inherited = states["properties"].get(str(obj.property_id), "full")
        return billing.access_payload(
            max(own, inherited, key=_ACCESS_ORDER.__getitem__), noun="unit"
        )


class UnitDetailSerializer(UnitSerializer):
    """One space, with every photograph and the property it sits in.

    The property block is a read of the relationship, not a copy: where a space
    is, and whether its building has been checked, are facts about the property,
    and duplicating them onto the space would let the two disagree.
    """

    media = UnitMediaSerializer(many=True, read_only=True)
    property = serializers.SerializerMethodField()
    beds = serializers.SerializerMethodField()

    class Meta(UnitSerializer.Meta):
        fields = [*UnitSerializer.Meta.fields, "media", "property", "beds"]

    def get_property(self, obj) -> dict:
        prop = obj.property
        serialized = PropertySerializer(prop, context=self.context).data
        return {
            "id": serialized["id"],
            "title": serialized["title"],
            "property_type": serialized["property_type"],
            "address": serialized["address"],
            "authority_state": serialized["authority_state"],
            "condition_state": serialized["condition_state"],
            "capabilities": serialized["capabilities"],
        }

    def get_beds(self, obj) -> list:
        if obj.property.property_type != PropertyType.HOSTEL:
            return []
        return BedSerializer(obj.beds.filter(is_active=True), many=True).data


class UpdateUnitSerializer(serializers.Serializer):
    """What may be corrected about a space, and within what bounds."""

    label = serializers.CharField(max_length=40, required=False, allow_blank=True)
    description = serializers.CharField(max_length=1500, required=False, allow_blank=True)
    building_id = serializers.UUIDField(required=False, allow_null=True)
    bedrooms = serializers.IntegerField(min_value=0, max_value=20, required=False)
    bathrooms = serializers.IntegerField(min_value=0, max_value=10, required=False)
    floor_area_sqm = serializers.DecimalField(
        max_digits=7, decimal_places=2, required=False, allow_null=True
    )
    floor_level = serializers.IntegerField(
        min_value=-5, max_value=200, required=False, allow_null=True
    )
    wing = serializers.CharField(max_length=40, required=False, allow_blank=True)
    entrance_note = serializers.CharField(max_length=200, required=False, allow_blank=True)
    has_private_bathroom = serializers.BooleanField(required=False)
    has_private_toilet = serializers.BooleanField(required=False)
    has_private_kitchen = serializers.BooleanField(required=False)
    is_furnished = serializers.BooleanField(required=False)
    has_air_conditioning = serializers.BooleanField(required=False)
    space_type = serializers.ChoiceField(choices=RentableSpaceType.choices, required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Change at least one detail.")
        return attrs


class SetAmenitiesSerializer(serializers.Serializer):
    """The whole checklist, not a diff.

    A replacement because the screen is a set of tick boxes: sending what is now
    true is one request that either lands or does not, where an add-and-remove
    pair can half-land when a phone drops signal between them.
    """

    amenity_ids = serializers.ListField(
        child=serializers.UUIDField(), max_length=40, allow_empty=True
    )
    notes = serializers.DictField(
        child=serializers.CharField(max_length=200, allow_blank=True), required=False
    )


class AttachUnitPhotoSerializer(serializers.Serializer):
    file_id = serializers.UUIDField()
    #: Which evidence slot this answers. Optional: omitted, the first outstanding
    #: slot is filled, which is what uploading three photos in order should do.
    slot_key = serializers.CharField(max_length=60, required=False, allow_blank=True)
    caption = serializers.CharField(max_length=120, required=False, allow_blank=True)
    is_primary = serializers.BooleanField(required=False, allow_null=True, default=None)


class PropertyMediaSerializer(serializers.ModelSerializer):
    file_id = serializers.UUIDField(source="file.id", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = PropertyMedia
        fields = ["id", "file_id", "kind", "caption", "sort_order", "download_url", "created_at"]
        read_only_fields = fields

    def get_download_url(self, obj) -> str | None:
        """A photograph renders; a document keeps the audited endpoint."""
        from apps.files.photos import viewable_url

        if not obj.file.is_usable:
            return None
        return viewable_url(obj.file, obj.file_id)


class PropertyListSerializer(serializers.ListSerializer):
    """Render a Property collection from batched read models."""

    def to_representation(self, data):
        from django.db.models import QuerySet

        from apps.core.memo import memoized

        from .read_models import prepare_property_list_rows, property_list_queryset

        user = self.child.context.get("user")
        if isinstance(data, QuerySet):
            data = property_list_queryset(data, user=user)
        with memoized():
            rows = prepare_property_list_rows(data)
            # SerializerMethodFields that coordinate across the collection
            # (notably ``cover_url``) must see the evaluated prepared rows, not
            # re-evaluate the original queryset through ``self.instance``.
            self.instance = rows
            return super().to_representation(rows)


class PropertySerializer(serializers.ModelSerializer):
    owner_display = serializers.SerializerMethodField()
    unit_count = serializers.SerializerMethodField()
    building_count = serializers.SerializerMethodField()
    bed_count = serializers.SerializerMethodField()
    occupied_unit_count = serializers.SerializerMethodField()
    vacant_unit_count = serializers.SerializerMethodField()
    # Without this a client knows a property exists but not where it is, which
    # makes the list unusable the moment a landlord owns two of them.
    address = AddressShortSerializer(read_only=True)
    authority_state = serializers.SerializerMethodField()
    #: Whether the building itself has been checked. Distinct from authority,
    #: which asks whether this person may let it at all — the two are decided
    #: separately and a card that showed only one implied the other.
    condition_state = serializers.SerializerMethodField()
    capabilities = serializers.SerializerMethodField()
    permitted_actions = serializers.SerializerMethodField()
    #: Where this property stands against its Portfolio's plan allowance.
    #: Rendered, never decided on: the services refuse restricted actions.
    billing_access = serializers.SerializerMethodField()
    #: Where this property stands, as one state rather than two half-answers.
    #:
    #: `authority_state` stays beside it and is unchanged, because installed
    #: clients read it — but it collapses through `display_state`, which has four
    #: values, so a rejected property and one nobody ever claimed both arrive as
    #: `unverified`. A screen cannot be state-aware on a field that does not
    #: carry the states.
    verification = serializers.SerializerMethodField()
    #: What the compound has, as distinct from what any one space inside it has.
    amenities = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()
    #: For a property for sale, where its sale stands; `None` for letting.
    sale = serializers.SerializerMethodField()

    class Meta:
        model = Property
        list_serializer_class = PropertyListSerializer
        fields = [
            "id",
            "title",
            "property_type",
            "purpose",
            "sale",
            "owner_display",
            "managed_by",
            "created_by",
            "address",
            "water_source",
            "power_meter_type",
            "compound_type",
            "has_security",
            "is_gated",
            "notes",
            "amenities_confirmed_at",
            "amenities",
            "cover_url",
            "unit_count",
            "building_count",
            "bed_count",
            "occupied_unit_count",
            "vacant_unit_count",
            "authority_state",
            "condition_state",
            "verification",
            "capabilities",
            "permitted_actions",
            "billing_access",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "purpose",
            "owner_display",
            "created_by",
            "address",
            "amenities_confirmed_at",
            "unit_count",
            "created_at",
        ]

    def get_sale(self, obj) -> dict | None:
        """A summary a property row can show; the whole record is `/properties/<id>/sale/`."""
        if not obj.is_for_sale:
            return None
        from apps.core.money import Money
        from apps.sale.models import SaleListing
        from apps.sale.read_models import is_public

        sale = SaleListing.objects.filter(property=obj).first()
        if sale is None:
            return None
        return {
            "id": str(sale.id),
            "status": sale.status,
            "status_label": sale.get_status_display(),
            "headline": sale.headline,
            "price_formatted": str(Money(sale.price_minor, sale.currency))
            if sale.price_minor
            else None,
            "is_public": is_public(sale),
        }

    def get_condition_state(self, obj) -> str:
        from apps.trust.condition import state_of

        return state_of(obj)

    def _cover_files(self) -> dict:
        """Every row's cover in one query, resolved once per serialization.

        `get_cover_url` runs per row and the lookup cannot be prefetched, so
        without this the Properties list would carry a query per Property.
        """
        holder = self.parent if isinstance(self.parent, serializers.ListSerializer) else self
        if not hasattr(holder, "_cover_file_cache"):
            from apps.trust.condition import cover_photographs

            instances = holder.instance
            if instances is None:
                ids = []
            elif hasattr(instances, "__iter__"):
                ids = [row.id for row in instances]
            else:
                ids = [instances.id]
            holder._cover_file_cache = cover_photographs(ids)
        return holder._cover_file_cache

    def get_cover_url(self, obj) -> str | None:
        """The one photograph a Property row shows — of the building itself.

        Its own media first. `PropertyMedia` is where a Property's photographs
        belong, and it is the right first answer: the exterior has not changed
        because a Unit was re-let. But nothing creates any — `PropertyMediaView`
        is routed and `attach_media` works, and **neither client calls either**,
        so the table is empty in practice.

        The photographs of the building that *do* exist are its condition
        evidence: every Property is asked to photograph its front, a side and
        its surroundings before it can be verified. Those are pictures of the
        place, taken for that purpose, and they are the honest answer to "show
        me this building". Reading its own media first means the fallback stops
        the day an upload flow exists, with no change here.

        A Unit's photograph is *not* an answer. A room is not the building, and
        showing one as a Property's face makes a block of twelve flats look like
        whichever flat happened to be photographed first.

        Documents are refused twice over: `kind` and `COVER_SLOTS` both exclude
        them, and `inline_image_url` refuses any file whose purpose is not
        `property_photo` regardless.
        """
        from apps.files.photos import inline_image_url

        own = sorted(
            (row for row in obj.media.all() if row.kind in ("exterior", "interior")),
            key=lambda row: (row.kind != "exterior", row.sort_order, row.created_at),
        )
        for row in own:
            url = inline_image_url(row.file)
            if url is not None:
                return url

        return inline_image_url(self._cover_files().get(str(obj.id)))

    def get_amenities(self, obj) -> list:
        rows = getattr(obj, "_property_list_amenities", None)
        if rows is None:
            rows = obj.property_amenities.filter(removed_at__isnull=True).select_related("amenity")
        return PropertyAmenitySerializer(rows, many=True).data

    def get_verification(self, obj) -> dict:
        from .verification import lifecycle

        return lifecycle(obj)

    def get_owner_display(self, obj) -> str:
        if self.get_authority_state(obj) != "verified":
            return "Ownership or management authority not verified"
        if obj.owner_id:
            return obj.owner.display_name
        relationships = getattr(obj, "_property_list_organization_relationships", None)
        if relationships is None:
            relationship = (
                obj.organization_relationships.filter(
                    ended_at__isnull=True,
                    authority_verified_at__isnull=False,
                )
                .select_related("organization")
                .first()
            )
        else:
            relationship = next(
                (row for row in relationships if row.authority_verified_at is not None),
                None,
            )
        return relationship.organization.name if relationship else "Verified property provider"

    def get_unit_count(self, obj) -> int:
        prepared = getattr(obj, "_property_list_unit_count", None)
        if prepared is not None:
            return prepared
        return obj.units.filter(is_active=True).count()

    def get_building_count(self, obj) -> int:
        prepared = getattr(obj, "_property_list_building_count", None)
        if prepared is not None:
            return prepared
        return obj.buildings.filter(is_active=True).count()

    def get_bed_count(self, obj) -> int:
        if obj.property_type != PropertyType.HOSTEL:
            return 0
        prepared = getattr(obj, "_property_list_bed_count", None)
        if prepared is not None:
            return prepared
        return Bed.objects.filter(unit__property=obj, is_active=True).count()

    def get_occupied_unit_count(self, obj) -> int:
        prepared = getattr(obj, "_property_list_occupied_unit_count", None)
        if prepared is not None:
            return prepared
        return (
            obj.units.filter(
                is_active=True,
                occupancies__ended_at__isnull=True,
                occupancies__status__in=["pending_lease", "active"],
            )
            .distinct()
            .count()
        )

    def get_vacant_unit_count(self, obj) -> int:
        return max(self.get_unit_count(obj) - self.get_occupied_unit_count(obj), 0)

    def get_authority_state(self, obj) -> str:
        """Whether this property is confirmed as somebody's to let.

        A pending claim counts as pending here, and that is the fix: the
        verification for an authority application is filed against the
        *application*, not the property, so a property with a claim sitting in
        review had no `PROPERTY_AUTHORITY` verification of its own and read as
        untouched. The screen offered the claim form again, and submitting it a
        second time hit "you already have a property authority review in
        progress" — a dead end reached by following the interface.
        """
        from apps.trust.models import SubjectType, VerificationKind
        from apps.trust.services import trust_summary

        state = trust_summary(SubjectType.PROPERTY, obj.id)[VerificationKind.PROPERTY_AUTHORITY][
            "state"
        ]
        if state != "unverified":
            return state

        from .models import ProviderApplicationStatus
        from .verification import application_for

        application = application_for(obj)
        waiting = application is not None and application.status in [
            ProviderApplicationStatus.PENDING_REVIEW,
            ProviderApplicationStatus.NEEDS_MORE,
        ]
        return "pending" if waiting else state

    def get_capabilities(self, obj) -> dict[str, dict]:
        from .capabilities import property_capabilities

        user = self.context.get("user")
        if user is None:
            return {}
        # The serializer context is the request-shaped place to share the
        # answers that are the same for every property in one response, so a
        # prepared list stays constant-cost as a portfolio grows.
        cache = self.context.setdefault("_capability_cache", {})
        return property_capabilities(prop=obj, user=user, cache=cache)

    def get_permitted_actions(self, obj) -> dict[str, dict]:
        """What this person may do to this property, decided by the backend.

        Clients render this instead of working it out. Hiding a control this
        says no to is a courtesy; the service refuses the call regardless — see
        ADR 0021.
        """
        from apps.core.policy import permitted_actions

        user = self.context.get("user")
        if user is None:
            return {}
        return permitted_actions("property", actor=user, target=obj)

    def get_billing_access(self, obj) -> dict:
        """The property's access against its Portfolio's plan allowance."""
        from apps.billing import enforcement as billing

        states = _billing_states(self, wanted={str(obj.id)}, key=lambda row: row.id)
        return billing.access_payload(
            states["properties"].get(str(obj.id), "full"), noun="property"
        )


class ProviderApplicationSerializer(serializers.ModelSerializer):
    relationship_label = serializers.CharField(
        source="get_relationship_type_display", read_only=True
    )
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    address = AddressShortSerializer(read_only=True)

    class Meta:
        model = PropertyProviderApplication
        fields = [
            "id",
            "organization_id",
            "relationship_type",
            "relationship_label",
            "title",
            "property_type",
            "address",
            "owner_name",
            "owner_phone",
            "company_name",
            "status",
            "status_label",
            "authority_verification_id",
            "property_id",
            "submitted_at",
            "reviewed_at",
            "decision_note",
            "created_at",
        ]
        read_only_fields = fields


class SubmitProviderApplicationSerializer(serializers.Serializer):
    relationship_type = serializers.ChoiceField(
        choices=["owner", "agent", "manager", "company_representative"]
    )
    organization_id = serializers.UUIDField(required=False, allow_null=True)
    property_id = serializers.UUIDField(required=False, allow_null=True)
    title = serializers.CharField(max_length=120, required=False, allow_blank=True)
    property_type = serializers.ChoiceField(
        choices=[
            "apartment",
            "house",
            "villa",
            "studio",
            "office",
            "shop",
            "warehouse",
            "land",
            "other",
        ],
        required=False,
    )
    address_id = serializers.UUIDField(required=False, allow_null=True)
    owner_name = serializers.CharField(max_length=160, required=False, allow_blank=True)
    owner_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    company_name = serializers.CharField(max_length=180, required=False, allow_blank=True)
    file_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=10)
    #: Which document each file is, keyed by file id — a property for sale sends
    #: its title and site plan beside the relationship document. Optional: a
    #: file with no entry is the relationship's document.
    evidence_types = serializers.DictField(
        child=serializers.CharField(max_length=40), required=False, default=dict
    )


class ProviderEvidenceSerializer(serializers.Serializer):
    file_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=10)
    evidence_types = serializers.DictField(
        child=serializers.CharField(max_length=40), required=False, default=dict
    )


class BuildingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Building
        fields = ["id", "property_id", "name", "code", "sort_order", "is_active", "created_at"]
        read_only_fields = ["id", "property_id", "created_at"]


class BedSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bed
        fields = ["id", "unit_id", "label", "sort_order", "is_active", "created_at"]
        read_only_fields = ["id", "unit_id", "created_at"]
