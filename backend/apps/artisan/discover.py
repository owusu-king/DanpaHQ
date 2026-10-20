"""Finding an artisan: who is listed, in what order, and what a profile says.

Only approved artisans who are not suspended are listed, and only facts are
shown: whether Danpa HQ checked their ID, each certificate and its status, how
many jobs they have completed here and their reviews. There is no score and no
ranking beyond one stated rule — artisans with a verified certificate come
first — and nothing here calls anybody trusted or guaranteed.

What is never shown: a phone number, an address, a certificate's file. A
customer reaches an artisan by inviting a quote, which Danpa HQ records.

### Electrical work

Wiring is dangerous done badly, so the electrical category shows only artisans
with a current verified electrical certificate unless the person browsing opts
in to see the rest — and the response says how many it held back, so the
choice is an informed one rather than a hidden filter.
"""

from __future__ import annotations

from django.db.models import CharField, Exists, OuterRef, Q
from django.db.models.functions import Cast
from django.utils import timezone

from apps.core.exceptions import NotFound

from .models import ArtisanCertificate, ArtisanProfile, CertificateStatus, Trade
from .serializers import inline_photo_url

ELECTRICAL = Trade.ELECTRICAL
MAX_RESULTS = 60


def _approved_now():
    from apps.trust.models import SubjectType, Verification, VerificationKind, VerificationStatus

    now = timezone.now()
    return Verification.objects.filter(
        subject_type=SubjectType.USER,
        kind=VerificationKind.ARTISAN,
        status=VerificationStatus.APPROVED,
        subject_id=Cast(OuterRef("user_id"), CharField()),
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))


def _verified_certificate(trade: str | None = None):
    rows = ArtisanCertificate.objects.filter(
        profile=OuterRef("pk"),
        verified_at__isnull=False,
        declined_at__isnull=True,
    ).filter(Q(expires_on__isnull=True) | Q(expires_on__gte=timezone.localdate()))
    return rows.filter(trade=trade) if trade else rows


def listed():
    """Every artisan a customer may find right now."""
    return (
        ArtisanProfile.objects.filter(
            suspended_at__isnull=True,
            user__is_active=True,
            user__deactivated_at__isnull=True,
        )
        .annotate(approved=Exists(_approved_now()))
        .filter(approved=True)
    )


def _identity_checked(user_ids) -> set[str]:
    from apps.trust.models import SubjectType, Verification, VerificationKind

    return set(
        Verification.objects.current()
        .filter(
            subject_type=SubjectType.USER,
            kind=VerificationKind.IDENTITY,
            subject_id__in=[str(value) for value in user_ids],
        )
        .values_list("subject_id", flat=True)
    )


def _public_certificates(profile) -> list[ArtisanCertificate]:
    return [row for row in profile.certificates.all() if row.status != CertificateStatus.DECLINED]


def _card(profile, *, identity: set[str]) -> dict:
    labels = dict(Trade.choices)
    certificates = _public_certificates(profile)
    certified = sorted(
        {
            row.get_trade_display()
            for row in certificates
            if row.status == CertificateStatus.VERIFIED
        }
    )
    cover = next(iter(profile.portfolio.all()), None)
    return {
        "id": str(profile.id),
        "name": profile.user.display_name,
        "trades": [{"value": trade, "label": labels.get(trade, trade)} for trade in profile.trades],
        "districts": [
            {"id": str(district.id), "name": district.name} for district in profile.districts.all()
        ],
        "id_checked": str(profile.user_id) in identity,
        "certified_trades": certified,
        # Counted from confirmed jobs once quotes and completion exist; until
        # then there is nothing to count, and saying zero is the honest answer.
        "jobs_completed": 0,
        "reviews_count": 0,
        "cover_url": inline_photo_url(cover.file) if cover else None,
    }


def discover(
    *,
    viewer,
    trade: str = "",
    district_id=None,
    certified_only: bool = False,
    show_uncertified_electrical: bool = False,
) -> dict:
    rows = listed().exclude(user=viewer)
    if trade:
        rows = rows.filter(trades__contains=[trade])
    if district_id:
        rows = rows.filter(districts__id=district_id)
    rows = rows.annotate(certified=Exists(_verified_certificate(trade or None)))

    hidden = 0
    electrical = trade == ELECTRICAL
    if electrical and not show_uncertified_electrical:
        hidden = rows.filter(certified=False).count()
        rows = rows.filter(certified=True)
    elif certified_only:
        rows = rows.filter(certified=True)

    profiles = list(
        rows.select_related("user")
        .prefetch_related("districts", "portfolio__file", "certificates")
        .order_by("-certified", "-created_at")
        .distinct()[:MAX_RESULTS]
    )
    identity = _identity_checked(profile.user_id for profile in profiles)
    return {
        "results": [_card(profile, identity=identity) for profile in profiles],
        "electrical": electrical,
        "hidden_uncertified": hidden,
    }


def public_profile(*, profile_id, viewer) -> dict:
    """One artisan as a customer reads them. The same not-found for anybody unlisted."""
    profile = (
        listed()
        .select_related("user")
        .prefetch_related("districts", "portfolio__file", "certificates")
        .filter(id=profile_id)
        .first()
    )
    if profile is None:
        raise NotFound("We could not find that artisan.")
    identity = _identity_checked([profile.user_id])
    return {
        **_card(profile, identity=identity),
        "bio": profile.bio,
        "member_since": profile.user.created_at.date().isoformat(),
        "portfolio": [
            {"id": str(photo.id), "url": inline_photo_url(photo.file)}
            for photo in profile.portfolio.all()
        ],
        "certificates": [
            {
                "id": str(row.id),
                "trade": row.trade,
                "trade_label": row.get_trade_display(),
                "issuing_body": row.issuing_body,
                "expires_on": row.expires_on,
                "status": row.status,
                "verified_at": row.verified_at,
            }
            for row in _public_certificates(profile)
        ],
        "reviews": [],
        "is_you": profile.user_id == getattr(viewer, "id", None),
    }
