"""Geography over the wire.

Regions, districts and localities are reference data: read-only to every client,
extended by operations. Addresses are the one thing a user creates, and they are
deliberately forgiving - a Ghanaian address is often a landmark and a description
rather than a street number, and refusing that would make the field unusable.
"""

from decimal import Decimal

from rest_framework import serializers

from apps.core.digital_address import DigitalAddressError, normalise_digital_address

from .models import Address, District, Locality, Place, Region


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
    locality_name = serializers.CharField(source="locality.name", read_only=True)
    district_name = serializers.CharField(source="locality.district.name", read_only=True)
    region_name = serializers.CharField(source="locality.district.region.name", read_only=True)

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
            "created_at",
        ]
        read_only_fields = [
            "id",
            "locality_name",
            "district_name",
            "region_name",
            "created_at",
        ]


class CreateAddressSerializer(serializers.Serializer):
    """What a client sends to record where something is.

    Only the locality is required. Everything else is optional because the
    honest state of a Ghanaian address is often "Osu, near the Total station"
    and nothing more, and a form that refuses that is a form people abandon.
    """

    locality_id = serializers.UUIDField()
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


class PlaceSerializer(serializers.ModelSerializer):
    """A place as a suggestion and as a map target: what it is called and where it is."""

    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    display_name = serializers.SerializerMethodField()
    center = serializers.SerializerMethodField()
    bounds = serializers.SerializerMethodField()
    locality_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = Place
        fields = [
            "slug",
            "name",
            "kind",
            "kind_label",
            "context",
            "display_name",
            "center",
            "bounds",
            "locality_id",
        ]
        read_only_fields = fields

    def get_display_name(self, obj) -> str:
        """The name and the first part of its context: "East Legon, Accra"."""
        anchor = obj.context.split(",")[0].strip() if obj.context else ""
        if not anchor or anchor in {obj.name, "Ghana"}:
            return obj.name
        return f"{obj.name}, {anchor}"

    def get_center(self, obj) -> dict:
        return {"lat": round(obj.center.y, 6), "lng": round(obj.center.x, 6)}

    def get_bounds(self, obj) -> dict:
        west, south, east, north = obj.bounds.extent
        return {
            "west": round(west, 6),
            "south": round(south, 6),
            "east": round(east, 6),
            "north": round(north, 6),
        }
