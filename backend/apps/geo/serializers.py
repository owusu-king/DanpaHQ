"""Geography over the wire.

Regions, districts and localities are reference data: read-only to every client,
extended by operations. Addresses are the one thing a user creates, and they are
deliberately forgiving - a Ghanaian address is often a landmark and a description
rather than a street number, and refusing that would make the field unusable.
"""

from decimal import Decimal

from rest_framework import serializers

from apps.core.digital_address import DigitalAddressError, normalise_digital_address

from .models import Address, District, Locality, Region
from .providers import PROVIDER_NAMES


class RegionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Region
        fields = ["id", "name", "code", "capital"]
        read_only_fields = fields


class DistrictSerializer(serializers.ModelSerializer):
    region_name = serializers.CharField(source="region.name", read_only=True)

    class Meta:
        model = District
        fields = ["id", "name", "code", "region", "region_name"]
        read_only_fields = fields


class LocalitySerializer(serializers.ModelSerializer):
    district_name = serializers.CharField(source="district.name", read_only=True)
    region_name = serializers.CharField(source="district.region.name", read_only=True)

    class Meta:
        model = Locality
        fields = [
            "id",
            "name",
            "aliases",
            "district",
            "district_name",
            "region_name",
            "latitude",
            "longitude",
        ]
        read_only_fields = fields


class AddressSerializer(serializers.ModelSerializer):
    locality_name = serializers.CharField(source="locality_label", read_only=True)
    district_name = serializers.CharField(source="district_label", read_only=True)
    region_name = serializers.CharField(source="region_label", read_only=True)

    class Meta:
        model = Address
        fields = [
            "id",
            "locality",
            "locality_name",
            "district_name",
            "region_name",
            "digital_address",
            "street",
            "house_number",
            "landmark",
            "latitude",
            "longitude",
            "place_provider",
            "place_reference",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "locality_name",
            "district_name",
            "region_name",
            "place_provider",
            "place_reference",
            "created_at",
        ]


class AddressPlaceSerializer(serializers.Serializer):
    """A town/neighbourhood chosen from Rooomly's provider-backed search."""

    provider = serializers.ChoiceField(choices=list(PROVIDER_NAMES))
    reference = serializers.RegexField(r"^[A-Za-z0-9_-]{1,300}$", max_length=300)
    session = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=160)
    context = serializers.CharField(max_length=160, required=False, allow_blank=True)


class CreateAddressSerializer(serializers.Serializer):
    """What a client sends to record where something is.

    Only the locality is required. Everything else is optional because the
    honest state of a Ghanaian address is often "Osu, near the Total station"
    and nothing more, and a form that refuses that is a form people abandon.
    """

    locality_id = serializers.UUIDField(required=False)
    place = AddressPlaceSerializer(required=False)
    digital_address = serializers.CharField(max_length=12, required=False, allow_blank=True)
    street = serializers.CharField(max_length=160, required=False, allow_blank=True)
    house_number = serializers.CharField(max_length=32, required=False, allow_blank=True)
    landmark = serializers.CharField(max_length=200, required=False, allow_blank=True)
    latitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        required=False,
        allow_null=True,
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
    )
    longitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        required=False,
        allow_null=True,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
    )

    def validate_digital_address(self, value: str) -> str:
        """Normalise here rather than letting the model field raise.

        The field validates on save, but a Django ValidationError escaping a
        view is a 500 - and a mistyped GhanaPost code is a user error that
        deserves the same clear message as any other.
        """
        if not value:
            return value
        try:
            return normalise_digital_address(value).value
        except DigitalAddressError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_locality_id(self, value):
        if not Locality.objects.filter(id=value, is_active=True).exists():
            raise serializers.ValidationError("We do not know that locality.")
        return value

    def validate(self, attrs):
        if bool(attrs.get("locality_id")) == bool(attrs.get("place")):
            raise serializers.ValidationError(
                "Choose one town or neighbourhood from the location results."
            )
        return attrs


class PlaceSuggestQuerySerializer(serializers.Serializer):
    """What the location field sends while somebody types."""

    q = serializers.CharField(required=False, allow_blank=True, max_length=120)
    #: One per typing session, made by the client: a UUID, as Google recommends.
    session = serializers.UUIDField(required=False)
    limit = serializers.IntegerField(required=False, min_value=1, max_value=8, default=5)
    scope = serializers.ChoiceField(
        choices=("all", "areas"), required=False, default="all"
    )


class PlaceResolveQuerySerializer(serializers.Serializer):
    """A chosen suggestion, named the way it was suggested."""

    provider = serializers.ChoiceField(choices=list(PROVIDER_NAMES))
    reference = serializers.RegexField(r"^[A-Za-z0-9_-]{1,300}$", max_length=300)
    #: The session the suggestion came from; resolving closes it.
    session = serializers.UUIDField(required=False)
    #: The suggestion's own label, shown as the place's name.
    name = serializers.CharField(required=False, allow_blank=True, max_length=160)


class ResolvedPlaceSerializer(serializers.Serializer):
    """A place as a map target: what it is called, where it is and how far it reaches."""

    provider = serializers.CharField()
    reference = serializers.CharField()
    display_name = serializers.CharField()
    kind = serializers.CharField()
    center = serializers.SerializerMethodField()
    bounds = serializers.SerializerMethodField()

    def get_center(self, obj) -> dict[str, float]:
        return obj.center.as_dict()

    def get_bounds(self, obj) -> dict[str, float]:
        return obj.bounds.as_dict()
