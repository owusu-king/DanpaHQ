from rest_framework import serializers

from apps.core.money import Money
from apps.files.models import FilePurpose
from apps.property.models import Amenity

from .models import Listing, ListingMedia, ListingStatus, RentPeriod, SavedListing


class AmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Amenity
        fields = ["id", "name", "category", "icon"]
        read_only_fields = fields


class ListingMediaSerializer(serializers.ModelSerializer):
    file_id = serializers.UUIDField(source="file.id", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ListingMedia
        fields = ["id", "file_id", "is_cover", "sort_order", "caption", "download_url"]
        read_only_fields = fields

    def get_download_url(self, obj) -> str | None:
        """Marketing photographs render for anyone; the rest stays audited.

        Both branches now produce something an `<img>` can load. The second one
        used to return the files endpoint, which answers JSON — so a listing
        that was not currently advertised showed a broken frame to the very
        provider editing it.
        """
        from apps.files.photos import inline_image_url, viewable_url

        if not obj.file.is_usable:
            return None
        if obj.listing.status == ListingStatus.ACTIVE:
            # The object itself stays private and the URL expires. Evidence
            # never enters this branch — enforced again when media is attached.
            return inline_image_url(obj.file)
        return viewable_url(obj.file, obj.file_id)


class ListingSerializer(serializers.ModelSerializer):
    rent_formatted = serializers.SerializerMethodField()
    total_move_in_minor = serializers.IntegerField(read_only=True)
    media = ListingMediaSerializer(many=True, read_only=True)
    # The model field is highlighted_amenities; the wire name stays "amenities"
    # so the mobile and web clients do not have to change.
    amenities = AmenitySerializer(source="highlighted_amenities", many=True, read_only=True)

    # A search result has to say where the place is and how big it is, or the
    # tenant is choosing between identical grey cards. The search queryset
    # already selects this chain, so it costs nothing.
    locality_name = serializers.CharField(
        source="unit.property.address.locality.name", read_only=True, default=None
    )
    district_name = serializers.CharField(
        source="unit.property.address.locality.district.name", read_only=True, default=None
    )
    landmark = serializers.CharField(
        source="unit.property.address.landmark", read_only=True, default=None
    )
    bedrooms = serializers.IntegerField(source="unit.bedrooms", read_only=True, default=None)
    bathrooms = serializers.IntegerField(source="unit.bathrooms", read_only=True, default=None)
    is_furnished = serializers.BooleanField(
        source="unit.is_furnished", read_only=True, default=None
    )
    property_type = serializers.CharField(
        source="unit.property.property_type", read_only=True, default=None
    )
    space_type = serializers.CharField(source="unit.space_type", read_only=True, default=None)
    map_latitude = serializers.DecimalField(
        source="unit.property.address.locality.latitude",
        max_digits=9,
        decimal_places=6,
        read_only=True,
        default=None,
    )
    map_longitude = serializers.DecimalField(
        source="unit.property.address.locality.longitude",
        max_digits=9,
        decimal_places=6,
        read_only=True,
        default=None,
    )
    advance_label = serializers.SerializerMethodField()
    trust_stamps = serializers.SerializerMethodField()
    provider_label = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            # unit is here so a console can group listings under the unit they
            # advertise without a second call per listing.
            "id",
            "unit",
            "status",
            "headline",
            "description",
            "rent_minor",
            "rent_currency",
            "rent_period",
            "rent_formatted",
            "advance_months",
            "advance_label",
            "caution_months",
            "agency_fee_months",
            "total_move_in_minor",
            "available_from",
            "minimum_lease_months",
            "amenities",
            "media",
            "cover_url",
            "locality_name",
            "district_name",
            "landmark",
            "property_type",
            "space_type",
            "bedrooms",
            "bathrooms",
            "is_furnished",
            "map_latitude",
            "map_longitude",
            "trust_stamps",
            "provider_label",
            "review_note",
            "reviewed_at",
            "locality_id_cache",
            "bedrooms_cache",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "unit",
            "status",
            "rent_formatted",
            "total_move_in_minor",
            "review_note",
            "reviewed_at",
            "locality_id_cache",
            "bedrooms_cache",
            "created_at",
            "updated_at",
        ]

    def get_rent_formatted(self, obj) -> str | None:
        if obj.rent_minor is None:
            return None
        return str(Money(obj.rent_minor, obj.rent_currency or "GHS"))

    def get_cover_url(self, obj) -> str | None:
        """The one photograph a card shows, from where photographs actually are.

        `media` is *campaign* media — a separate, optional set a provider may
        attach to an advertisement. Nothing in the normal flow creates any: the
        photographs are uploaded to the **Unit**, because that is what the
        condition check is decided on and what `SpacePhotos` manages. There are
        currently zero `ListingMedia` rows in the database and twelve
        `UnitMedia`, which is why every card read `media[0]`, found nothing and
        said "Photo pending".

        So the cover follows the same order the detail gallery does: the Unit's
        own primary photograph first, then the rest of the Unit's, then the
        campaign's.

        No trust snapshot per listing. An ACTIVE listing has already passed
        `can_publish`, which asserts `space_condition_ok(unit)`, and if that
        check later lapses `suspend_for_verification` takes the listing out of
        discovery — the same reasoning `application.services.submit_application`
        records. A provider reading their own draft is authorized by the
        endpoint itself.
        """
        ordered = [
            *sorted(
                obj.unit.media.all(),
                key=lambda media: (not media.is_primary, media.sort_order, media.created_at),
            ),
            *sorted(
                obj.media.all(),
                key=lambda media: (not media.is_cover, media.sort_order, media.created_at),
            ),
        ]
        for media in ordered:
            url = _listing_photo_url(media.file, public=obj.is_live)
            if url is not None:
                return url
        return None

    def get_advance_label(self, obj) -> str:
        """ "24 months" is how it is stored; "2 years" is how it is understood.

        Two-year advance is the single biggest obstacle to a tenancy here, so
        the number gets said in the units people actually think in.
        """
        months = obj.advance_months or 0
        if months == 0:
            return "No advance"
        if months < 12:
            return f"{months} month{'s' if months > 1 else ''}"
        years = months / 12
        if months % 12 == 0:
            whole = months // 12
            return f"{whole} year{'s' if whole > 1 else ''}"
        return f"{months} months (about {years:.1f} years)"

    def _public_trust(self, obj) -> dict:
        cache = getattr(self, "_public_trust_cache", None)
        if cache is None:
            cache = self._public_trust_cache = {}
        key = str(obj.id)
        if key in cache:
            return cache[key]

        from apps.property.models import PropertyRelationship
        from apps.trust.models import SubjectType, VerificationKind
        from apps.trust.services import trust_summary

        relationship = (
            PropertyRelationship.objects.filter(
                property=obj.unit.property,
                user=obj.created_by,
                ended_at__isnull=True,
                authority_verified_at__isnull=False,
            )
            .order_by("-authority_verified_at")
            .first()
        )
        person = trust_summary(SubjectType.USER, obj.created_by_id)
        prop = trust_summary(SubjectType.PROPERTY, obj.unit.property_id)
        relationship_type = relationship.relationship_type if relationship else ""
        labels = {
            "owner": "Verified owner",
            "agent": "Authorized agent",
            "manager": "Verified property manager",
            "company_representative": "Verified company representative",
            "listing_manager": "Authorized listing manager",
        }
        cache[key] = {
            "phone": person[VerificationKind.PHONE],
            "identity": person[VerificationKind.IDENTITY],
            "property": prop[VerificationKind.PROPERTY_AUTHORITY],
            "relationship": relationship_type,
            "relationship_label": labels.get(relationship_type, "Property representative"),
        }
        return cache[key]

    def get_trust_stamps(self, obj) -> dict:
        return self._public_trust(obj)

    def get_provider_label(self, obj) -> str:
        return self._public_trust(obj)["relationship_label"]


class ListingDetailSerializer(ListingSerializer):
    """One listing, told in the order a tenant actually asks about it.

    Two questions, and they are different questions:

    * **"What exactly am I renting?"** — the space. Its photographs, what kind of
      space it is, what it has, what it costs, whether it has been checked.
    * **"Where is it?"** — the property. The building, its surroundings, what the
      compound has, who holds it and what has been confirmed about them.

    The public search shape is unchanged and stays on `ListingSerializer`: this
    is the detail only, because the blocks below cost a query each and a page of
    twenty results does not need any of them.

    What is deliberately *not* here: the street, the house number and the
    entrance note. Those are how somebody finds the door, and the product
    releases them when a viewing is confirmed rather than to anyone who opens a
    page. The locality, district and landmark are enough to judge a location,
    which is what this page is for.
    """

    space = serializers.SerializerMethodField()
    property_context = serializers.SerializerMethodField()
    gallery = serializers.SerializerMethodField()

    class Meta(ListingSerializer.Meta):
        fields = [*ListingSerializer.Meta.fields, "gallery", "space", "property_context"]

    def get_gallery(self, obj) -> list[dict]:
        """One ordered public gallery without copying any stored file.

        The Unit is the subject, so its primary photograph is always first.
        Campaign photographs follow, then the approved Property-condition
        evidence that explains the wider building and compound. A file reused
        in more than one role appears once.
        """
        from apps.trust.condition import ConditionState, snapshot

        public = obj.is_live
        seen: set[str] = set()
        gallery: list[dict] = []

        if snapshot(obj.unit)["state"] == ConditionState.VERIFIED:
            unit_photos = obj.unit.media.select_related("file").order_by(
                "-is_primary", "sort_order", "created_at", "id"
            )
            for media in unit_photos:
                file_id = str(media.file_id)
                url = _listing_photo_url(media.file, public=public)
                if file_id in seen or url is None:
                    continue
                seen.add(file_id)
                gallery.append(
                    {
                        "id": str(media.id),
                        "file_id": file_id,
                        "source": "unit",
                        "source_label": "This unit",
                        "kind": "unit",
                        "caption": media.caption,
                        "is_primary": media.is_primary,
                        "download_url": url,
                    }
                )

        for media in obj.media.select_related("file").order_by(
            "-is_cover", "sort_order", "created_at", "id"
        ):
            file_id = str(media.file_id)
            url = _listing_photo_url(media.file, public=public)
            if file_id in seen or url is None:
                continue
            seen.add(file_id)
            gallery.append(
                {
                    "id": str(media.id),
                    "file_id": file_id,
                    "source": "listing",
                    "source_label": "This unit",
                    "kind": "listing",
                    "caption": media.caption,
                    "is_primary": not gallery and media.is_cover,
                    "download_url": url,
                }
            )

        for photo in self._verified_property_photos(obj):
            if photo["file_id"] in seen:
                continue
            seen.add(photo["file_id"])
            gallery.append(photo)

        return gallery

    def _verified_property_photos(self, obj) -> list[dict]:
        cache = getattr(self, "_verified_property_photo_cache", None)
        if cache is None:
            cache = self._verified_property_photo_cache = {}
        key = str(obj.id)
        if key not in cache:
            cache[key] = _verified_property_photo_items(obj)
        return cache[key]

    def get_space(self, obj) -> dict:
        from apps.property.serializers import UnitAmenitySerializer, UnitMediaSerializer
        from apps.trust.condition import snapshot

        unit = obj.unit
        check = snapshot(unit)
        return {
            "id": str(unit.id),
            "label": unit.label,
            "space_type": unit.space_type,
            "space_type_label": unit.get_space_type_display(),
            "description": unit.description,
            "bedrooms": unit.bedrooms,
            "bathrooms": unit.bathrooms,
            "floor_level": unit.floor_level,
            "floor_area_sqm": str(unit.floor_area_sqm) if unit.floor_area_sqm else None,
            "wing": unit.wing,
            "building": unit.building.name if unit.building_id else "",
            "is_furnished": unit.is_furnished,
            "has_private_bathroom": unit.has_private_bathroom,
            "has_private_toilet": unit.has_private_toilet,
            "has_private_kitchen": unit.has_private_kitchen,
            "has_air_conditioning": unit.has_air_conditioning,
            "amenities": UnitAmenitySerializer(
                unit.unit_amenities.filter(removed_at__isnull=True).select_related("amenity"),
                many=True,
            ).data,
            "photos": UnitMediaSerializer(
                unit.media.select_related("file"),
                many=True,
                # Presigned and short-lived. The listing is public, so its
                # space's photographs are readable without an account — the same
                # rule listing media already applies, and nothing else about the
                # file becomes readable with it.
                context={"public": obj.is_live},
            ).data,
            "verification": {
                "state": check["state"],
                "state_label": check["state_label"],
                "checked": check["state"] == "verified",
            },
        }

    def get_property_context(self, obj) -> dict:
        """Where the space sits, and what is known about the place around it."""
        from apps.property.serializers import PropertyAmenitySerializer
        from apps.trust.condition import state_of
        from apps.trust.models import SubjectType, VerificationKind
        from apps.trust.services import trust_summary

        prop = obj.unit.property
        address = prop.address
        locality = address.locality

        return {
            "id": str(prop.id),
            "title": prop.title,
            "property_type": prop.property_type,
            "property_type_label": prop.get_property_type_display(),
            "locality_name": locality.name if locality else None,
            "district_name": locality.district.name if locality else None,
            "region_name": locality.district.region.name if locality else None,
            "landmark": address.landmark,
            # Kept for installed-client compatibility. New clients render the
            # combined top-level gallery, but this array now draws from the
            # approved Property-condition evidence rather than arbitrary media.
            "photos": [
                {
                    "id": photo["id"],
                    "file_id": photo["file_id"],
                    "kind": photo["kind"],
                    "caption": photo["caption"],
                    "download_url": photo["download_url"],
                }
                for photo in self._verified_property_photos(obj)
            ],
            "amenities": PropertyAmenitySerializer(
                prop.property_amenities.filter(removed_at__isnull=True).select_related("amenity"),
                many=True,
            ).data,
            # The Ghana-specific facts that decide what living here costs and
            # feels like. They are columns on the property rather than amenity
            # rows because each is a single choice from a fixed set, not a
            # presence or absence — see `apps.property.models`.
            "features": {
                "water_source": prop.water_source,
                "water_source_label": prop.get_water_source_display(),
                "power_meter_type": prop.power_meter_type,
                "power_meter_label": prop.get_power_meter_type_display(),
                "compound_type": prop.compound_type,
                "compound_label": prop.get_compound_type_display(),
                "has_security": prop.has_security,
                "is_gated": prop.is_gated,
            },
            "condition_state": state_of(prop),
            "authority": trust_summary(SubjectType.PROPERTY, prop.id)[
                VerificationKind.PROPERTY_AUTHORITY
            ],
            "provider_label": self.get_provider_label(obj),
        }


def _is_public_photo(file) -> bool:
    return bool(
        file.is_usable and not file.is_sensitive and file.purpose == FilePurpose.PROPERTY_PHOTO
    )


def participant_cover_url(*, unit, listing=None) -> str | None:
    """The photograph of this place, for someone already party to it.

    The listing cover comes first where there is a listing, because it is the
    image the tenant clicked in Explore and so the one they will recognize; the
    Unit's own primary photograph stands in when a campaign carried none, and
    is the whole answer for a tenancy, which may never have been advertised at
    all.

    Presigned regardless of whether any listing is still being advertised. Every
    caller is a participant-scoped read — an application, a viewing or a tenancy
    belonging to the reader — and taking a listing out of discovery does not
    unshow somebody a photograph they were shown while deciding. The file gate
    is unchanged: evidence and anything sensitive never reach here.

    Shared by the application, viewing and tenancy read models so "which
    photograph" is answered in one place rather than copied per domain.
    """
    candidates = [
        *(
            sorted(
                listing.media.all(),
                key=lambda media: (not media.is_cover, media.sort_order, media.created_at),
            )
            if listing is not None
            else []
        ),
        *sorted(
            unit.media.all(),
            key=lambda media: (not media.is_primary, media.sort_order, media.created_at),
        ),
    ]
    for media in candidates:
        if _is_public_photo(media.file):
            return _public_photo_url(media.file)
    return None


def _listing_photo_url(file, *, public: bool) -> str | None:
    """Public or not, this has to be something a browser can paint.

    The `not public` branch returned the files endpoint, which answers JSON, so
    the gallery of a withdrawn or paused listing was a column of broken frames
    for the provider who owned it.
    """
    if not _is_public_photo(file):
        return None
    return _public_photo_url(file)


def _public_photo_url(file) -> str | None:
    """A short-lived read URL for a photograph on a live listing.

    Presigned rather than public: the object stays private, and the link stops
    working. Evidence never reaches here — property media of kind `document` is
    excluded above, and every photograph attached to a space is checked for
    purpose and sensitivity when it is attached.
    """
    from apps.files.photos import inline_image_url

    return inline_image_url(file)


def _verified_property_photo_items(listing) -> list[dict]:
    """Photographs that support the Property's current successful review.

    `PropertyMedia` is editable presentation data and is therefore not proof
    that a reviewer saw a file. The immutable evidence rows are the authority
    for that claim. Only visual evidence on the current approved condition
    review can cross this public boundary.
    """
    from apps.property.verification import PropertyReviewState, lifecycle
    from apps.trust.condition import settled_review
    from apps.trust.models import EvidenceType, VerificationKind, VerificationStatus

    prop = listing.unit.property
    if lifecycle(prop)["review_state"] != PropertyReviewState.VERIFIED:
        return []

    review = settled_review(prop)
    if (
        review is None
        or review.kind != VerificationKind.PROPERTY_CONDITION
        or review.status != VerificationStatus.APPROVED
        or not review.is_current
    ):
        return []

    allowed = {
        EvidenceType.PROPERTY_FRONT,
        EvidenceType.PROPERTY_SIDE,
        EvidenceType.PROPERTY_SURROUNDINGS,
        EvidenceType.EXTERIOR,
        EvidenceType.COMPOUND,
        EvidenceType.INTERIOR_OVERVIEW,
        EvidenceType.WATER_SOURCE_VIEW,
    }
    priority = {
        EvidenceType.PROPERTY_FRONT: 0,
        EvidenceType.EXTERIOR: 0,
        EvidenceType.PROPERTY_SIDE: 1,
        EvidenceType.COMPOUND: 2,
        EvidenceType.PROPERTY_SURROUNDINGS: 3,
        EvidenceType.INTERIOR_OVERVIEW: 4,
        EvidenceType.WATER_SOURCE_VIEW: 5,
    }
    evidence = list(
        review.evidence.select_related("file")
        .filter(file__isnull=False, evidence_type__in=allowed)
        .order_by("collected_at", "id")
    )
    evidence.sort(
        key=lambda row: (
            priority.get(row.evidence_type, 99),
            row.collected_at,
            str(row.id),
        )
    )

    photos: list[dict] = []
    seen: set[str] = set()
    for row in evidence:
        file_id = str(row.file_id)
        url = _listing_photo_url(row.file, public=listing.is_live)
        if file_id in seen or url is None:
            continue
        seen.add(file_id)
        photos.append(
            {
                "id": str(row.id),
                "file_id": file_id,
                "source": "property",
                "source_label": "The wider property",
                "kind": row.evidence_type,
                "caption": row.get_evidence_type_display(),
                "is_primary": False,
                "download_url": url,
            }
        )
    return photos


class CreateListingSerializer(serializers.Serializer):
    unit_id = serializers.UUIDField()
    rent_minor = serializers.IntegerField(min_value=1)
    rent_currency = serializers.CharField(max_length=3, default="GHS")
    rent_period = serializers.ChoiceField(choices=RentPeriod.choices, default=RentPeriod.MONTHLY)
    advance_months = serializers.IntegerField(min_value=0, max_value=24, default=1)
    caution_months = serializers.IntegerField(min_value=0, max_value=12, default=0)
    agency_fee_months = serializers.IntegerField(min_value=0, max_value=6, default=0)
    headline = serializers.CharField(max_length=160, required=False, allow_blank=True)
    description = serializers.CharField(max_length=3000, required=False, allow_blank=True)
    available_from = serializers.DateField(required=False, allow_null=True)
    minimum_lease_months = serializers.IntegerField(min_value=1, max_value=60, default=6)


class UpdateListingSerializer(serializers.Serializer):
    rent_minor = serializers.IntegerField(min_value=1, required=False)
    rent_currency = serializers.CharField(max_length=3, required=False)
    rent_period = serializers.ChoiceField(choices=RentPeriod.choices, required=False)
    advance_months = serializers.IntegerField(min_value=0, max_value=24, required=False)
    caution_months = serializers.IntegerField(min_value=0, max_value=12, required=False)
    agency_fee_months = serializers.IntegerField(min_value=0, max_value=6, required=False)
    headline = serializers.CharField(max_length=160, required=False)
    description = serializers.CharField(max_length=3000, required=False)
    available_from = serializers.DateField(required=False, allow_null=True)
    minimum_lease_months = serializers.IntegerField(min_value=1, max_value=60, required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Change at least one listing detail.")
        return attrs


class SavedListingSerializer(serializers.ModelSerializer):
    listing = ListingSerializer(read_only=True)

    class Meta:
        model = SavedListing
        fields = ["id", "listing", "note", "created_at"]
        read_only_fields = ["id", "listing", "created_at"]


class SaveListingSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    note = serializers.CharField(max_length=200, required=False, allow_blank=True)


class ListingSearchSerializer(serializers.Serializer):
    """Public search parameters."""

    q = serializers.CharField(required=False, allow_blank=True, max_length=120)
    locality_id = serializers.UUIDField(required=False)
    property_type = serializers.CharField(required=False, max_length=20)
    #: What is being let, which is not what the building is. P1 made this
    #: expressible — a room, a bed space, a whole property — and without it
    #: here a student cannot search for the thing they actually want.
    space_type = serializers.CharField(required=False, max_length=20)
    amenity_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, max_length=20
    )
    bedrooms_min = serializers.IntegerField(required=False, min_value=0)
    bedrooms_max = serializers.IntegerField(required=False, min_value=0)
    rent_min = serializers.IntegerField(required=False, min_value=0)
    rent_max = serializers.IntegerField(required=False, min_value=0)
    advance_max = serializers.IntegerField(required=False, min_value=0)
    furnished = serializers.BooleanField(required=False, allow_null=True)
    #: Newest first is a reasonable default and a poor only option: the question
    #: after "where" is usually "what does it cost".
    sort = serializers.ChoiceField(
        choices=["newest", "rent_asc", "rent_desc"], required=False, default="newest"
    )
