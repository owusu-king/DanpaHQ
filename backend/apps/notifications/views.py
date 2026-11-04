"""Notification API."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.core.exceptions import Conflict
from apps.core.throttling import CacheAwareRateThrottle

from . import services
from .models import FCM_TOKEN_PREFIX, Notification, NotificationPreference
from .serializers import (
    MarkReadSerializer,
    NotificationPreferenceSerializer,
    NotificationSerializer,
    PushTokenSerializer,
    RemovePushTokenSerializer,
)


class NotificationPagination(CursorPagination):
    page_size = 100
    ordering = ("-created_at", "-id")


class NotificationListView(APIView):
    """GET /me/notifications/?unread=true"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Older activity leaves the unread badge, but remains in the history.
        services.age_out(user=request.user)
        queryset = Notification.objects.filter(user=request.user)
        if request.query_params.get("unread") == "true":
            queryset = queryset.filter(read_at__isnull=True)
        pagination = NotificationPagination()
        page = pagination.paginate_queryset(queryset, request)
        next_link = pagination.get_next_link()
        next_cursor = parse_qs(urlsplit(next_link).query)["cursor"][0] if next_link else None
        return Response(
            {
                "unread_count": services.unread_count(user=request.user),
                "results": NotificationSerializer(page, many=True).data,
                "next_cursor": next_cursor,
            }
        )


class MarkReadView(APIView):
    """POST /me/notifications/read/ — some, or all."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = MarkReadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        marked = services.mark_read(
            user=request.user, notification_ids=payload.validated_data.get("ids") or None
        )
        return Response(
            {
                "marked": marked,
                "unread_count": services.unread_count(user=request.user),
            }
        )


class NotificationPreferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        preference = services.preferences_for(request.user)
        return Response(NotificationPreferenceSerializer(preference).data)

    @transaction.atomic
    def patch(self, request):
        preference, _ = NotificationPreference.objects.select_for_update().get_or_create(
            user=request.user
        )
        serializer = NotificationPreferenceSerializer(preference, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PushRegistrationThrottle(CacheAwareRateThrottle, UserRateThrottle):
    scope = "push_registration"


class PushTokenView(APIView):
    """A live native session may register or remove only its own device token."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [PushRegistrationThrottle]

    def put(self, request):
        from apps.identity.authentication import require_live_session
        from apps.identity.models import Device, DevicePlatform, Session

        session = require_live_session(request)
        device = session.device
        if device is None or device.platform not in (DevicePlatform.ANDROID, DevicePlatform.IOS):
            raise ValidationError("Sign in on the mobile app before enabling push notifications.")
        payload = PushTokenSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        token = payload.validated_data["token"]
        recipient_id = payload.validated_data.get("recipient_id")
        if token.startswith(FCM_TOKEN_PREFIX) and recipient_id != request.user.id:
            raise ValidationError("The push registration account changed. Please try again.")
        # An installation changing accounts must stop receiving the old account's alerts.
        try:
            with transaction.atomic():
                candidates = Device.objects.select_for_update().filter(
                    Q(id=device.id) | Q(push_token=token)
                ).order_by("id")
                locked = {candidate.id: candidate for candidate in candidates}
                device = locked.get(device.id)
                live_session = Session.objects.filter(id=session.id).first()
                if (device is None or device.is_blocked or device.is_removed
                        or live_session is None or not live_session.is_active):
                    raise ValidationError("This device is no longer signed in.")
                Device.objects.filter(id__in=locked).exclude(id=device.id).update(push_token="")
                Device.objects.filter(id=device.id).update(push_token=token)
        except IntegrityError as exc:
            raise Conflict("Push registration changed. Please try again.") from exc
        return Response({"registered": True})

    def delete(self, request):
        from apps.identity.authentication import require_live_session
        from apps.identity.models import Device

        session = require_live_session(request)
        payload = RemovePushTokenSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        if payload.validated_data.get("recipient_id", request.user.id) != request.user.id:
            raise ValidationError("The push registration account changed. Please try again.")
        if session.device_id:
            Device.objects.filter(id=session.device_id).update(push_token="")
        return Response(status=204)
