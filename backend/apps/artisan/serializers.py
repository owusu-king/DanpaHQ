"""The artisan application as its applicant reads and sends it."""

from __future__ import annotations

from rest_framework import serializers

from apps.files.models import FilePurpose

from . import services
from .models import Trade

#: Matches the maintenance photographs: long enough on a slow connection, short
#: enough that a copied link is not a lasting handout.
INLINE_TTL_SECONDS = 300


class IdentityDocumentSerializer(serializers.Serializer):
    file_id = serializers.UUIDField()
    evidence_type = serializers.ChoiceField(choices=sorted(services.IDENTITY_EVIDENCE_TYPES))


class CertificateInputSerializer(serializers.Serializer):
    file_id = serializers.UUIDField()
    trade = serializers.ChoiceField(choices=Trade.choices)
    issuing_body = serializers.CharField(max_length=160)
    expires_on = serializers.DateField(required=False, allow_null=True)


class UpdateProfileSerializer(serializers.Serializer):
    trades = serializers.ListField(child=serializers.ChoiceField(choices=Trade.choices))
    district_ids = serializers.ListField(child=serializers.UUIDField())
    bio = serializers.CharField(required=False, allow_blank=True, max_length=600)
    portfolio_file_ids = serializers.ListField(child=serializers.UUIDField())
    certificates = CertificateInputSerializer(many=True, required=False)


class DiscoverQuerySerializer(serializers.Serializer):
    trade = serializers.ChoiceField(choices=Trade.choices, required=False)
    district = serializers.UUIDField(required=False)
    certified = serializers.BooleanField(required=False, default=False)
    show_uncertified = serializers.BooleanField(required=False, default=False)


class ApplySerializer(serializers.Serializer):
    trades = serializers.ListField(child=serializers.ChoiceField(choices=Trade.choices))
    district_ids = serializers.ListField(child=serializers.UUIDField())
    bio = serializers.CharField(required=False, allow_blank=True, max_length=600)
    portfolio_file_ids = serializers.ListField(child=serializers.UUIDField())
    identity_documents = IdentityDocumentSerializer(many=True, required=False)
    certificates = CertificateInputSerializer(many=True, required=False)


def inline_photo_url(file) -> str | None:
    if file is None or not file.is_usable or file.purpose != FilePurpose.ARTISAN_WORK_PHOTO:
        return None
    from apps.files.storage import get_storage

    return (
        get_storage()
        .presign_download(
            key=file.storage_key,
            expires_in=INLINE_TTL_SECONDS,
            filename=file.original_filename,
            disposition="inline",
        )
        .url
    )


def trade_options() -> list[dict]:
    return [{"value": value, "label": label} for value, label in Trade.choices]


def my_application(user) -> dict:
    """Where the application stands, and the profile it describes.

    Only ever returned to the applicant, so their own work photographs are
    signed inline. ``decision_note`` is what the reviewer wrote for them — the
    internal note never leaves Management.
    """
    from apps.trust.models import VerificationStatus

    verification = services.artisan_verification(user)
    profile = (
        services.ArtisanProfile.objects.filter(user=user)
        .prefetch_related("districts__region", "portfolio__file", "certificates")
        .first()
    )
    status = services._status(verification, profile)
    labels = dict(Trade.choices)
    speaks = verification is not None and verification.status in (
        VerificationStatus.NEEDS_MORE,
        VerificationStatus.REJECTED,
        VerificationStatus.REVOKED,
    )
    return {
        "status": status,
        "submitted_at": verification.created_at if verification else None,
        "decided_at": verification.decided_at if verification else None,
        "decision_note": verification.decision_note if speaks else "",
        "suspended_at": profile.suspended_at if profile else None,
        "suspended_reason": profile.suspended_reason if profile else "",
        "identity_on_file": services._has_current_identity(user),
        "trade_options": trade_options(),
        "profile": None
        if profile is None
        else {
            "trades": [
                {"value": trade, "label": labels.get(trade, trade)} for trade in profile.trades
            ],
            "districts": [
                {"id": str(district.id), "name": district.name, "region": district.region.name}
                for district in profile.districts.all()
            ],
            "bio": profile.bio,
            "portfolio": [
                {
                    "id": str(photo.id),
                    "file_id": str(photo.file_id),
                    "url": inline_photo_url(photo.file),
                }
                for photo in profile.portfolio.all()
            ],
            "certificates": [
                {
                    "id": str(certificate.id),
                    "file_id": str(certificate.file_id),
                    "trade": certificate.trade,
                    "trade_label": certificate.get_trade_display(),
                    "issuing_body": certificate.issuing_body,
                    "expires_on": certificate.expires_on,
                    "status": certificate.status,
                    "verified_at": certificate.verified_at,
                    "decision_note": certificate.decision_note,
                }
                for certificate in profile.certificates.all()
            ],
        },
    }
