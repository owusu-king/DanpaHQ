import pytest

from apps.core.digital_address import DigitalAddressError, normalise_digital_address


@pytest.mark.parametrize("raw", ["GA-543-0125", "ga-543-0125", "GA 543 0125", "GA5430125"])
def test_accepted_shapes_normalise(raw):
    assert normalise_digital_address(raw).value == "GA-543-0125"


def test_region_is_resolved():
    assert normalise_digital_address("GA-543-0125").region_name == "Greater Accra"


def test_five_digit_unique_code_is_valid():
    assert normalise_digital_address("AK-039-51234").value == "AK-039-51234"


@pytest.mark.parametrize("raw", ["", "GA-54-0125", "ZZ-543-0125", "543-0125", "GA-543-012"])
def test_malformed_addresses_are_rejected(raw):
    with pytest.raises(DigitalAddressError):
        normalise_digital_address(raw)
