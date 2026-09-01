"""Collecting and submitting condition evidence.

One shape for both subjects. A property and a rentable space are asked for
different photographs, but the *flow* is identical — see what is needed, add
photos against named slots, submit when nothing required is outstanding — and
writing it twice would guarantee the two drifted.
"""

from __future__ import annotations

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound, ValidationFailed
from apps.idempotency.services import idempotent_mutation

from . import condition


class AttachEvidenceSerializer(serializers.Serializer):
    #: The slot this photo answers. Checked against the policy, never trusted —
    #: see `condition.attach`.
    slot_key = serializers.CharField(max_length=60)
    file_id = serializers.UUIDField()


class _ConditionView(APIView):
    """Shared behaviour. Subclasses only say how to find their subject."""

    permission_classes = [IsAuthenticated]

    def subject(self, pk):  # pragma: no cover - overridden
        raise NotImplementedError

    def get(self, request, pk):
        """What is asked for, what has arrived, what is outstanding."""
        return Response(condition.progress(subject=self.subject(pk), user=request.user))

    @idempotent_mutation(resource_type="verification")
    def post(self, request, pk):
        """Ask for a decision. Refused while anything required is missing."""
        subject = self.subject(pk)
        condition.submit_for_review(subject=subject, actor=request.user)
        return Response(condition.progress(subject=subject, user=request.user))


class _EvidenceView(APIView):
    permission_classes = [IsAuthenticated]

    def subject(self, pk):  # pragma: no cover - overridden
        raise NotImplementedError

    def post(self, request, pk):
        from apps.files.models import StoredFile

        payload = AttachEvidenceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        subject = self.subject(pk)
        stored = StoredFile.objects.filter(id=data["file_id"]).first()
        if stored is None:
            raise NotFound("We could not find that upload.")

        condition.attach(
            subject=subject,
            actor=request.user,
            slot_key=data["slot_key"],
            file=stored,
        )
        return Response(
            condition.progress(subject=subject, user=request.user),
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request, pk):
        """Take one slot's photograph back down.

        The half that was missing. `condition.detach` has existed since P3 and
        nothing exposed it, so a filled slot rendered as a flat "Added" with no
        control on it — a provider who photographed the wrong side of a building
        could never correct it, in any state.

        Keyed on the slot rather than the file because that is what a checklist
        knows about. Refused once a reviewer has been asked to look.
        """
        slot_key = str(request.data.get("slot_key") or request.query_params.get("slot_key") or "")
        if not slot_key:
            raise ValidationFailed("Say which photograph to remove.")

        subject = self.subject(pk)
        condition.detach_slot(subject=subject, actor=request.user, slot_key=slot_key)
        return Response(condition.progress(subject=subject, user=request.user))


def _property_or_404(pk):
    from apps.property.models import Property

    prop = Property.objects.filter(pk=pk).select_related("address").first()
    if prop is None:
        raise NotFound("That property does not exist.")
    return prop


def _unit_or_404(pk):
    from apps.property.models import Unit

    unit = Unit.objects.filter(pk=pk).select_related("property").first()
    if unit is None:
        raise NotFound("That space does not exist.")
    return unit


class _WithdrawView(APIView):
    """Take a submission back out of the review queue.

    Its own route rather than a DELETE on the verification endpoint: nothing is
    deleted. The review stays, its evidence stays, and only its place in the
    queue goes — so the subject lands back exactly where it was before the send.
    """

    permission_classes = [IsAuthenticated]

    def subject(self, pk):  # pragma: no cover - overridden
        raise NotImplementedError

    @idempotent_mutation(resource_type="verification")
    def post(self, request, pk):
        subject = self.subject(pk)
        condition.withdraw_submission(
            subject=subject,
            actor=request.user,
            reason=str(request.data.get("reason", "")),
        )
        return Response(condition.progress(subject=subject, user=request.user))


class PropertyConditionView(_ConditionView):
    """GET/POST /properties/<id>/verification/

    `POST` sends the **whole property**, not just its photographs.

    A property is two reviews — the document that says it is yours to let, and
    the photographs that say it is what you describe — and they are decided
    together. Submitting only the photographs left the claim behind, so a
    reviewer received pictures of a building nobody had claimed and the provider
    was later asked to send the same property a second time.

    The property-level act lives in `property.services`, which owns both halves.
    """

    def subject(self, pk):
        return _property_or_404(pk)

    @idempotent_mutation(resource_type="property_verification_submission")
    def post(self, request, pk):
        from apps.property import services as property_services

        subject = self.subject(pk)
        property_services.submit_property_for_verification(
            prop=subject, user=request.user, note=str(request.data.get("note", ""))
        )
        return Response(condition.progress(subject=subject, user=request.user))


class PropertyConditionEvidenceView(_EvidenceView):
    """POST /properties/<id>/verification/evidence/"""

    def subject(self, pk):
        return _property_or_404(pk)


class SpaceConditionView(_ConditionView):
    """GET/POST /units/<id>/verification/"""

    def subject(self, pk):
        return _unit_or_404(pk)


class SpaceConditionEvidenceView(_EvidenceView):
    """POST /units/<id>/verification/evidence/"""

    def subject(self, pk):
        return _unit_or_404(pk)


class SpaceConditionWithdrawView(_WithdrawView):
    """POST /units/<id>/verification/withdraw/"""

    def subject(self, pk):
        return _unit_or_404(pk)


class PropertyConditionWithdrawView(_WithdrawView):
    """POST /properties/<id>/verification/withdraw/

    Withdraws the photographs. The authority claim is taken back separately by
    `property_views.PropertyWithdrawView`, which does both — they are two
    reviews, and only one of them lives here.
    """

    def subject(self, pk):
        return _property_or_404(pk)
