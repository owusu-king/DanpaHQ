"""How a property for sale is read — by the public, by its seller, and in an enquiry.

The public shapes never carry the street, the house number or a coordinate: a
buyer judges a location by its neighbourhood and a coarse map point, the same
rule every rental listing follows (ADR 0022, ADR 0033). The seller's phone number
is not here either; buyers ask through an enquiry (owner, 2026-09-28).
"""

from __future__ import annotations

from rest_framework import serializers

from apps.core.money import Money

from .models import SaleEnquiry, SaleEnquiryMessage, SaleListing


#: What a buyer is shown, in the order they ask about it: the front, the inside,
#: the plot, then where it sits.
def _public_photo_types() -> tuple[set, dict]:
    from apps.trust.models import EvidenceType as E

    order = [
        E.PROPERTY_FRONT,
        E.EXTERIOR,
        E.PROPERTY_SURROUNDINGS,
        E.PLOT_BOUNDARY,
        E.SPACE_ENTRANCE,
        E.PROPERTY_SIDE,
        E.INTERIOR_OVERVIEW,
        E.LIVING_AREA,
        E.KITCHEN,
        E.BATHROOM,
        E.BEDROOM,
        E.STOREFRONT,
        E.COMPOUND,
        E.LOCATION_CONTEXT,
    ]
    return set(order), {kind: index for index, kind in enumerate(order)}


def sale_photos(sale: SaleListing, *, public: bool = True) -> list[dict]:
    from apps.listing.serializers import verified_property_photos

    allowed, priority = _public_photo_types()
    photos = verified_property_photos(
        sale.property,
        public=public,
        allowed=allowed,
        priority=priority,
        source_label="This property",
    )
    if photos:
        photos[0] = {**photos[0], "is_primary": True}
    return photos


def _location(sale: SaleListing) -> dict | None:
    from apps.listing.location import PRECISION_RADIUS_M

    point = sale.public_point
    if point is None:
        return None
    return {
        "latitude": round(point.y, 6),
        "longitude": round(point.x, 6),
        "precision": sale.public_point_precision,
        "radius_m": PRECISION_RADIUS_M.get(sale.public_point_precision, 1500),
    }


def _seller_label(prop) -> str:
    """Who is selling — the Portfolio's name, never a person or their number.

    The Portfolio whose authority a reviewer confirmed, where there is one. The
    clients' claims name the person rather than the Portfolio, so a verified
    property is often held by a Portfolio whose own link was never stamped; its
    name is still the honest answer, because a sale is only public once the
    property itself is verified (`read_models.public_sales`).
    """
    relationships = prop.organization_relationships.filter(ended_at__isnull=True).select_related(
        "organization"
    )
    relationship = (
        relationships.filter(authority_verified_at__isnull=False).first() or relationships.first()
    )
    return relationship.organization.name if relationship else "Verified seller"


class SaleCardSerializer(serializers.ModelSerializer):
    """One property for sale in a search result."""

    kind = serializers.CharField(source="property.property_type", read_only=True)
    kind_label = serializers.SerializerMethodField()
    price_formatted = serializers.SerializerMethodField()
    tenure_label = serializers.CharField(source="get_tenure_display", read_only=True)
    land_size_unit_label = serializers.CharField(
        source="get_land_size_unit_display", read_only=True
    )
    commercial_use_label = serializers.CharField(
        source="get_commercial_use_display", read_only=True
    )
    locality_name = serializers.SerializerMethodField()
    district_name = serializers.SerializerMethodField()
    region_name = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    seller_label = serializers.SerializerMethodField()
    listed_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = SaleListing
        fields = [
            "id",
            "kind",
            "kind_label",
            "status",
            "headline",
            "price_minor",
            "currency",
            "price_formatted",
            "price_negotiable",
            "tenure",
            "tenure_label",
            "bedrooms",
            "bathrooms",
            "floor_area_sqm",
            "commercial_use",
            "commercial_use_label",
            "land_size",
            "land_size_unit",
            "land_size_unit_label",
            "is_serviced",
            "locality_name",
            "district_name",
            "region_name",
            "cover_url",
            "location",
            "seller_label",
            "listed_at",
        ]
        read_only_fields = fields

    def get_kind_label(self, obj) -> str:
        return {"residential": "House", "commercial": "Commercial property", "land": "Land"}.get(
            obj.property.property_type, obj.property.get_property_type_display()
        )

    def get_price_formatted(self, obj) -> str | None:
        if not obj.price_minor:
            return None
        return str(Money(obj.price_minor, obj.currency or "GHS"))

    def _address(self, obj):
        return obj.property.address

    def get_locality_name(self, obj) -> str | None:
        return self._address(obj).locality_label or None

    def get_district_name(self, obj) -> str | None:
        return self._address(obj).district_label or None

    def get_region_name(self, obj) -> str | None:
        return self._address(obj).region_label or None

    def get_cover_url(self, obj) -> str | None:
        photos = sale_photos(obj)
        return photos[0]["download_url"] if photos else None

    def get_location(self, obj) -> dict | None:
        return _location(obj)

    def get_seller_label(self, obj) -> str:
        return _seller_label(obj.property)


class SaleDetailSerializer(SaleCardSerializer):
    """One property for sale, whole."""

    gallery = serializers.SerializerMethodField()
    landmark = serializers.SerializerMethodField()
    features = serializers.SerializerMethodField()
    amenities = serializers.SerializerMethodField()
    my_enquiry_id = serializers.SerializerMethodField()

    class Meta(SaleCardSerializer.Meta):
        fields = [
            *SaleCardSerializer.Meta.fields,
            "description",
            "lease_years_remaining",
            "gallery",
            "landmark",
            "features",
            "amenities",
            "my_enquiry_id",
        ]
        read_only_fields = fields

    def get_gallery(self, obj) -> list[dict]:
        return sale_photos(obj)

    def get_landmark(self, obj) -> str:
        return self._address(obj).landmark

    def get_features(self, obj) -> dict | None:
        """Water, power and the compound — for a building. A plot has none of these."""
        prop = obj.property
        if prop.property_type == "land":
            return None
        return {
            "water_source": prop.water_source,
            "water_source_label": prop.get_water_source_display(),
            "power_meter_type": prop.power_meter_type,
            "power_meter_label": prop.get_power_meter_type_display(),
            "compound_type": prop.compound_type,
            "compound_label": prop.get_compound_type_display(),
            "has_security": prop.has_security,
            "is_gated": prop.is_gated,
        }

    def get_amenities(self, obj) -> list:
        from apps.property.serializers import PropertyAmenitySerializer

        rows = obj.property.property_amenities.filter(removed_at__isnull=True).select_related(
            "amenity"
        )
        return PropertyAmenitySerializer(rows, many=True).data

    def get_my_enquiry_id(self, obj) -> str | None:
        """The reader's own conversation about this property, if they have started one."""
        user = self.context.get("user")
        if user is None or not user.is_authenticated:
            return None
        enquiry = (
            SaleEnquiry.objects.filter(sale=obj, buyer=user).values_list("id", flat=True).first()
        )
        return str(enquiry) if enquiry else None


class SellerSaleSerializer(serializers.ModelSerializer):
    """The seller's view of their sale: everything, plus what setup still needs."""

    kind = serializers.CharField(source="property.property_type", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    price_formatted = serializers.SerializerMethodField()
    is_public = serializers.SerializerMethodField()
    missing = serializers.SerializerMethodField()
    editable_fields = serializers.SerializerMethodField()
    enquiry_count = serializers.SerializerMethodField()

    class Meta:
        model = SaleListing
        fields = [
            "id",
            "kind",
            "status",
            "status_label",
            "status_changed_at",
            "is_public",
            "headline",
            "description",
            "price_minor",
            "currency",
            "price_formatted",
            "price_negotiable",
            "tenure",
            "lease_years_remaining",
            "bedrooms",
            "bathrooms",
            "floor_area_sqm",
            "commercial_use",
            "land_size",
            "land_size_unit",
            "is_serviced",
            "missing",
            "editable_fields",
            "enquiry_count",
            "created_at",
        ]
        read_only_fields = fields

    def get_price_formatted(self, obj) -> str | None:
        if not obj.price_minor:
            return None
        return str(Money(obj.price_minor, obj.currency or "GHS"))

    def get_is_public(self, obj) -> bool:
        from .read_models import is_public

        return is_public(obj)

    def get_missing(self, obj) -> list[dict]:
        from .services import sale_blockers

        return sale_blockers(obj.property)

    def get_editable_fields(self, obj) -> list[str]:
        from .models import SaleStatus
        from .services import _editable_fields

        if obj.status == SaleStatus.SOLD:
            return []
        return sorted(_editable_fields(obj.property))

    def get_enquiry_count(self, obj) -> int:
        return obj.enquiries.count()


class UpdateSaleSerializer(serializers.Serializer):
    """What a seller may send. Which of these are *accepted* is `services.update_sale`'s call."""

    price_minor = serializers.IntegerField(min_value=1, required=False)
    price_negotiable = serializers.BooleanField(required=False)
    headline = serializers.CharField(max_length=160, required=False, allow_blank=True)
    description = serializers.CharField(max_length=3000, required=False, allow_blank=True)
    tenure = serializers.CharField(max_length=12, required=False, allow_blank=True)
    lease_years_remaining = serializers.IntegerField(
        min_value=1, max_value=999, required=False, allow_null=True
    )
    bedrooms = serializers.IntegerField(min_value=0, max_value=50, required=False, allow_null=True)
    bathrooms = serializers.IntegerField(min_value=0, max_value=50, required=False, allow_null=True)
    floor_area_sqm = serializers.DecimalField(
        max_digits=9, decimal_places=2, required=False, allow_null=True
    )
    commercial_use = serializers.CharField(max_length=16, required=False, allow_blank=True)
    land_size = serializers.DecimalField(
        max_digits=10, decimal_places=3, required=False, allow_null=True
    )
    land_size_unit = serializers.CharField(max_length=6, required=False, allow_blank=True)
    is_serviced = serializers.BooleanField(required=False, allow_null=True)


class SaleSearchSerializer(serializers.Serializer):
    q = serializers.CharField(max_length=120, required=False, allow_blank=True)
    kind = serializers.ChoiceField(choices=["residential", "commercial", "land"], required=False)
    locality_id = serializers.UUIDField(required=False)
    price_min = serializers.IntegerField(min_value=0, required=False)
    price_max = serializers.IntegerField(min_value=0, required=False)
    bedrooms_min = serializers.IntegerField(min_value=0, max_value=50, required=False)
    tenure = serializers.ChoiceField(choices=["freehold", "leasehold", "customary"], required=False)
    west = serializers.FloatField(min_value=-180, max_value=180, required=False)
    south = serializers.FloatField(min_value=-90, max_value=90, required=False)
    east = serializers.FloatField(min_value=-180, max_value=180, required=False)
    north = serializers.FloatField(min_value=-90, max_value=90, required=False)
    sort = serializers.ChoiceField(choices=["newest", "price_asc", "price_desc"], required=False)


class EnquiryMessageSerializer(serializers.ModelSerializer):
    mine = serializers.SerializerMethodField()
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = SaleEnquiryMessage
        fields = ["id", "body", "mine", "author_name", "created_at"]
        read_only_fields = fields

    def get_mine(self, obj) -> bool:
        user = self.context.get("user")
        return bool(user and obj.author_id == user.id)

    def get_author_name(self, obj) -> str:
        """The buyer by name; the seller as their verified Portfolio, never a person."""
        enquiry = self.context.get("enquiry")
        if enquiry is not None and obj.author_id != enquiry.buyer_id:
            return _seller_label(enquiry.sale.property)
        return obj.author.display_name


class EnquirySerializer(serializers.ModelSerializer):
    """One conversation, as its buyer or its seller sees it."""

    role = serializers.SerializerMethodField()
    sale = serializers.SerializerMethodField()
    buyer_name = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()

    class Meta:
        model = SaleEnquiry
        fields = [
            "id",
            "role",
            "status",
            "sale",
            "buyer_name",
            "unread",
            "last_message",
            "last_message_at",
            "created_at",
        ]
        read_only_fields = fields

    def _user(self):
        return self.context.get("user")

    def get_role(self, obj) -> str:
        user = self._user()
        return "buyer" if user and obj.buyer_id == user.id else "seller"

    def get_sale(self, obj) -> dict:
        sale = obj.sale
        return {
            "id": str(sale.id),
            "property_id": str(sale.property_id),
            "headline": sale.headline,
            "status": sale.status,
            "price_formatted": str(Money(sale.price_minor, sale.currency))
            if sale.price_minor
            else None,
            "locality_name": sale.property.address.locality_label or None,
        }

    def get_buyer_name(self, obj) -> str:
        return obj.buyer.display_name

    def get_unread(self, obj) -> bool:
        read_at = obj.buyer_read_at if self.get_role(obj) == "buyer" else obj.seller_read_at
        return bool(obj.last_message_at and (read_at is None or read_at < obj.last_message_at))

    def get_last_message(self, obj) -> str:
        message = obj.messages.order_by("-created_at").values_list("body", flat=True).first()
        return (message or "")[:140]


class EnquiryDetailSerializer(EnquirySerializer):
    messages = serializers.SerializerMethodField()

    class Meta(EnquirySerializer.Meta):
        fields = [*EnquirySerializer.Meta.fields, "messages"]
        read_only_fields = fields

    def get_messages(self, obj) -> list[dict]:
        return EnquiryMessageSerializer(
            obj.messages.select_related("author"),
            many=True,
            context={"user": self._user(), "enquiry": obj},
        ).data


class StartEnquirySerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000)


class ReplySerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000)
