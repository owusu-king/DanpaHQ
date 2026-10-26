import pytest

from apps.core.phone import (
    PhoneNumberError,
    format_national,
    guess_network,
    mask,
    normalise_ghana_msisdn,
)

E164 = "+233241234567"


@pytest.mark.parametrize(
    "raw",
    [
        "0241234567",
        "024 123 4567",
        "024-123-4567",
        "+233241234567",
        "+233 24 123 4567",
        "00233241234567",
        "233241234567",
        "241234567",
        "  0241234567  ",
    ],
)
def test_every_shape_a_user_types_normalises_the_same(raw):
    assert normalise_ghana_msisdn(raw) == E164


@pytest.mark.parametrize(
    "raw",
    ["", "   ", "024123", "02412345678", "abcdefghij", "0121234567", "+2331234"],
)
def test_invalid_numbers_are_rejected(raw):
    with pytest.raises(PhoneNumberError):
        normalise_ghana_msisdn(raw)


def test_error_messages_tell_the_user_what_to_do():
    with pytest.raises(PhoneNumberError) as exc:
        normalise_ghana_msisdn("024123")
    assert "10 digits" in str(exc.value)


def test_landline_allowed_when_mobile_not_required():
    assert normalise_ghana_msisdn("0302123456", mobile_only=False) == "+233302123456"


def test_national_formatting():
    assert format_national(E164) == "024 123 4567"


def test_masking_keeps_enough_to_confirm_but_not_to_dial():
    assert mask(E164) == "024 *** 4567"


def test_network_hint_is_never_confident():
    hint = guess_network(E164)
    assert hint.network == "MTN"
    assert hint.confident is False  # portability
