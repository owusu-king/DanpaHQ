from __future__ import annotations

from datetime import timedelta
from typing import ClassVar

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction, AuditLog
from apps.audit.services import record
from apps.core.context import get_context
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, RateLimited
from apps.core.phone import mask
from apps.core.throttling import count_attempt
from apps.idempotency.services import idempotent_mutation

from . import services
from .authentication import (
    ManagementSessionAuthentication,
    clear_management_cookies,
    csrf_token_for,
    set_management_cookies,
)
from .models import CaseStatus, ManagementReport, SupportCase
from .permissions import Capability, HasManagementCapability
from .serializers import (
    ArtisanSuspensionSerializer,
    CaseUpdateSerializer,
    ConfigurationUpdatesSerializer,
    DecisionSerializer,
    DeviceRestoreSerializer,
    LoginSerializer,
    ModerationSerializer,
    MySupportCreateSerializer,
    PasswordChangeSerializer,
    ReconciliationDecisionSerializer,
    ReportCreateSerializer,
    SupportCreateSerializer,
    SupportReplySerializer,
    UserStatusSerializer,
)


def _iso(value):
    return value.isoformat() if value else None


def _bounded_limit(request, default=50, maximum=100):
    try:
        return min(max(int(request.query_params.get("limit", default)), 1), maximum)
    except (TypeError, ValueError):
        return default


def _client_ip(request):
    return get_context().ip_address


class ManagementAPIView(APIView):
    authentication_classes: ClassVar[list] = [ManagementSessionAuthentication]
    permission_classes: ClassVar[list] = [IsAuthenticated, HasManagementCapability]


class LoginView(APIView):
    authentication_classes: ClassVar[list] = []
    permission_classes: ClassVar[list] = [AllowAny]

    def post(self, request):
        origin = request.headers.get("Origin")
        if origin and origin not in settings.CORS_ALLOWED_ORIGINS:
            raise PermissionDenied("This Management sign-in origin is not allowed.")

        # Twenty attempts in fifteen minutes, per address. Counted through
        # `core.throttling` rather than here: read-modify-write over the cache
        # let simultaneous attempts all read the same number and never close the
        # cap, and an unreachable cache made this password form answer 500 —
        # where it now answers "not right now", which is the honest thing for a
        # limiter that cannot count to say on a credential surface.
        ip = _client_ip(request) or "unknown"
        attempts = count_attempt(f"management-login:{ip}", window=15 * 60, scope="management_login")
        if attempts > 20:
            raise RateLimited("Too many Management sign-in attempts. Try again later.")

        payload = LoginSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        session, raw_session, raw_csrf = services.authenticate_management(
            email=payload.validated_data["email"],
            password=payload.validated_data["password"],
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent", ""),
        )
        response = Response(
            {"user": services.management_payload(session.user), "csrf_token": raw_csrf}
        )
        set_management_cookies(response, session_token=raw_session, csrf_token=raw_csrf)
        return response


class SessionView(ManagementAPIView):
    required_capability = Capability.MANAGE_PROFILE

    def get(self, request):
        return Response(
            {
                "user": services.management_payload(request.user),
                "csrf_token": csrf_token_for(request.auth),
            }
        )

    def delete(self, request):
        services.revoke_session(session=request.management_session, reason="signed_out")
        record(
            action=AuditAction.UPDATE,
            aggregate_type="management_user",
            aggregate_id=request.user.id,
            management_actor=request.user,
            metadata={"action": "signed_out"},
        )
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_management_cookies(response)
        return response


class ProfileView(ManagementAPIView):
    required_capability = Capability.MANAGE_PROFILE

    def patch(self, request):
        allowed = {"first_name", "last_name"}
        changes = {}
        for field in allowed:
            if field in request.data:
                value = str(request.data[field]).strip()[:80]
                changes[field] = [getattr(request.user, field), value]
                setattr(request.user, field, value)
        if changes:
            request.user.save(update_fields=[*changes.keys(), "updated_at"])
            record(
                action=AuditAction.UPDATE,
                aggregate_type="management_user",
                aggregate_id=request.user.id,
                management_actor=request.user,
                changes=changes,
            )
        return Response({"user": services.management_payload(request.user)})


class PasswordView(ManagementAPIView):
    required_capability = Capability.MANAGE_PROFILE

    def post(self, request):
        payload = PasswordChangeSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.change_password(user=request.user, **payload.validated_data)
        response = Response(
            {"message": "Password changed. Sign in again on this and every other device."}
        )
        clear_management_cookies(response)
        return response


class DashboardView(ManagementAPIView):
    required_capability = Capability.VIEW_DASHBOARD

    def get(self, request):
        from apps.application.models import OPEN_STATUSES as OPEN_APPLICATIONS
        from apps.application.models import RentalApplication
        from apps.identity.models import User
        from apps.lease.models import Lease, LeaseStatus
        from apps.listing.models import Listing, ListingStatus
        from apps.trust.models import ReviewQueueEntry

        queue_entries = list(
            ReviewQueueEntry.objects.filter(resolved_at__isnull=True).select_related("verification")
        )
        pending_groups = {_review_subject(entry.verification)[0] for entry in queue_entries}

        return Response(
            {
                "counts": {
                    "users": User.objects.filter(is_superuser=False).count(),
                    # A property submission contains document and photo checks,
                    # but it is one operational decision and therefore one
                    # dashboard item.
                    "pending_verifications": len(pending_groups),
                    "pending_listings": Listing.objects.filter(
                        status=ListingStatus.PENDING_REVIEW
                    ).count(),
                    "open_reports": ManagementReport.objects.filter(
                        status__in=[CaseStatus.OPEN, CaseStatus.IN_REVIEW]
                    ).count(),
                    "open_support_cases": SupportCase.objects.filter(
                        status__in=[CaseStatus.OPEN, CaseStatus.IN_REVIEW]
                    ).count(),
                    "open_applications": RentalApplication.objects.filter(
                        status__in=OPEN_APPLICATIONS
                    ).count(),
                    "active_leases": Lease.objects.filter(status=LeaseStatus.ACTIVE).count(),
                },
                "role": request.user.role,
            }
        )


def _user_row(user):
    return {
        "id": str(user.id),
        "display_name": user.display_name,
        "phone": mask(user.phone),
        "email": user.email or "",
        "roles": sorted(user.roles),
        "is_phone_verified": user.is_phone_verified,
        "is_active": user.is_active,
        "onboarding_complete": user.onboarding_completed_at is not None,
        "created_at": _iso(user.created_at),
        "last_seen_at": _iso(user.last_seen_at),
    }


class UsersView(ManagementAPIView):
    required_capability = Capability.VIEW_USERS

    def get(self, request):
        from apps.identity.models import User

        rows = User.objects.filter(is_superuser=False).prefetch_related("role_assignments")
        query = request.query_params.get("q", "").strip()
        if query:
            rows = rows.filter(
                Q(first_name__icontains=query)
                | Q(last_name__icontains=query)
                | Q(preferred_name__icontains=query)
                | Q(phone__icontains=query)
                | Q(email__icontains=query)
            )
        role = request.query_params.get("role", "").strip()
        if role:
            rows = rows.filter(
                role_assignments__role=role, role_assignments__revoked_at__isnull=True
            )
        active = request.query_params.get("active")
        if active in {"true", "false"}:
            rows = rows.filter(is_active=active == "true")
        rows = rows.distinct().order_by("-created_at")[: _bounded_limit(request)]
        return Response({"results": [_user_row(user) for user in rows]})


class UserStatusView(ManagementAPIView):
    required_capability = Capability.MANAGE_USERS

    def post(self, request, pk):
        from apps.identity.models import Session, User

        user = User.objects.filter(id=pk, is_superuser=False, is_staff=False).first()
        if user is None:
            raise NotFound("We could not find that consumer account.")
        payload = UserStatusSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        active = payload.validated_data["active"]
        reason = payload.validated_data.get("reason", "").strip()
        previous = user.is_active
        user.is_active = active
        user.deactivated_at = None if active else timezone.now()
        user.save(update_fields=["is_active", "deactivated_at", "updated_at"])
        if not active:
            now = timezone.now()
            Session.objects.filter(user=user, revoked_at__isnull=True).update(
                revoked_at=now, revoked_reason="management_deactivated"
            )
        record(
            action=AuditAction.PERMISSION_CHANGE,
            aggregate_type="user",
            aggregate_id=user.id,
            management_actor=request.user,
            changes={"is_active": [previous, active]},
            metadata={"reason": reason},
        )
        return Response(_user_row(user))


class UserDevicesView(ManagementAPIView):
    """Every installation on an account, including the ones that cannot sign in.

    Support's half of the device story. The consumer list deliberately hides
    removed and blocked rows — but when somebody calls because their phone is
    refused, this is the screen that says which one and why.
    """

    required_capability = Capability.VIEW_USERS

    def get(self, request, pk):
        from apps.identity.models import Device, User

        user = User.objects.filter(id=pk, is_superuser=False, is_staff=False).first()
        if user is None:
            raise NotFound("We could not find that consumer account.")
        devices = Device.objects.filter(user=user).order_by("-last_seen_at")
        return Response(
            [
                {
                    "id": str(device.id),
                    "label": device.label,
                    "platform": device.platform,
                    "os_version": device.os_version,
                    "app_version": device.app_version,
                    "first_seen_at": device.first_seen_at,
                    "last_seen_at": device.last_seen_at,
                    "state": (
                        "blocked"
                        if device.is_blocked
                        else "removed"
                        if device.is_removed
                        else "active"
                    ),
                    "blocked_at": device.blocked_at,
                    "blocked_reason": device.blocked_reason,
                }
                for device in devices
            ]
        )


class UserDeviceRestoreView(ManagementAPIView):
    """Lift a device block. The route back that did not exist.

    `blocked_at` used to be set in one place and cleared in none, so the refusal
    message's "Contact support" resolved to somebody editing the row by hand in
    Django admin. Restoring leaves the device signed out, not trusted: it has to
    sign in again, which sends the unfamiliar-device alert to the account's own
    number.
    """

    required_capability = Capability.MANAGE_USERS

    def post(self, request, pk, device_id):
        from apps.identity import services as identity_services
        from apps.identity.models import Device, User

        user = User.objects.filter(id=pk, is_superuser=False, is_staff=False).first()
        if user is None:
            raise NotFound("We could not find that consumer account.")
        device = Device.objects.filter(user=user, id=device_id).first()
        if device is None:
            raise NotFound("That device is not on this account.")
        if not device.is_blocked:
            raise Conflict("That device is not blocked.")

        payload = DeviceRestoreSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        identity_services.restore_device(
            device=device,
            management_actor=request.user,
            reason=payload.validated_data["reason"].strip(),
        )
        return Response({"id": str(device.id), "state": "removed"})


class ArtisansView(ManagementAPIView):
    """Every artisan application and where it stands.

    Deciding an application happens in the verification queue, beside provider
    standing; this is the list Management suspends and reinstates from.
    """

    required_capability = Capability.VIEW_USERS

    def get(self, request):
        from apps.artisan.services import management_rows

        state = request.query_params.get("status", "").strip()
        return Response(management_rows(status=state, limit=_bounded_limit(request)))


class ArtisanSuspensionView(ManagementAPIView):
    """POST /management/artisans/<user id>/suspension/ — pause or reinstate.

    Suspending needs a reason the artisan will read. It stops new quotes and new
    assignments at once and keeps every existing record.
    """

    required_capability = Capability.MANAGE_USERS

    def post(self, request, pk):
        from apps.artisan import services as artisan_services

        payload = ArtisanSuspensionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        if payload.validated_data["suspended"]:
            artisan_services.suspend(
                user_id=pk,
                management_actor=request.user,
                reason=payload.validated_data.get("reason", ""),
            )
        else:
            artisan_services.reinstate(user_id=pk, management_actor=request.user)
        return Response(artisan_services.management_row_for(user_id=pk))


class ProvidersView(ManagementAPIView):
    """Read-only property verification submission history.

    The claimant's account standing remains useful context, but the property
    column reports the package's single verification result rather than the
    authority check's internal approval status.
    """

    required_capability = Capability.VIEW_PROPERTIES

    def get(self, request):
        from apps.property.models import PropertyProviderApplication
        from apps.property.verification import lifecycle as property_lifecycle
        from apps.trust.models import (
            SubjectType,
            Verification,
            VerificationKind,
            VerificationStatus,
        )

        rows = PropertyProviderApplication.objects.select_related(
            "applicant", "address__locality__district__region", "property"
        )
        state = request.query_params.get("status", "").strip()
        if state:
            rows = rows.filter(status=state)
        rows = list(rows[: _bounded_limit(request)])

        # One query for every applicant on the page rather than one per row.
        standing_by_user: dict[str, str] = {}
        applicant_ids = {str(item.applicant_id) for item in rows}
        if applicant_ids:
            for check in (
                Verification.objects.filter(
                    subject_type=SubjectType.USER,
                    subject_id__in=applicant_ids,
                    kind=VerificationKind.PROVIDER,
                )
                .exclude(status=VerificationStatus.SUPERSEDED)
                .order_by("subject_id", "-created_at")
            ):
                standing_by_user.setdefault(check.subject_id, check.status)

        results = []
        for item in rows:
            results.append(
                {
                    "id": str(item.id),
                    "applicant_id": str(item.applicant_id),
                    "applicant": item.applicant.display_name,
                    "phone": mask(item.applicant.phone),
                    # The account-level decision, alongside the property one.
                    "provider_standing": standing_by_user.get(
                        str(item.applicant_id), "not_started"
                    ),
                    "relationship": item.relationship_type,
                    "title": item.title,
                    "property_type": item.property_type,
                    "locality": item.address.locality_label,
                    "region": item.address.region_label,
                    "status": (
                        property_lifecycle(item.property)["review_state"]
                        if item.property_id
                        else item.status
                    ),
                    "verification_id": str(item.authority_verification_id or ""),
                    "decision_note": item.decision_note,
                    "submitted_at": _iso(item.submitted_at),
                    "reviewed_at": _iso(item.reviewed_at),
                }
            )
        return Response({"results": results})


def _review_subject(verification) -> tuple[str, str, str]:
    """What a verification is *about*, for grouping.

    Two evidence checks arrive for one property and are keyed differently: the
    condition check is filed against the property, the authority document
    against its submission envelope. They form one operational decision.

    Returns a stable key and a human label. Anything that is not property work
    groups as itself, so one shape covers the whole queue.
    """
    if verification.subject_type == "property":
        from apps.property.models import Property, PropertyProviderApplication

        prop = Property.all_objects.filter(id=verification.subject_id).first()
        if prop is not None:
            application = PropertyProviderApplication.objects.filter(property=prop).first()
            return (
                f"property:{prop.id}",
                prop.title,
                str(application.id) if application is not None else "",
            )

    if verification.subject_type == "provider_application":
        from apps.property.models import PropertyProviderApplication

        application = (
            PropertyProviderApplication.objects.select_related("property")
            .filter(id=verification.subject_id)
            .first()
        )
        # An application that names no property yet is its own group; there is
        # no building to gather it under.
        if application is not None and application.property_id:
            return (
                f"property:{application.property_id}",
                application.property.title if application.property else application.title,
                str(application.id),
            )

    return f"{verification.subject_type}:{verification.subject_id}", "", ""


class VerificationQueueView(ManagementAPIView):
    required_capability = Capability.VIEW_VERIFICATIONS

    def get(self, request):
        from apps.trust.models import ReviewQueueEntry
        from apps.trust.serializers import ReviewerVerificationSerializer

        rows = (
            ReviewQueueEntry.objects.filter(resolved_at__isnull=True)
            .select_related("verification")
            .prefetch_related("verification__evidence__file")
            .order_by("priority", "created_at")
        )

        groups: dict[str, dict] = {}
        for entry in rows[: _bounded_limit(request)]:
            key, label, submission_id = _review_subject(entry.verification)
            item = {
                "id": str(entry.id),
                "priority": entry.priority,
                "created_at": _iso(entry.created_at),
                "claimed_by_management_id": str(entry.claimed_by_management_id or ""),
                "claimed_at": _iso(entry.claimed_at),
                "verification": ReviewerVerificationSerializer(entry.verification).data,
            }

            group = groups.setdefault(
                key,
                {
                    "key": key,
                    "label": label,
                    # The most urgent thing in the group decides where it sits,
                    # so gathering two items never buries the pressing one.
                    "priority": entry.priority,
                    "created_at": item["created_at"],
                    "items": [],
                    "submission_id": submission_id,
                },
            )
            group["items"].append(item)
            group["priority"] = min(group["priority"], entry.priority)
            group["created_at"] = min(group["created_at"], item["created_at"])
            if not group["label"] and label:
                group["label"] = label
            if not group["submission_id"] and submission_id:
                group["submission_id"] = submission_id

        ordered = sorted(groups.values(), key=lambda g: (g["priority"], g["created_at"]))

        return Response(
            {
                "results": ordered,
                # The flat list stays for one release: a client written against
                # it keeps working while it moves to groups.
                "items": [item for group in ordered for item in group["items"]],
            }
        )


class VerificationClaimView(ManagementAPIView):
    required_capability = Capability.DECIDE_VERIFICATIONS

    @transaction.atomic
    def post(self, request, pk):
        from apps.trust.models import ReviewQueueEntry

        entry = (
            ReviewQueueEntry.objects.select_for_update()
            .filter(id=pk, resolved_at__isnull=True)
            .first()
        )
        if entry is None:
            raise NotFound("That review item does not exist.")
        now = timezone.now()
        if (
            entry.claimed_by_management_id
            and entry.claimed_by_management_id != request.user.id
            and entry.claim_expires_at
            and entry.claim_expires_at > now
        ):
            raise Conflict("Another Operations Admin is already reviewing this item.")
        entry.claimed_by = None
        entry.claimed_by_management_id = request.user.id
        entry.claimed_at = now
        entry.claim_expires_at = now + timedelta(minutes=30)
        entry.save(
            update_fields=[
                "claimed_by",
                "claimed_by_management_id",
                "claimed_at",
                "claim_expires_at",
            ]
        )
        return Response({"id": str(entry.id), "claimed_at": _iso(entry.claimed_at)})


class VerificationDecisionView(ManagementAPIView):
    required_capability = Capability.DECIDE_VERIFICATIONS

    @idempotent_mutation(resource_type="verification")
    def post(self, request, pk):
        from apps.trust import services as trust_services
        from apps.trust.models import Verification
        from apps.trust.serializers import ReviewerVerificationSerializer

        verification = Verification.objects.filter(id=pk).first()
        if verification is None:
            raise NotFound("We could not find that verification.")
        payload = DecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        from apps.property.services import (
            decide_property_verification,
            property_submission_for_verification,
        )

        application = property_submission_for_verification(verification)
        if (
            application is not None
            and application.property_id
            and application.condition_verification_id
        ):
            # Compatibility for management clients loaded before the package
            # endpoint was introduced. A request naming either evidence check
            # still decides the complete property submission atomically.
            decide_property_verification(
                application=application,
                management_actor=request.user,
                **payload.validated_data,
            )
            verification.refresh_from_db()
            return Response(ReviewerVerificationSerializer(verification).data)
        verification = trust_services.decide(
            verification,
            management_actor=request.user,
            **payload.validated_data,
        )
        return Response(ReviewerVerificationSerializer(verification).data)


class VerificationMoreInfoView(ManagementAPIView):
    required_capability = Capability.DECIDE_VERIFICATIONS

    @idempotent_mutation(resource_type="verification")
    def post(self, request, pk):
        from apps.trust import services as trust_services
        from apps.trust.models import Verification

        verification = Verification.objects.filter(id=pk).first()
        if verification is None:
            raise NotFound("We could not find that verification.")
        from apps.property.services import (
            property_submission_for_verification,
            request_property_verification_more_information,
        )

        application = property_submission_for_verification(verification)
        if (
            application is not None
            and application.property_id
            and application.condition_verification_id
        ):
            request_property_verification_more_information(
                application=application,
                management_actor=request.user,
                note=str(request.data.get("note", "")).strip(),
            )
            verification.refresh_from_db()
            return Response({"id": str(verification.id), "status": verification.status})
        verification = trust_services.request_more_information(
            verification,
            note=str(request.data.get("note", "")).strip(),
            management_actor=request.user,
        )
        return Response({"id": str(verification.id), "status": verification.status})


class PropertyVerificationDecisionView(ManagementAPIView):
    """Record the one final decision for a property's complete package."""

    required_capability = Capability.DECIDE_VERIFICATIONS

    @idempotent_mutation(
        resource_type="property_verification_submission",
        resource_id_path=("submission_id",),
    )
    def post(self, request, pk):
        from apps.property.models import PropertyProviderApplication
        from apps.property.services import decide_property_verification
        from apps.property.verification import lifecycle

        application = (
            PropertyProviderApplication.objects.select_related("property").filter(id=pk).first()
        )
        if application is None or application.property is None:
            raise NotFound("We could not find that property verification submission.")
        payload = DecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        application = decide_property_verification(
            application=application,
            management_actor=request.user,
            **payload.validated_data,
        )
        return Response(
            {
                "submission_id": str(application.id),
                "property_id": str(application.property_id),
                "verification": lifecycle(application.property),
            }
        )


class PropertyVerificationMoreInfoView(ManagementAPIView):
    """Return the whole package for changes without splitting its outcome."""

    required_capability = Capability.DECIDE_VERIFICATIONS

    @idempotent_mutation(
        resource_type="property_verification_submission",
        resource_id_path=("submission_id",),
    )
    def post(self, request, pk):
        from apps.property.models import PropertyProviderApplication
        from apps.property.services import request_property_verification_more_information
        from apps.property.verification import lifecycle

        application = (
            PropertyProviderApplication.objects.select_related("property").filter(id=pk).first()
        )
        if application is None or application.property is None:
            raise NotFound("We could not find that property verification submission.")
        application = request_property_verification_more_information(
            application=application,
            management_actor=request.user,
            note=str(request.data.get("note", "")).strip(),
        )
        return Response(
            {
                "submission_id": str(application.id),
                "property_id": str(application.property_id),
                "verification": lifecycle(application.property),
            }
        )


class VerificationEvidenceView(ManagementAPIView):
    required_capability = Capability.VIEW_VERIFICATIONS

    def get(self, request, pk, evidence_pk):
        from apps.files.storage import get_storage
        from apps.trust.models import VerificationEvidence

        evidence = (
            VerificationEvidence.objects.select_related("file")
            .filter(id=evidence_pk, verification_id=pk)
            .first()
        )
        if evidence is None or evidence.file is None or not evidence.file.is_usable:
            raise NotFound("That verification evidence is not available.")
        url = (
            get_storage()
            .presign_download(
                key=evidence.file.storage_key,
                expires_in=180,
                filename=evidence.file.original_filename,
            )
            .url
        )
        record(
            action=AuditAction.VIEW,
            aggregate_type="verification_evidence",
            aggregate_id=evidence.id,
            management_actor=request.user,
            metadata={"verification_id": str(pk)},
        )
        return Response({"download_url": url, "expires_in": 180})


class PropertiesView(ManagementAPIView):
    required_capability = Capability.VIEW_PROPERTIES

    def get(self, request):
        from apps.property.models import Property

        rows = Property.objects.select_related(
            "owner", "created_by", "address__locality__district__region"
        ).prefetch_related("relationships__user")
        query = request.query_params.get("q", "").strip()
        if query:
            rows = rows.filter(
                Q(title__icontains=query)
                | Q(address__locality__name__icontains=query)
                | Q(address__place_name__icontains=query)
                | Q(address__place_context__icontains=query)
                | Q(owner__first_name__icontains=query)
                | Q(owner__last_name__icontains=query)
            )
        results = [_property_row(item) for item in rows[: _bounded_limit(request)]]
        return Response({"results": results})


def _property_row(item) -> dict:
    """One property, for the operations list.

    `Property.owner` is the legacy individual-owner shortcut and is nullable —
    its own help text says organization authority is canonical. Every property
    created through the private or claim flow has it null, so reading
    `item.owner.display_name` was not an edge case: it was the normal case, and
    it made this whole page a 500 as soon as one such property existed.

    Who holds a property is a live `PropertyRelationship`, so that is what is
    shown, falling back to the legacy field and then to saying plainly that
    nobody is recorded. An operations list that omits a property because its
    owner column is empty is worse than one that says so.
    """
    holder = next((rel for rel in item.relationships.all() if rel.ended_at is None), None)

    # Three answers, weakest last, and the row says which one it is giving.
    #
    # A reviewed relationship is authority: somebody produced a deed or an
    # authorisation letter and a reviewer accepted it. The legacy `owner` field
    # is the same claim from before relationships existed. `created_by` is not
    # authority at all — it is whoever set the property up — but it is the fact
    # a reviewer most needs, and reporting "Not recorded" while knowing it made
    # the column useless on every property created through the private flow,
    # which is now most of them.
    person = (holder.user if holder else None) or item.owner
    attachment = holder.relationship_type if holder else ("owner" if item.owner_id else "")

    if person is None and item.created_by_id:
        person = item.created_by
        attachment = "claimed_unverified"

    address = getattr(item, "address", None)

    return {
        "id": str(item.id),
        "title": item.title,
        "property_type": item.property_type,
        "owner": person.display_name if person else "Nobody attached",
        "owner_phone": mask(person.phone) if person else "",
        #: How the person above is attached. `claimed_unverified` means they
        #: created the property and no authority review has confirmed it — the
        #: distinction a reviewer is looking at this list to make.
        "relationship": attachment,
        "authority_verified": bool(holder),
        "locality": address.locality_label if address else "",
        "region": address.region_label if address else "",
        "relationship_count": sum(1 for rel in item.relationships.all() if rel.ended_at is None),
        "created_at": _iso(item.created_at),
    }


def _listing_row(item):
    return {
        "id": str(item.id),
        "headline": item.headline,
        "status": item.status,
        "rent_minor": item.rent_minor,
        "rent_currency": item.rent_currency,
        "provider": item.created_by.display_name,
        "provider_phone": mask(item.created_by.phone),
        "property": item.unit.property.title,
        "locality": item.unit.property.address.locality_label,
        "review_note": item.review_note,
        "created_at": _iso(item.created_at),
        "reviewed_at": _iso(item.reviewed_at),
    }


class ListingsView(ManagementAPIView):
    required_capability = Capability.VIEW_PROPERTIES

    def get(self, request):
        from apps.listing.models import Listing

        rows = Listing.objects.select_related("created_by", "unit__property__address__locality")
        state = request.query_params.get("status", "").strip()
        if state:
            rows = rows.filter(status=state)
        return Response(
            {"results": [_listing_row(item) for item in rows[: _bounded_limit(request)]]}
        )


class ListingModerationView(ManagementAPIView):
    required_capability = Capability.MODERATE_LISTINGS

    def post(self, request, pk):
        from apps.listing.models import Listing
        from apps.listing.services import moderate_listing

        listing = (
            Listing.objects.select_related("created_by", "unit__property__address__locality")
            .filter(id=pk)
            .first()
        )
        if listing is None:
            raise NotFound("We could not find that listing.")
        payload = ModerationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        listing = moderate_listing(
            listing=listing, management_actor=request.user, **payload.validated_data
        )
        return Response(_listing_row(listing))


def _report_row(item):
    return {
        "id": str(item.id),
        "subject_type": item.subject_type,
        "subject_id": item.subject_id,
        "category": item.category,
        "summary": item.summary,
        "details": item.details,
        "priority": item.priority,
        "status": item.status,
        "reported_by": item.reported_by.display_name if item.reported_by else "",
        "assigned_to": item.assigned_to.display_name if item.assigned_to else "",
        "resolution_note": item.resolution_note,
        "created_at": _iso(item.created_at),
        "resolved_at": _iso(item.resolved_at),
    }


class ReportsView(ManagementAPIView):
    required_capability = Capability.VIEW_REPORTS

    def get(self, request):
        rows = ManagementReport.objects.select_related("reported_by", "assigned_to")
        state = request.query_params.get("status", "").strip()
        if state:
            rows = rows.filter(status=state)
        return Response(
            {"results": [_report_row(item) for item in rows[: _bounded_limit(request)]]}
        )

    def post(self, request):
        from apps.identity.models import User

        payload = ReportCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        reporter = None
        if data.get("reported_by_id"):
            reporter = User.objects.filter(id=data.pop("reported_by_id")).first()
        item = ManagementReport.objects.create(reported_by=reporter, **data)
        record(
            action=AuditAction.CREATE,
            aggregate_type="management_report",
            aggregate_id=item.id,
            management_actor=request.user,
            metadata={"subject": f"{item.subject_type}:{item.subject_id}"},
        )
        return Response(_report_row(item), status=status.HTTP_201_CREATED)


class ReportDetailView(ManagementAPIView):
    required_capability = Capability.MANAGE_REPORTS

    def patch(self, request, pk):
        item = (
            ManagementReport.objects.select_related("reported_by", "assigned_to")
            .filter(id=pk)
            .first()
        )
        if item is None:
            raise NotFound("We could not find that report.")
        payload = CaseUpdateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.update_case(case=item, actor=request.user, **payload.validated_data)
        return Response(_report_row(item))


def _support_row(item):
    messages = list(item.messages.all())
    latest = messages[-1] if messages else None
    return {
        "id": str(item.id),
        "user_id": str(item.user_id or ""),
        "user": item.user.display_name if item.user else "",
        "user_phone": mask(item.user.phone) if item.user else "",
        "category": item.category,
        "summary": item.summary,
        "details": item.details,
        "priority": item.priority,
        "status": item.status,
        "assigned_to": item.assigned_to.display_name if item.assigned_to else "",
        "related_application_id": str(item.related_application_id or ""),
        "related_lease_id": str(item.related_lease_id or ""),
        "resolution_note": item.resolution_note,
        "created_at": _iso(item.created_at),
        "resolved_at": _iso(item.resolved_at),
        "last_message": latest.body[:140] if latest else item.details[:140],
        "last_message_at": _iso(item.last_message_at or item.created_at),
        "unread": bool(
            item.last_message_at
            and (
                item.management_read_at is None
                or item.management_read_at < item.last_message_at
            )
            and latest
            and latest.sender == "user"
        ),
    }


def _support_message_row(message, *, audience: str):
    return {
        "id": str(message.id),
        "body": message.body,
        "mine": message.sender == audience,
        "author_name": message.author_label,
        "sender": message.sender,
        "created_at": _iso(message.created_at),
    }


def _support_detail(item, *, audience: str):
    row = _support_row(item)
    row["messages"] = [
        _support_message_row(message, audience=audience) for message in item.messages.all()
    ]
    if not row["messages"] and item.details:
        row["legacy_message"] = item.details
    return row


class SupportCasesView(ManagementAPIView):
    required_capability = Capability.VIEW_SUPPORT

    def get(self, request):
        rows = SupportCase.objects.select_related("user", "assigned_to").prefetch_related(
            "messages"
        )
        state = request.query_params.get("status", "").strip()
        if state:
            rows = rows.filter(status=state)
        return Response(
            {"results": [_support_row(item) for item in rows[: _bounded_limit(request)]]}
        )

    def post(self, request):
        from apps.identity.models import User

        payload = SupportCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        user = None
        if data.get("user_id"):
            user = User.objects.filter(id=data.pop("user_id"), is_superuser=False).first()
            if user is None:
                raise NotFound("We could not find that consumer account.")
        item = SupportCase.objects.create(user=user, assigned_to=request.user, **data)
        record(
            action=AuditAction.CREATE,
            aggregate_type="support_case",
            aggregate_id=item.id,
            management_actor=request.user,
            metadata={"user_id": str(item.user_id or "")},
        )
        if item.details.strip():
            services.reply_to_support_case(
                case=item, body=item.details, management_actor=request.user
            )
        return Response(_support_row(item), status=status.HTTP_201_CREATED)


class SupportCaseDetailView(ManagementAPIView):
    required_capability = Capability.MANAGE_SUPPORT

    def get(self, request, pk):
        item = (
            SupportCase.objects.select_related("user", "assigned_to")
            .prefetch_related("messages")
            .filter(id=pk)
            .first()
        )
        if item is None:
            raise NotFound("We could not find that support case.")
        services.mark_support_case_read(case=item, by_management=True)
        item.management_read_at = timezone.now()
        return Response(_support_detail(item, audience="management"))

    def patch(self, request, pk):
        item = SupportCase.objects.select_related("user", "assigned_to").filter(id=pk).first()
        if item is None:
            raise NotFound("We could not find that support case.")
        payload = CaseUpdateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.update_case(case=item, actor=request.user, **payload.validated_data)
        return Response(_support_row(item))


class SupportCaseMessageView(ManagementAPIView):
    required_capability = Capability.MANAGE_SUPPORT

    def post(self, request, pk):
        item = SupportCase.objects.filter(id=pk).first()
        if item is None:
            raise NotFound("We could not find that support case.")
        payload = SupportReplySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.reply_to_support_case(
            case=item,
            body=payload.validated_data["message"],
            management_actor=request.user,
        )
        item = (
            SupportCase.objects.select_related("user", "assigned_to")
            .prefetch_related("messages")
            .get(id=pk)
        )
        return Response(
            _support_detail(item, audience="management"), status=status.HTTP_201_CREATED
        )


class ConfigurationView(ManagementAPIView):
    required_capability = Capability.MANAGE_CONFIGURATION

    def get(self, request):
        from .configuration import payload

        return Response(payload())

    def patch(self, request):
        from .configuration import apply_updates

        payload = ConfigurationUpdatesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(
            apply_updates(updates=payload.validated_data["updates"], actor=request.user)
        )


class MySupportCasesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = (
            SupportCase.objects.filter(user=request.user)
            .select_related("assigned_to")
            .prefetch_related("messages")
            .order_by("-last_message_at", "-created_at")[:100]
        )
        result = []
        for item in rows:
            row = _support_row(item)
            latest = list(item.messages.all())[-1:] or [None]
            row["unread"] = bool(
                item.last_message_at
                and (item.user_read_at is None or item.user_read_at < item.last_message_at)
                and latest[0]
                and latest[0].sender == "management"
            )
            # Consumer responses never expose internal assignment or notes.
            for key in ("user_id", "user", "user_phone", "assigned_to", "resolution_note"):
                row.pop(key, None)
            result.append(row)
        return Response(result)

    def post(self, request):
        payload = MySupportCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        item = services.create_support_case(user=request.user, **payload.validated_data)
        item = SupportCase.objects.prefetch_related("messages").get(id=item.id)
        return Response(
            _support_detail(item, audience="user"), status=status.HTTP_201_CREATED
        )


class MySupportCaseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _case(self, request, pk):
        item = (
            SupportCase.objects.filter(id=pk, user=request.user)
            .prefetch_related("messages")
            .first()
        )
        if item is None:
            raise NotFound("We could not find that support conversation.")
        return item

    def get(self, request, pk):
        item = self._case(request, pk)
        services.mark_support_case_read(case=item, by_management=False)
        item.user_read_at = timezone.now()
        detail = _support_detail(item, audience="user")
        for key in ("user_id", "user", "user_phone", "assigned_to", "resolution_note"):
            detail.pop(key, None)
        return Response(detail)

    def post(self, request, pk):
        item = self._case(request, pk)
        payload = SupportReplySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.reply_to_support_case(
            case=item, body=payload.validated_data["message"], user=request.user
        )
        item = SupportCase.objects.prefetch_related("messages").get(id=item.id)
        detail = _support_detail(item, audience="user")
        for key in ("user_id", "user", "user_phone", "assigned_to", "resolution_note"):
            detail.pop(key, None)
        return Response(detail, status=status.HTTP_201_CREATED)


class RentalsView(ManagementAPIView):
    required_capability = Capability.VIEW_RENTALS

    def get(self, request):
        from apps.application.models import RentalApplication
        from apps.lease.models import Lease

        limit = _bounded_limit(request, default=30, maximum=50)
        applications = RentalApplication.objects.select_related(
            "tenant", "listing__unit__property"
        )[:limit]
        leases = Lease.objects.select_related("tenant", "landlord", "unit__property")[:limit]
        return Response(
            {
                "applications": [
                    {
                        "id": str(item.id),
                        "tenant": item.tenant.display_name,
                        "listing": item.listing.headline,
                        "property": item.listing.unit.property.title,
                        "status": item.status,
                        "move_in_from": item.move_in_from,
                        "created_at": _iso(item.created_at),
                    }
                    for item in applications
                ],
                "leases": [
                    {
                        "id": str(item.id),
                        "tenant": item.tenant.display_name,
                        "landlord": item.landlord.display_name,
                        "property": item.unit.property.title,
                        "status": item.status,
                        "starts_on": item.starts_on,
                        "ends_on": item.ends_on,
                        "created_at": _iso(item.created_at),
                    }
                    for item in leases
                ],
            }
        )


class PaymentOperationsView(ManagementAPIView):
    required_capability = Capability.VIEW_PAYMENTS

    def get(self, request):
        from apps.payments.operations import payment_operations_snapshot

        status_filter = request.query_params.get("status", "").strip()
        kind_filter = request.query_params.get("kind", "").strip()
        snapshot = payment_operations_snapshot(
            status=status_filter,
            kind=kind_filter,
            limit=_bounded_limit(request),
        )
        record(
            action=AuditAction.VIEW,
            aggregate_type="payment_operations",
            aggregate_id=request.user.id,
            management_actor=request.user,
            metadata={
                "status_filter": status_filter,
                "kind_filter": kind_filter,
                "exceptions_returned": len(snapshot["exceptions"]),
                "transactions_returned": len(snapshot["transactions"]),
            },
        )
        return Response(snapshot)


class ReconciliationDecisionView(ManagementAPIView):
    required_capability = Capability.RECONCILE_PAYMENTS

    @idempotent_mutation(required=True, resource_type="reconciliation_exception")
    def post(self, request, pk):
        from apps.payments.reconciliation import resolve_exception

        payload = ReconciliationDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        row = resolve_exception(
            exception_id=pk,
            management_actor=request.user,
            **payload.validated_data,
        )
        return Response({"id": str(row.id), "status": row.status})


class AuditLogsView(ManagementAPIView):
    required_capability = Capability.VIEW_AUDIT_LOGS

    def get(self, request):
        rows = AuditLog.objects.all()
        action = request.query_params.get("action", "").strip()
        if action:
            rows = rows.filter(action=action)
        aggregate_type = request.query_params.get("aggregate_type", "").strip()
        if aggregate_type:
            rows = rows.filter(aggregate_type=aggregate_type)
        results = [
            {
                "id": str(item.id),
                "action": item.action,
                "aggregate_type": item.aggregate_type,
                "aggregate_id": item.aggregate_id,
                "actor_label": item.actor_label,
                "actor_role": item.actor_role,
                "management_actor_id": str(item.management_actor_id or ""),
                "changes": item.changes,
                "metadata": item.metadata,
                "request_id": item.request_id,
                "ip_address": item.ip_address,
                "source": item.source,
                "created_at": _iso(item.created_at),
                "entry_hash": item.entry_hash,
            }
            for item in rows[: _bounded_limit(request)]
        ]
        record(
            action=AuditAction.VIEW,
            aggregate_type="audit_log",
            aggregate_id=request.user.id,
            management_actor=request.user,
            metadata={"returned": len(results)},
        )
        return Response({"results": results})


class BillingPortfoliosView(ManagementAPIView):
    """Every Portfolio with the plan it is on and what it is actually using.

    Support's first billing question is "why can't this customer add a
    property", and the answer is almost always a limit. Showing plan and live
    usage side by side answers it without anybody opening a shell.
    """

    required_capability = Capability.VIEW_BILLING

    def get(self, request):
        from apps.billing.models import LIVE_STATUSES, Subscription
        from apps.billing.services import entitlement_service, usage_service
        from apps.organization.models import Organization

        rows = Organization.objects.filter(is_active=True)
        query = request.query_params.get("q", "").strip()
        if query:
            rows = rows.filter(name__icontains=query)
        plan_code = request.query_params.get("plan", "").strip().upper()

        subscriptions = {
            item.billing_account.organization_id: item
            for item in Subscription.objects.filter(status__in=LIVE_STATUSES).select_related(
                "plan", "billing_account"
            )
        }

        results = []
        for organization in rows[: _bounded_limit(request)]:
            subscription = subscriptions.get(organization.id)
            code = subscription.plan.code if subscription else ""
            if plan_code and code != plan_code:
                continue
            results.append(
                {
                    "id": str(organization.id),
                    "name": organization.name,
                    "organization_type": organization.organization_type,
                    "plan_code": code,
                    "plan_name": subscription.plan.name if subscription else "",
                    "status": subscription.status if subscription else "",
                    "cancel_at_period_end": (
                        subscription.cancel_at_period_end if subscription else False
                    ),
                    "usage": usage_service.snapshot(organization=organization),
                    "limits": {
                        key: entitlement_service.limit(organization=organization, key=key)
                        for key in _headline_limits()
                    },
                    "over_limit": entitlement_service.over_limit(organization=organization),
                }
            )

        record(
            action=AuditAction.VIEW,
            aggregate_type="billing_subscription",
            aggregate_id=request.user.id,
            management_actor=request.user,
            metadata={"returned": len(results)},
        )
        return Response({"results": results})


class BillingPortfolioView(ManagementAPIView):
    """One Portfolio: the entitlement snapshot and its plan history."""

    required_capability = Capability.VIEW_BILLING

    def get(self, request, pk):
        from apps.billing.models import BillingEvent
        from apps.billing.services import entitlement_service
        from apps.organization.models import Organization

        organization = Organization.objects.filter(id=pk).first()
        if organization is None:
            raise NotFound("That Portfolio does not exist.")

        events = BillingEvent.objects.filter(
            billing_account__organization=organization
        ).select_related("actor")[:50]

        return Response(
            {
                "portfolio": {"id": str(organization.id), "name": organization.name},
                "billing": entitlement_service.snapshot(organization=organization),
                "events": [
                    {
                        "id": str(event.id),
                        "event_type": event.event_type,
                        "from_plan_code": event.from_plan_code,
                        "to_plan_code": event.to_plan_code,
                        "from_status": event.from_status,
                        "to_status": event.to_status,
                        "reason": event.reason,
                        # Who did it, and whether it was the customer or us.
                        "actor_label": (
                            event.actor.display_name
                            if event.actor
                            else ("Management" if event.actor_management_id else "System")
                        ),
                        "occurred_at": _iso(event.occurred_at),
                    }
                    for event in events
                ],
            }
        )


class BillingPlanChangeView(ManagementAPIView):
    """Move a Portfolio's plan from the console.

    An administrative grant, not a sale. It writes the same `BillingEvent` and
    audit record as any other plan change, stamped with the staff member who
    did it, and a reason is required — "somebody changed this and nobody knows
    why" is the failure this exists to prevent.
    """

    required_capability = Capability.MANAGE_BILLING

    def post(self, request, pk):
        from apps.billing.services import subscription_service
        from apps.organization.models import Organization

        organization = Organization.objects.filter(id=pk).first()
        if organization is None:
            raise NotFound("That Portfolio does not exist.")

        plan_code = str(request.data.get("plan_code", "")).strip().upper()
        reason = str(request.data.get("reason", "")).strip()
        if not reason:
            raise Conflict("Say why this plan is changing.")

        subscription = subscription_service.change_plan(
            organization=organization,
            plan_code=plan_code,
            # No customer performed this. Attributing it to the Portfolio owner
            # would put their name against somebody else's act.
            actor=None,
            management_actor=request.user,
            reason=reason,
        )
        return Response(
            {
                "id": str(organization.id),
                "plan_code": subscription.plan.code,
                "status": subscription.status,
            }
        )


def _headline_limits() -> list[str]:
    from apps.billing import catalogue

    return list(catalogue.HEADLINE_LIMITS)


class MyAccountDeletionView(APIView):
    """GET/POST/DELETE /me/account-deletion/ - ask for deletion, see it, withdraw it."""

    permission_classes: ClassVar = [IsAuthenticated]

    def get(self, request):
        from . import deletion

        latest = deletion.latest_for(request.user)
        return Response(
            {
                "request": deletion.row(latest) if latest else None,
                "blockers": deletion.blockers_for(request.user),
                "confirmation": deletion.CONFIRMATION,
            }
        )

    def post(self, request):
        from . import deletion

        item = deletion.request_deletion(
            user=request.user,
            reason=str(request.data.get("reason", "")),
            confirmation=str(request.data.get("confirmation", "")),
        )
        return Response({"request": deletion.row(item)}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        from . import deletion

        item = deletion.cancel_deletion(user=request.user)
        return Response({"request": deletion.row(item)})


class AccountDeletionsView(ManagementAPIView):
    required_capability = Capability.VIEW_USERS

    def get(self, request):
        from . import deletion
        from .models import AccountDeletionRequest

        rows = AccountDeletionRequest.objects.select_related("user", "decided_by")
        state = request.query_params.get("status", "").strip()
        if state:
            rows = rows.filter(status=state)
        return Response(
            {
                "results": [
                    deletion.row(item, for_management=True)
                    for item in rows[: _bounded_limit(request)]
                ]
            }
        )


class AccountDeletionDecisionView(ManagementAPIView):
    required_capability = Capability.MANAGE_USERS

    def post(self, request, pk, action):
        from . import deletion

        note = str(request.data.get("note", ""))
        if action == "approve":
            item = deletion.approve(item_id=pk, actor=request.user, note=note)
        elif action == "decline":
            item = deletion.decline(item_id=pk, actor=request.user, note=note)
        else:
            raise NotFound("Unknown decision.")
        return Response(deletion.row(item, for_management=True))
