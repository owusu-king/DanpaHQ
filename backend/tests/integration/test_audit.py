"""Audit integrity. These need a real database because the guarantees are
transactional and index-level, not Python-level.
"""

import pytest

from apps.audit.models import AuditAction, AuditLog
from apps.audit.services import record, verify_chain

pytestmark = pytest.mark.django_db


def test_entry_is_written_with_context(user):
    entry = record(
        action=AuditAction.UPDATE,
        aggregate_type="listing",
        aggregate_id="listing-1",
        actor=user,
        changes={"rent_minor": [150000, 180000]},
    )
    # `... or True` used to stand here, so this line asserted nothing at all —
    # and the comment beside it was wrong: `record` writes the hash before it
    # returns. Asserting what actually happens is the point of the entry.
    assert entry.entry_hash
    assert entry.entry_hash == entry.compute_hash()
    assert AuditLog.objects.filter(aggregate_id="listing-1").count() == 1


def test_entries_cannot_be_modified(user):
    entry = record(
        action=AuditAction.CREATE, aggregate_type="listing", aggregate_id="listing-2", actor=user
    )
    entry.action = AuditAction.DELETE
    with pytest.raises(RuntimeError):
        entry.save()


def test_entries_cannot_be_deleted(user):
    entry = record(
        action=AuditAction.CREATE, aggregate_type="listing", aggregate_id="listing-3", actor=user
    )
    with pytest.raises(RuntimeError):
        entry.delete()


def test_sensitive_values_are_never_stored(user):
    entry = record(
        action=AuditAction.UPDATE,
        aggregate_type="user",
        aggregate_id=str(user.id),
        actor=user,
        changes={"password": ["old-secret", "new-secret"], "first_name": ["Ama", "Ama K."]},
    )
    entry.refresh_from_db()
    assert entry.changes["password"] == ["[redacted]", "[redacted]"]
    assert entry.changes["first_name"] == ["Ama", "Ama K."]


def test_chain_verifies_for_an_untouched_history(user):
    for i in range(5):
        record(
            action=AuditAction.UPDATE,
            aggregate_type="lease",
            aggregate_id="lease-1",
            actor=user,
            changes={"n": [i, i + 1]},
        )
    ok, broken = verify_chain("lease", "lease-1")
    assert ok, broken
