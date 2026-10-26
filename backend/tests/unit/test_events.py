import pytest

from apps.core.events import DomainEvent


def test_event_names_must_be_versioned():
    with pytest.raises(ValueError):
        DomainEvent(name="lease.signed", aggregate_type="lease", aggregate_id="1")


def test_well_formed_event():
    event = DomainEvent(
        name="lease.signed.v1",
        aggregate_type="lease",
        aggregate_id="abc",
        payload={"tenant_id": "x"},
    )
    assert event.as_dict()["payload"]["tenant_id"] == "x"
