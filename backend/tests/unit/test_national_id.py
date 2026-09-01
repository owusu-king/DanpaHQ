import pytest

from apps.core.national_id import NationalIdError, normalise_ghana_card


@pytest.mark.parametrize(
    "raw", ["GHA-123456789-0", "gha-123456789-0", "GHA1234567890", "1234567890"]
)
def test_accepted_shapes_normalise(raw):
    assert normalise_ghana_card(raw).normalised == "GHA-123456789-0"


def test_last4_is_extracted_for_support():
    assert normalise_ghana_card("GHA-123456789-0").last4 == "7890"


def test_digits_are_available_for_hashing_without_punctuation():
    assert normalise_ghana_card("GHA-123456789-0").digits == "1234567890"


@pytest.mark.parametrize("raw", ["", "GHA-12345-0", "ABC-123456789-0", "123456789"])
def test_malformed_numbers_are_rejected(raw):
    with pytest.raises(NationalIdError):
        normalise_ghana_card(raw)
