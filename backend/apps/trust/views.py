"""Trust API.

Split deliberately into two surfaces:

* **Subject endpoints** — what a person can do about checks on themselves:
  start one, attach evidence, see the outcome.
* **Reviewer endpoints** — claiming and deciding. Gated on staff/support, with an
  object-level rule that a reviewer cannot decide a check about themselves.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import Conflict, NotFound, ValidationFailed
from apps.core.national_id import NationalIdError, normalise_ghana_card
from apps.identity.permissions import CanReviewVerifications, IsPhoneVerified

from . import services
from .models import (
    EvidenceType,
    ReviewQueueEntry,
    SubjectType,
    Verification,
    VerificationKind,
    VerificationStatus,
)
from .serializers import (
    AttachEvidenceSerializer,
    DecisionSerializer,
    ReviewerVerificationSerializer,
    ReviewQueueSerializer,
    StartVerificationSerializer,
    VerificationSerializer,
)

CLAIM_MINUTES = 30


class OperationsSessionOnly:
    """Keep reviewer actions outside the consumer bearer-token boundary.

    Operations users authenticate through the separately provisioned Django
    admin surface. Even a valid consumer access token is intentionally ignored
    by these endpoints.
    """

    authentication_classes = (SessionAuthentication,)


class MyVerificationsView(APIView):
    """GET/POST /trust/verifications/ — checks about me."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = Verification.objects.for_subject(SubjectType.USER, request.user.id).exclude(
            status=VerificationStatus.SUPERSEDED
        )
        return Response(
            {
                "summary": services.trust_summary(SubjectType.USER, request.user.id),
                "verifications": VerificationSerializer(rows, many=True).data,
            }
        )

    def post(self, request):
        payload = StartVerificationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        # Checks started through this endpoint are claims about the signed-in
        # person. Property ownership/authority belongs to the provider workflow
        # where a property and relationship are named explicitly.
        allowed = {
            VerificationKind.IDENTITY,
            VerificationKind.SELFIE_MATCH,
            VerificationKind.ADDRESS,
            VerificationKind.AGENCY,
            VerificationKind.COMPANY,
            VerificationKind.BANK_ACCOUNT,
        }
        if payload.validated_data["kind"] not in allowed:
            raise ValidationFailed("Start property checks from the provider verification flow.")

        verification = services.start_verification(
            subject_type=SubjectType.USER,
            subject_id=request.user.id,
            kind=payload.validated_data["kind"],
            method=payload.validated_data["method"],
            submitted_by=request.user,
        )
        return Response(VerificationSerializer(verification).data, status=status.HTTP_201_CREATED)


class VerificationEvidenceView(APIView):
    """POST /trust/verifications/<id>/evidence/ — add supporting material."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    @transaction.atomic
    def post(self, request, pk):
        verification = Verification.objects.filter(
            id=pk, subject_type=SubjectType.USER, subject_id=str(request.user.id)
        ).first()
        if verification is None:
            raise NotFound("We could not find that check.")

        payload = AttachEvidenceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        stored_file = None
        if data.get("file_id"):
            from apps.files.models import StoredFile

            stored_file = StoredFile.objects.filter(
                id=data["file_id"], uploaded_by=request.user
            ).first()
            if stored_file is None:
                raise NotFound("We could not find that upload.")

        reference = data.get("reference", "")

        if data.get("national_id"):
            # The number itself never lands in the database. We keep a peppered
            # hash for duplicate detection and the last four so support can
            # confirm which card is being discussed.
            try:
                card = normalise_ghana_card(data["national_id"])
            except NationalIdError as exc:
                raise ValidationFailed(str(exc)) from exc

            from django.conf import settings

            from apps.core.crypto import hash_secret
            from apps.identity.models import Profile

            digest = hash_secret(
                card.digits,
                pepper=getattr(settings, "NATIONAL_ID_PEPPER", None) or settings.SECRET_KEY,
            )
            clash = (
                Profile.objects.filter(national_id_hash=digest).exclude(user=request.user).exists()
            )
            if clash:
                # Two accounts on one Ghana Card is either a duplicate account or
                # an impersonation. Both need a human, so it becomes a reviewer
                # note rather than an automatic rejection of a possibly real user.
                services.attach_evidence(
                    verification,
                    evidence_type=EvidenceType.PROVIDER_RESPONSE,
                    reference="duplicate_national_id",
                    collected_by=request.user,
                    notes="This card number is already attached to another account.",
                )

            profile, _ = Profile.objects.get_or_create(user=request.user)
            profile.national_id_hash = digest
            profile.national_id_last4 = card.last4
            profile.save(update_fields=["national_id_hash", "national_id_last4", "updated_at"])
            reference = f"ends {card.last4}"

        evidence = services.attach_evidence(
            verification,
            evidence_type=data["evidence_type"],
            file=stored_file,
            reference=reference,
            collected_by=request.user,
            notes=data.get("notes", ""),
        )
        return Response(
            {"id": str(evidence.id), "verification": VerificationSerializer(verification).data},
            status=status.HTTP_201_CREATED,
        )


class PublicTrustView(APIView):
    """GET /trust/users/<id>/ — how another user's trust appears.

    Returns states and dates only. Never evidence, never a document, never the
    reviewer's notes: a tenant needs to know whether the landlord's identity was
    checked and when, not to see their Ghana Card.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from apps.identity.models import User
        from apps.identity.serializers import PublicUserSerializer

        user = User.objects.filter(id=pk, is_active=True).first()
        if user is None:
            raise NotFound("We could not find that person.")
        return Response(PublicUserSerializer(user).data)


class ReviewQueueView(OperationsSessionOnly, APIView):
    """GET /trust/review/queue/ — work waiting for a reviewer."""

    permission_classes = [IsAuthenticated, CanReviewVerifications]

    def get(self, request):
        entries = (
            ReviewQueueEntry.objects.filter(resolved_at__isnull=True)
            .select_related("verification", "claimed_by")
            .prefetch_related("verification__evidence")
        )
        mine = request.query_params.get("mine") == "true"
        if mine:
            entries = entries.filter(claimed_by=request.user)

        return Response(ReviewQueueSerializer(entries[:100], many=True).data)


class ClaimReviewView(OperationsSessionOnly, APIView):
    """POST /trust/review/<id>/claim/ — take an item so nobody duplicates it."""

    permission_classes = [IsAuthenticated, CanReviewVerifications]

    @transaction.atomic
    def post(self, request, pk):
        entry = ReviewQueueEntry.objects.select_for_update().filter(id=pk).first()
        if entry is None:
            raise NotFound("That review item does not exist.")
        if not entry.is_claimable:
            raise Conflict(f"{entry.claimed_by} is already reviewing this.")

        entry.claimed_by = request.user
        entry.claimed_at = timezone.now()
        entry.claim_expires_at = timezone.now() + timedelta(minutes=CLAIM_MINUTES)
        entry.save(update_fields=["claimed_by", "claimed_at", "claim_expires_at"])

        return Response(ReviewQueueSerializer(entry).data)


class DecideVerificationView(OperationsSessionOnly, APIView):
    """POST /trust/review/verifications/<id>/decide/"""

    permission_classes = [IsAuthenticated, CanReviewVerifications]

    def post(self, request, pk):
        verification = Verification.objects.filter(id=pk).first()
        if verification is None:
            raise NotFound("We could not find that check.")

        self.check_object_permissions(request, verification)

        payload = DecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        verification = services.decide(
            verification,
            approved=data["approved"],
            decided_by=request.user,
            note=data.get("note", ""),
            internal_note=data.get("internal_note", ""),
            validity_days=data.get("validity_days"),
        )
        return Response(ReviewerVerificationSerializer(verification).data)


class RequestMoreInfoView(OperationsSessionOnly, APIView):
    permission_classes = [IsAuthenticated, CanReviewVerifications]

    def post(self, request, pk):
        verification = Verification.objects.filter(id=pk).first()
        if verification is None:
            raise NotFound("We could not find that check.")
        self.check_object_permissions(request, verification)

        note = request.data.get("note", "")
        verification = services.request_more_information(
            verification, note=note, decided_by=request.user
        )
        return Response(ReviewerVerificationSerializer(verification).data)


class RevokeVerificationView(OperationsSessionOnly, APIView):
    permission_classes = [IsAuthenticated, CanReviewVerifications]

    def post(self, request, pk):
        verification = Verification.objects.filter(id=pk).first()
        if verification is None:
            raise NotFound("We could not find that check.")
        self.check_object_permissions(request, verification)

        verification = services.revoke(
            verification, reason=request.data.get("reason", ""), decided_by=request.user
        )
        return Response(ReviewerVerificationSerializer(verification).data)
