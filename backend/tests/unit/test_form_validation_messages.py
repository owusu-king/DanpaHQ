import pytest
from rest_framework.exceptions import ValidationError

from apps.core.exceptions import ValidationFailed
from apps.listing.serializers import CreateListingSerializer, UpdateListingSerializer


def test_validation_names_each_field_and_keeps_structured_details():
    details = {"fields": {"bedrooms": ["Use at most 20."], "address": {"street": ["Required."]}}}
    failure = ValidationFailed(details=details)
    assert failure.message == "Bedrooms: Use at most 20. Address. street: Required."
    assert failure.to_payload()["error"]["details"] == details


def test_explicit_domain_message_is_kept():
    failure = ValidationFailed("Choose a different unit.", details={"fields": {"unit": ["Taken."]}})
    assert failure.message == "Choose a different unit."


def test_non_field_validation_does_not_show_a_technical_field_name():
    failure = ValidationFailed(details={"fields": {"non_field_errors": ["Choose a location."]}})
    assert failure.message == "Choose a location."


def test_listing_advance_accepts_36_and_rejects_37_for_create_and_update():
    for serializer in (CreateListingSerializer, UpdateListingSerializer):
        field = serializer().fields["advance_months"]
        assert field.run_validation(36) == 36
        with pytest.raises(ValidationError):
            field.run_validation(37)
