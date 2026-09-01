"""Applications over the wire.

The shortfall fields exist because the raw numbers are not the useful thing.
"Asks 12, offers 6" makes both sides do arithmetic; "6 months short" is the
sentence they would actually say.

The identity fields — the photograph, the Property title, the Unit label — are
here because an application list without them is a column of headlines. A
tenant recognizes the place they applied for by looking at it, and a landlord
reading three applications needs to know which Unit each one is for.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.core.money import Money
from apps.core.phone import PhoneNumberError, normalise_ghana_msisdn

from .models import RentalApplication


class RentalApplicationSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    listing_id = serializers.UUIDField(source="listing.id", read_only=True)
    listing_headline = serializers.CharField(source="listing.headline", read_only=True)
    locality_name = serializers.CharField(
        source="listing.unit.property.address.locality.name", read_only=True, default=None
    )
    rent_minor = serializers.IntegerField(source="listing.rent_minor", read_only=True)
    rent_formatted = serializers.SerializerMethodField()
    advance_months_asked = serializers.IntegerField(source="listing.advance_months", read_only=True)

    # Which place this is, in the terms the Unit itself is named in. The
    # listing's headline is a campaign line and outlives nothing; the Property
    # title and Unit label are how both sides actually refer to the space.
    listing_status = serializers.CharField(source="listing.status", read_only=True)
    property_title = serializers.CharField(source="unit.property.title", read_only=True)
    unit_label = serializers.CharField(source="unit.label", read_only=True)
    space_type_label = serializers.CharField(
        source="unit.get_space_type_display", read_only=True, default=None
    )
    photo_url = serializers.SerializerMethodField()

    applicant_name = serializers.CharField(source="tenant.display_name", read_only=True)
    # A lease is drawn up from an accepted application, so the console needs
    # to name the unit and the person without a second round trip.
    tenant_id = serializers.UUIDField(source="tenant.id", read_only=True)
    unit_id = serializers.UUIDField(source="unit.id", read_only=True)
    applicant_phone_verified = serializers.BooleanField(
        source="tenant.is_phone_verified", read_only=True
    )

    advance_shortfall_months = serializers.IntegerField(read_only=True)
    meets_advance = serializers.BooleanField(read_only=True)

    class Meta:
        model = RentalApplication
        fields = [
            "id",
            "status",
            "status_display",
            # Whether the acquisition this produced is over. Without it a client
            # cannot tell an accepted application that is still a live claim on
            # the Unit from the record of a tenancy that finished last year.
            "concluded_at",
            "listing_id",
            "listing_headline",
            "locality_name",
            "listing_status",
            "property_title",
            "unit_label",
            "space_type_label",
            "photo_url",
            "rent_minor",
            "rent_formatted",
            "advance_months_asked",
            "applicant_name",
            "applicant_phone_verified",
            "tenant_id",
            "unit_id",
            "move_in_from",
            "household_size",
            "advance_months_offered",
            "advance_shortfall_months",
            "meets_advance",
            "occupation",
            "employer",
            "income_band",
            "guarantor_name",
            "guarantor_phone",
            "guarantor_relationship",
            "message",
            "decision_note",
            "decided_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_rent_formatted(self, obj) -> str | None:
        rent = obj.listing.rent_minor
        if rent is None:
            return None
        return str(Money(rent, obj.listing.rent_currency or "GHS"))

    def get_photo_url(self, obj) -> str | None:
        """The photograph of the place, for whoever is party to this application.

        Presigned even when the listing is no longer advertised: every endpoint
        that reaches this serializer is already scoped to a participant. See
        `participant_cover_url` for the file gate and the reasoning.
        """
        from apps.listing.serializers import participant_cover_url

        return participant_cover_url(unit=obj.unit, listing=obj.listing)


class SubmitApplicationSerializer(serializers.Serializer):
    listing_id = serializers.UUIDField()
    move_in_from = serializers.DateField(required=False, allow_null=True)
    household_size = serializers.IntegerField(required=False, min_value=1, max_value=30)
    advance_months_offered = serializers.IntegerField(min_value=0, max_value=36)
    message = serializers.CharField(max_length=1000, required=False, allow_blank=True)

    occupation = serializers.CharField(max_length=120, required=False, allow_blank=True)
    employer = serializers.CharField(max_length=160, required=False, allow_blank=True)
    #: Choices are bound in `__init__` rather than here. A class body runs at
    #: import time, so naming `IncomeBand` on this line would make the whole
    #: module depend on identity's models — the one thing ADR 0002 rules out.
    #: The vocabulary is still identity's; only the moment of reading it moves.
    income_band = serializers.ChoiceField(choices=[], required=False, allow_blank=True)

    guarantor_name = serializers.CharField(max_length=160, required=False, allow_blank=True)
    guarantor_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    guarantor_relationship = serializers.CharField(max_length=60, required=False, allow_blank=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from apps.identity.models import IncomeBand

        self.fields["income_band"].choices = IncomeBand.choices

    def validate_guarantor_phone(self, value: str) -> str:
        if not value:
            return ""
        try:
            return normalise_ghana_msisdn(value)
        except PhoneNumberError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class DecisionSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)
