"""Verification lifecycle. The requirement was that verification never reduces
to a boolean; these tests are what that means when it is tested."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.exceptions import Conflict, ValidationFailed
from apps.trust import services
from apps.trust.models import (
    EvidenceType,
    ReviewQueueEntry,
    SubjectType,
    Verification,
    VerificationKind,
    VerificationMethod,
    VerificationStatus,
)
from apps.trust.tasks import expire_verifications

pytestmark = pytest.mark.django_db


@pytest.fixture
def pending(user):
    return services.start_verification(
        subject_type=SubjectType.USER,
        subject_id=user.id,
        kind=VerificationKind.IDENTITY,
        method=VerificationMethod.DOCUMENT_REVIEW,
        submitted_by=user,
    )


def attach(verification, user):
    return services.attach_evidence(
        verification,
        evidence_type=EvidenceType.GHANA_CARD_FRONT,
        reference="ends 7890",
        collected_by=user,
    )


class TestStarting:
    def test_starting_queues_it_for_a_reviewer(self, pending):
        assert ReviewQueueEntry.objects.filter(verification=pending).exists()

    def test_two_live_checks_of_the_same_kind_are_refused(self, user, pending):
        with pytest.raises(Conflict):
            services.start_verification(
                subject_type=SubjectType.USER,
                subject_id=user.id,
                kind=VerificationKind.IDENTITY,
                method=VerificationMethod.DOCUMENT_REVIEW,
                submitted_by=user,
            )

    def test_agents_are_reviewed_before_tenants(self, user, landlord):
        agency = services.start_verification(
            subject_type=SubjectType.USER,
            subject_id=landlord.id,
            kind=VerificationKind.AGENCY,
            method=VerificationMethod.DOCUMENT_REVIEW,
        )
        address = services.start_verification(
            subject_type=SubjectType.USER,
            subject_id=user.id,
            kind=VerificationKind.ADDRESS,
            method=VerificationMethod.DOCUMENT_REVIEW,
        )
        assert (
            ReviewQueueEntry.objects.get(verification=agency).priority
            < ReviewQueueEntry.objects.get(verification=address).priority
        )


class TestDeciding:
    def test_approval_without_evidence_is_refused(self, pending, staff):
        """A manual approval with nothing attached cannot be re-examined when the
        tenant it protected loses money."""
        with pytest.raises(ValidationFailed):
            services.decide(pending, approved=True, decided_by=staff)

    def test_approval_with_evidence_sets_a_dated_expiry(self, pending, staff, user):
        attach(pending, user)
        decided = services.decide(pending, approved=True, decided_by=staff, note="Card matches.")

        assert decided.status == VerificationStatus.APPROVED
        assert decided.decided_at is not None
        assert decided.decided_by == staff
        assert decided.expires_at is not None
        assert decided.display_state == "verified"

    def test_rejection_requires_an_explanation(self, pending, staff, user):
        attach(pending, user)
        with pytest.raises(ValidationFailed):
            services.decide(pending, approved=False, decided_by=staff)

    def test_rejection_note_reaches_the_person(self, pending, staff, user):
        attach(pending, user)
        decided = services.decide(
            pending,
            approved=False,
            decided_by=staff,
            note="The photo is too blurry to read. Send a clearer one in daylight.",
        )
        assert "clearer one" in decided.decision_note

    def test_a_decided_check_cannot_be_decided_again(self, pending, staff, user):
        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)
        with pytest.raises(Conflict):
            services.decide(pending, approved=False, decided_by=staff, note="changed my mind")

    def test_deciding_closes_the_queue_item(self, pending, staff, user):
        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)
        assert ReviewQueueEntry.objects.get(verification=pending).resolved_at is not None

    def test_every_decision_is_audited(self, pending, staff, user):
        from apps.audit.models import AuditAction, AuditLog

        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)

        entries = AuditLog.objects.filter(
            aggregate_type="verification",
            aggregate_id=str(pending.id),
            action=AuditAction.VERIFICATION_DECISION,
        )
        assert entries.count() >= 2  # started, decided


class TestExpiry:
    def test_a_stamp_stops_claiming_currency_the_moment_it_lapses(self, pending, staff, user):
        """display_state is computed, not read from status, so it is honest
        between hourly expiry sweeps."""
        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)

        Verification.objects.filter(id=pending.id).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        pending.refresh_from_db()

        assert pending.status == VerificationStatus.APPROVED  # sweep has not run
        assert pending.display_state == "expired"
        assert not pending.is_current

    def test_the_sweep_moves_lapsed_rows_and_announces_them(self, pending, staff, user):
        from apps.outbox.models import OutboxEvent

        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)
        Verification.objects.filter(id=pending.id).update(
            expires_at=timezone.now() - timedelta(days=1)
        )

        assert expire_verifications()["expired"] == 1
        pending.refresh_from_db()
        assert pending.status == VerificationStatus.EXPIRED
        assert OutboxEvent.objects.filter(name="trust.verification_expired.v1").exists()


class TestHistory:
    def test_evidence_cannot_be_deleted(self, pending, user):
        evidence = attach(pending, user)
        with pytest.raises(RuntimeError):
            evidence.delete()

    def test_rechecking_supersedes_rather_than_overwrites(self, pending, staff, user):
        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)

        replacement = services.supersede_and_restart(
            pending, method=VerificationMethod.DOCUMENT_REVIEW, submitted_by=user
        )
        pending.refresh_from_db()

        assert pending.status == VerificationStatus.SUPERSEDED
        assert replacement.supersedes_id == pending.id
        assert Verification.objects.filter(
            id=pending.id
        ).exists(), "what we believed in March must stay readable in December"

    def test_revocation_keeps_the_row(self, pending, staff, user):
        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)
        services.revoke(pending, reason="Document found to be forged.", decided_by=staff)

        pending.refresh_from_db()
        assert pending.status == VerificationStatus.REVOKED
        assert pending.display_state == "unverified"

    def test_revoking_requires_a_reason(self, pending, staff, user):
        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)
        with pytest.raises(ValidationFailed):
            services.revoke(pending, reason="", decided_by=staff)


class TestSummary:
    def test_unchecked_kinds_are_reported_explicitly(self, user):
        """An absent stamp would let the interface imply a check happened."""
        summary = services.trust_summary(SubjectType.USER, user.id)
        assert summary[VerificationKind.IDENTITY]["state"] == "unverified"
        assert VerificationKind.AGENCY in summary

    def test_summary_reflects_an_approval(self, pending, staff, user):
        attach(pending, user)
        services.decide(pending, approved=True, decided_by=staff)

        summary = services.trust_summary(SubjectType.USER, user.id)
        assert summary[VerificationKind.IDENTITY]["state"] == "verified"
        assert summary[VerificationKind.IDENTITY]["decided_at"] is not None
