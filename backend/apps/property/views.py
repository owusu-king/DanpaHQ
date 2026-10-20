from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.core.memo import memoized
from apps.files.models import StoredFile
from apps.idempotency.services import idempotent_mutation
from apps.identity.permissions import HasRole, IsPhoneVerified

from . import access_codes, services, spaces
from .models import AmenityScope, PropertyProviderApplication, Unit
from .serializers import (
    AmenityOptionSerializer,
    AttachUnitPhotoSerializer,
    BedSerializer,
    PropertyAmenitySerializer,
    PropertyMediaSerializer,
    PropertySerializer,
    ProviderApplicationSerializer,
    ProviderEvidenceSerializer,
    SetAmenitiesSerializer,
    SubmitProviderApplicationSerializer,
    UnitAmenitySerializer,
    UnitDetailSerializer,
    UnitMediaSerializer,
    UnitSerializer,
    UpdateUnitSerializer,
)


def _unit_queryset():
    """Everything a unit card renders, without a query per card.

    A hostel is forty rooms on one screen. Without these the page issues four
    queries per room and the provider watches a spinner on a phone.
    """
    return Unit.objects.select_related(
        "property__address__locality__district__region"
    ).prefetch_related("media__file", "unit_amenities__amenity", "beds")


class ProviderReadinessView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified, HasRole]
    required_roles = ["landlord", "agent", "property_manager"]

    def get(self, request):
        property_id = request.query_params.get("property_id")
        if property_id:
            prop = services.get_property_or_404(property_id, request.user)
            services.assert_can_manage(prop, request.user)
            property_id = prop.id
        response = Response(services.provider_readiness(request.user, property_id=property_id))
        response["Cache-Control"] = "private, no-store"
        return response


class ProviderApplicationView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified, HasRole]
    required_roles = ["landlord", "agent", "property_manager"]

    def get(self, request):
        rows = PropertyProviderApplication.objects.filter(applicant=request.user).select_related(
            "address__locality__district__region", "property"
        )
        response = Response(ProviderApplicationSerializer(rows, many=True).data)
        response["Cache-Control"] = "private, no-store"
        return response

    def post(self, request):
        payload = SubmitProviderApplicationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        files = list(
            StoredFile.objects.filter(id__in=data.pop("file_ids"), uploaded_by=request.user)
        )
        application = services.submit_provider_application(
            user=request.user, data=data, files=files
        )
        application = PropertyProviderApplication.objects.select_related(
            "address__locality__district__region", "property"
        ).get(id=application.id)
        return Response(
            ProviderApplicationSerializer(application).data,
            status=status.HTTP_201_CREATED,
        )


class PropertyClaimView(APIView):
    """POST /properties/<id>/claim/ — keep the document with the property.

    The Documents step of property creation. It records who says this property
    is theirs and what they are showing for it, and asks **nobody** to read it —
    the claim sits as a draft beside the photographs until the provider submits
    the property, which is a separate decision they make later.

    Distinct from `POST /provider/applications/`, which submits. That endpoint
    is the onboarding path, where a claim genuinely is the thing being sent and
    there is often no property row yet. Creating a property is not that, and
    routing creation through it is what made the second step of the wizard file
    a review.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified, HasRole]
    required_roles = ["landlord", "agent", "property_manager"]

    def post(self, request, pk):
        prop = services.get_property_or_404(pk, request.user)
        services.assert_can_manage(prop, request.user)

        payload = SubmitProviderApplicationSerializer(
            data={**request.data, "property_id": str(prop.id)}
        )
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        files = list(
            StoredFile.objects.filter(id__in=data.pop("file_ids"), uploaded_by=request.user)
        )
        application = services.record_property_claim(
            user=request.user, prop=prop, data=data, files=files
        )
        application = PropertyProviderApplication.objects.select_related(
            "address__locality__district__region", "property"
        ).get(id=application.id)
        return Response(
            ProviderApplicationSerializer(application).data,
            status=status.HTTP_201_CREATED,
        )


class ProviderApplicationEvidenceView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified, HasRole]
    required_roles = ["landlord", "agent", "property_manager"]

    def post(self, request, pk):
        application = PropertyProviderApplication.objects.filter(
            id=pk, applicant=request.user
        ).first()
        if application is None:
            raise NotFound("We could not find that provider application.")
        payload = ProviderEvidenceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        files = list(
            StoredFile.objects.filter(
                id__in=payload.validated_data["file_ids"], uploaded_by=request.user
            )
        )
        application = services.submit_provider_application_more_info(
            application=application,
            user=request.user,
            files=files,
            evidence_types=payload.validated_data.get("evidence_types") or {},
        )
        return Response(ProviderApplicationSerializer(application).data)


class PropertyListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request):
        """The Properties this person may operate, one Portfolio at a time.

        `?organization=<id>` is the provider's operational scope, and it is
        decided here rather than filtered in a browser: membership is required —
        a non-member gets the same 404 a stranger gets — and a role without
        Portfolio-wide access sees only the Properties assigned to it.

        Without the parameter this stays the account-wide list: everything the
        person can reach, across every Portfolio they belong to. That is a fair
        answer to "what do I have" and it is *not* a Portfolio view. Rendering
        it as one is what put a personal Portfolio's houses in a company's
        roster.
        """
        from apps.organization.services import properties_in_scope

        rows = properties_in_scope(
            user=request.user, organization=request.query_params.get("organization")
        )

        props = (
            rows.select_related("address__locality__district__region", "owner")
            # The Property's own photographs, without a query per row. The
            # condition evidence the cover falls back to cannot be prefetched —
            # `subject_id` is not a foreign key — and is batched in the
            # serializer instead.
            .prefetch_related("media__file")
            .order_by("-created_at")
        )
        # A listing asks the same questions of each row several times over —
        # who manages it, what its verification says, what stands in the way of
        # archiving it. This collapses them for the length of one read and
        # nothing else. See `apps.core.memo`.
        with memoized():
            return Response(
                PropertySerializer(props, many=True, context={"user": request.user}).data
            )

    def post(self, request):
        prop = services.create_property(user=request.user, data=request.data)
        return Response(
            PropertySerializer(prop, context={"user": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class PropertyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        prop = services.get_property_or_404(pk, request.user)
        services.assert_can_manage(prop, request.user)
        return Response(PropertySerializer(prop, context={"user": request.user}).data)

    def patch(self, request, pk):
        prop = services.get_property_or_404(pk, request.user)
        prop = services.update_property(prop=prop, user=request.user, data=request.data)
        return Response(PropertySerializer(prop, context={"user": request.user}).data)


class UnitListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, property_pk):
        prop = services.get_property_or_404(property_pk, request.user)
        services.assert_can_manage(prop, request.user)
        units = _unit_queryset().filter(property=prop, is_active=True)
        return Response(UnitSerializer(units, many=True, context={"user": request.user}).data)

    def post(self, request, property_pk):
        prop = services.get_property_or_404(property_pk, request.user)
        unit = services.add_unit(prop=prop, user=request.user, data=request.data)
        return Response(
            UnitDetailSerializer(unit, context={"user": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class UnitDetailView(APIView):
    """GET/PATCH /units/<id>/ — one rentable space.

    There was no way to read a single space, which is why both clients rebuilt
    one by filtering the property's list. That works until a space is archived
    or the list is paginated, and then the detail screen silently shows nothing.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        return Response(UnitDetailSerializer(unit, context={"user": request.user}).data)

    def patch(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        payload = UpdateUnitSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)

        # Reclassifying is its own act with its own rules, so it is applied by
        # its own service even though it arrives on the same request.
        space_type = data.pop("space_type", None)
        if space_type is not None:
            unit = spaces.change_space_type(unit=unit, user=request.user, space_type=space_type)
        if data:
            unit = spaces.update_space(unit=unit, user=request.user, data=data)
        return Response(UnitDetailSerializer(unit, context={"user": request.user}).data)


class UnitAccessCodeRotateView(APIView):
    """POST /units/:id/access-code/rotate — show a new raw code exactly once."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        unit, raw = access_codes.rotate(unit=unit, actor=request.user)
        data = access_codes.snapshot(unit)
        data["code"] = raw
        return Response(data, status=status.HTTP_201_CREATED)


class UnitAccessCodeRevokeView(APIView):
    """POST /units/:id/access-code/revoke — invalidate it immediately."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    @idempotent_mutation(resource_type="unit")
    def post(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        unit = access_codes.revoke(
            unit=unit,
            actor=request.user,
            reason=str(request.data.get("reason", "provider_revoked"))[:200],
        )
        return Response(access_codes.snapshot(unit))


class UnitMediaView(APIView):
    """GET/POST /units/<id>/photos/ — the space's own photographs.

    The same photographs the check is decided on and the listing shows. One
    upload, two consequences — see `spaces.attach_photo`.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        return Response(
            {
                "capacity": spaces.photo_capacity(unit),
                "photos": UnitMediaSerializer(
                    unit.media.select_related("file"), many=True, context={"request": request}
                ).data,
            }
        )

    def post(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        payload = AttachUnitPhotoSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        file = StoredFile.objects.filter(id=data["file_id"]).first()
        if file is None:
            raise NotFound("We could not find that upload.")

        media = spaces.attach_photo(
            unit=unit,
            user=request.user,
            file=file,
            slot_key=data.get("slot_key", ""),
            caption=data.get("caption", ""),
            make_primary=data.get("is_primary"),
        )
        return Response(
            UnitMediaSerializer(media, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class UnitMediaItemView(APIView):
    """DELETE/PATCH /units/<id>/photos/<media_id>/ — remove one, or make it first.

    `PATCH` rather than `POST`: making a photo the primary one changes a field on
    a row that already exists. It also collided with the collection's `POST` in
    the generated schema, which produced two operations with one id.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def patch(self, request, pk, media_pk):
        unit = spaces.get_space_or_404(pk, request.user)
        media = spaces.set_primary_photo(unit=unit, user=request.user, media_id=media_pk)
        return Response(UnitMediaSerializer(media, context={"request": request}).data)

    def delete(self, request, pk, media_pk):
        unit = spaces.get_space_or_404(pk, request.user)
        spaces.remove_photo(unit=unit, user=request.user, media_id=media_pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UnitAmenityView(APIView):
    """GET/PUT /units/<id>/amenities/ — what this space has.

    PUT rather than POST/DELETE: the screen is a checklist, and sending the
    whole set is one request that either lands or does not.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        chosen = unit.unit_amenities.filter(removed_at__isnull=True).select_related("amenity")
        return Response(
            {
                "options": AmenityOptionSerializer(
                    spaces.available_amenities(scope=AmenityScope.UNIT, space_type=unit.space_type),
                    many=True,
                ).data,
                "chosen": UnitAmenitySerializer(chosen, many=True).data,
            }
        )

    def put(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        payload = SetAmenitiesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        rows = spaces.set_space_amenities(
            unit=unit,
            user=request.user,
            amenity_ids=payload.validated_data["amenity_ids"],
            notes=payload.validated_data.get("notes"),
        )
        return Response(UnitAmenitySerializer(rows, many=True).data)


class PropertyAmenityView(APIView):
    """GET/PUT /properties/<id>/amenities/ — what the compound has."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, pk):
        prop = services.get_property_or_404(pk, request.user)
        services.assert_can_manage(prop, request.user)
        chosen = prop.property_amenities.filter(removed_at__isnull=True).select_related("amenity")
        return Response(
            {
                "options": AmenityOptionSerializer(
                    spaces.available_amenities(scope=AmenityScope.PROPERTY), many=True
                ).data,
                "chosen": PropertyAmenitySerializer(chosen, many=True).data,
                # Zero selected amenities is meaningful only after the provider
                # has explicitly saved that answer during setup.
                "confirmed": prop.amenities_confirmed_at is not None,
            }
        )

    def put(self, request, pk):
        prop = services.get_property_or_404(pk, request.user)
        payload = SetAmenitiesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        rows = spaces.set_property_amenities(
            prop=prop,
            user=request.user,
            amenity_ids=payload.validated_data["amenity_ids"],
            notes=payload.validated_data.get("notes"),
        )
        return Response(PropertyAmenitySerializer(rows, many=True).data)


class AmenityOptionsView(APIView):
    """GET /amenity-options/?scope=unit&space_type=room

    Served rather than hardcoded in each client for the same reason
    `/property-types/` is: three copies of a list means the backend's is the only
    one enforced and the other two drift from it at different rates.

    Public, because it is the product's vocabulary rather than anybody's data —
    and the signed-out listing filter needs it.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        scope = request.query_params.get("scope", "")
        space_type = request.query_params.get("space_type", "")
        return Response(
            {
                "amenities": AmenityOptionSerializer(
                    spaces.available_amenities(scope=scope, space_type=space_type), many=True
                ).data
            }
        )


class SpaceRecheckView(APIView):
    """POST /units/<id>/verification/recheck/ — reopen an approved space.

    Kept off the verification endpoint's POST, which submits. Reopening is the
    opposite act with the opposite consequence — it takes a check away — and the
    two sharing a verb is how somebody withdraws a listing while meaning to send
    one.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    @idempotent_mutation(resource_type="unit")
    def post(self, request, pk):
        unit = spaces.get_space_or_404(pk, request.user)
        spaces.request_recheck(
            unit=unit, user=request.user, reason=str(request.data.get("reason", ""))
        )
        return Response(UnitDetailSerializer(unit, context={"user": request.user}).data)


class PropertyMediaView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, property_pk):
        prop = services.get_property_or_404(property_pk, request.user)
        services.assert_can_manage(prop, request.user)
        return Response(
            PropertyMediaSerializer(prop.media.all(), many=True, context={"request": request}).data
        )

    def post(self, request, property_pk):
        prop = services.get_property_or_404(property_pk, request.user)
        file_id = request.data.get("file_id")
        file = StoredFile.objects.filter(id=file_id).first()
        if file is None:
            raise NotFound("We could not find that file.")
        media = services.attach_media(
            prop=prop,
            user=request.user,
            file=file,
            kind=request.data.get("kind", "exterior"),
            caption=request.data.get("caption", ""),
            sort_order=int(request.data.get("sort_order", 0)),
        )
        return Response(
            PropertyMediaSerializer(media, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class BedListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request, unit_pk):
        from .space_rules import is_hostel_room

        unit = Unit.objects.select_related("property").filter(id=unit_pk).first()
        if unit is None:
            raise NotFound("We could not find that unit.")
        services.assert_can_manage(unit.property, request.user)
        if not is_hostel_room(unit):
            return Response([])
        return Response(BedSerializer(unit.beds.filter(is_active=True), many=True).data)

    def post(self, request, unit_pk):
        unit = Unit.objects.select_related("property").filter(id=unit_pk).first()
        if unit is None:
            raise NotFound("We could not find that unit.")
        bed = services.add_bed(unit=unit, user=request.user, data=request.data)
        return Response(BedSerializer(bed).data, status=status.HTTP_201_CREATED)


class PropertyWithdrawView(APIView):
    """POST /properties/<id>/verification/withdraw/ — take the whole thing back.

    A property submission is two reviews sent together, so taking it back is two
    withdrawals — the photographs out of the condition queue, the claim out of
    the authority queue. Doing one and not the other would leave the provider
    told they had withdrawn while a reviewer still held half of it.

    Either half may already be settled or absent; each is withdrawn only if it
    is genuinely outstanding, and the call succeeds as long as at least one was.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    @idempotent_mutation(resource_type="property_verification_submission")
    def post(self, request, pk):
        from apps.core.exceptions import Conflict
        from apps.core.policy import enforce
        from apps.trust import condition

        from .models import PropertyProviderApplication, ProviderApplicationStatus
        from .policies import can_withdraw_property_submission

        prop = services.get_property_or_404(pk, request.user)
        services.assert_can_manage(prop, request.user)
        enforce(
            can_withdraw_property_submission(actor=request.user, target=prop),
            confirmed=True,
        )

        reason = str(request.data.get("reason", ""))
        taken_back = []

        application = (
            PropertyProviderApplication.objects.filter(
                property=prop,
                status__in=[
                    ProviderApplicationStatus.PENDING_REVIEW,
                    ProviderApplicationStatus.NEEDS_MORE,
                ],
            )
            .order_by("-created_at")
            .first()
        )
        if application is not None:
            services.withdraw_provider_application(
                application=application, user=request.user, reason=reason
            )
            taken_back.append("document")

        try:
            condition.withdraw_submission(subject=prop, actor=request.user, reason=reason)
            taken_back.append("photographs")
        except Conflict:
            # Nothing queued on this half. Only a problem if the other half had
            # nothing either, which the policy above has already ruled out.
            pass

        return Response(
            {
                **PropertySerializer(prop, context={"user": request.user}).data,
                "withdrew": taken_back,
            }
        )
