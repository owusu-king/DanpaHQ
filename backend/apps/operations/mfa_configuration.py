"""Operations Admin policy controls. Enrollment secrets never cross this boundary."""

from typing import ClassVar

from django.db.models import Q
from rest_framework import serializers
from rest_framework.response import Response

from apps.core.exceptions import NotFound
from apps.core.phone import mask

from . import mfa
from .models import ManagementUser
from .permissions import Capability
from .views import ManagementAPIView


class PolicySerializer(serializers.Serializer):
    account_kind = serializers.ChoiceField(choices=["consumer", "management"])
    account_id = serializers.UUIDField()
    mfa_policy = serializers.ChoiceField(choices=["default", "disabled", "optional", "required"])
    reason = serializers.CharField(min_length=5, max_length=500, trim_whitespace=True)


class SearchSerializer(serializers.Serializer):
    q = serializers.CharField(max_length=254, required=False, default="", allow_blank=True)
    account_kind = serializers.ChoiceField(choices=["consumer", "management"], default="consumer")
    offset = serializers.IntegerField(min_value=0, default=0)
    limit = serializers.IntegerField(min_value=1, max_value=100, default=25)


def _row(user, kind):
    credential = getattr(user, "admin_authenticator", None)
    return {
        "id": str(user.pk),
        "account_kind": kind,
        "display_name": user.display_name,
        "email": user.email or "",
        "phone": mask(user.phone) if kind == "consumer" else "",
        "is_active": user.is_active,
        "account_label": user.get_role_display()
        if kind == "management"
        else user.get_account_type_display() or "Consumer",
        "mfa_policy": user.mfa_policy,
        "effective_policy": mfa.policy(user),
        "mfa_enrolled": credential is not None,
    }


class MFAConfigurationView(ManagementAPIView):
    required_capability = Capability.MANAGE_CONFIGURATION
    http_method_names: ClassVar = ["get", "patch", "head", "options"]

    def _accounts(self, kind):
        from apps.identity.models import User

        rows = (
            ManagementUser.objects.all()
            if kind == "management"
            else User.objects.filter(
                is_staff=False,
                is_superuser=False,
            )
        )
        return rows.select_related("admin_authenticator")

    def get(self, request):
        payload = SearchSerializer(data=request.query_params)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        rows = self._accounts(data["account_kind"])
        if data["q"]:
            query = (
                Q(email__icontains=data["q"])
                | Q(first_name__icontains=data["q"])
                | Q(
                    last_name__icontains=data["q"],
                )
            )
            if data["account_kind"] == "consumer":
                query |= Q(phone__icontains=data["q"]) | Q(preferred_name__icontains=data["q"])
            rows = rows.filter(query)
        count = rows.count()
        start, limit = data["offset"], data["limit"]
        return Response(
            {
                "count": count,
                "offset": start,
                "limit": limit,
                "results": [
                    _row(user, data["account_kind"])
                    for user in rows.order_by("email", "id")[start : start + limit]
                ],
            }
        )

    def patch(self, request):
        payload = PolicySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        user = self._accounts(data["account_kind"]).filter(pk=data["account_id"]).first()
        if user is None:
            raise NotFound("We could not find that account.")
        changed = mfa.configure_policy(
            actor=request.user,
            user=user,
            policy_value=data["mfa_policy"],
            reason=data["reason"],
        )
        user.refresh_from_db()
        return Response(
            {
                "account": _row(user, data["account_kind"]),
                "changed": changed,
                "reauth_required": changed
                and data["account_kind"] == "management"
                and user.pk == request.user.pk,
            }
        )
