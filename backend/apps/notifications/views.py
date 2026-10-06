"""Notification API."""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import Notification
from .serializers import (
    MarkReadSerializer,
    NotificationPreferenceSerializer,
    NotificationSerializer,
)


class NotificationListView(APIView):
    """GET /me/notifications/?unread=true"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Weeks-old unread records are history; they leave the list and the badge.
        services.age_out(user=request.user)
        queryset = Notification.objects.filter(user=request.user)
        if request.query_params.get("unread") == "true":
            queryset = queryset.filter(read_at__isnull=True)
        return Response(
            {
                "unread_count": services.unread_count(user=request.user),
                "results": NotificationSerializer(queryset[:100], many=True).data,
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

    def patch(self, request):
        preference = services.preferences_for(request.user)
        serializer = NotificationPreferenceSerializer(preference, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
