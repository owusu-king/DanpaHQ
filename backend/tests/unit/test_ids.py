import pytest

from apps.core.ids import CROCKFORD_ALPHABET, reference_code, uuid7, uuid7_at


def test_version_and_variant_are_rfc_9562():
    value = uuid7()
    assert value.version == 7
    assert (value.int >> 62) & 0b11 == 0b10


def test_ids_sort_in_creation_order():
    """The whole reason for UUIDv7 over UUIDv4: index locality on insert."""
    ids = [uuid7() for _ in range(2000)]
    assert ids == sorted(ids)


def test_ids_are_unique():
    assert len({uuid7() for _ in range(10_000)}) == 10_000


def test_timestamp_is_embedded():
    ms = 1_700_000_000_000
    assert (uuid7_at(ms).int >> 80) == ms


def test_reference_codes_avoid_confusable_characters():
    body = reference_code("PAY", 32).split("-")[1]
    assert set(body) <= set(CROCKFORD_ALPHABET)
    assert not (set(body) & set("ILOU"))


def test_reference_code_prefix_is_validated():
    with pytest.raises(ValueError):
        reference_code("PAYMENTS")
    with pytest.raises(ValueError):
        reference_code("PAY", 4)
