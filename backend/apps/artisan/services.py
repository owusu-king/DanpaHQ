"""Applying to work as an artisan, the decision on it, and suspension.

Who may do what is decided here and nowhere else:

* **Anyone with a finished account** may apply, from whichever experience they
  are in. Applying moves nobody anywhere: their tenant or provider side carries
  on exactly as it was, and the artisan experience appears only on approval.
* **Management** decides the application in the existing verification queue,
  and suspends or reinstates an approved artisan here.
* **An approved, unsuspended artisan** may take on new work. Every action that
  starts new work asks ``require_working_artisan`` — a hidden button is a
  courtesy, this is the check.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.files.models import FilePurpose, StoredFile
from apps.outbox.services import emit

from .models import (
    MAX_CERTIFICATES,
    MAX_PORTFOLIO_PHOTOS,
    MAX_SERVICE_DISTRICTS,
    MIN_PORTFOLIO_PHOTOS,
    ArtisanCertificate,
    ArtisanPortfolioPhoto,
    ArtisanProfile,
    Trade,
)

#: The documents that say who somebody is. A selfie travels with them but is
#: never enough on its own.
IDENTITY_EVIDENCE_TYPES = frozenset(
    {"ghana_card_front", "ghana_card_back", "passport", "drivers_licence", "selfie"}
)
_PHOTO_ID_TYPES = IDENTITY_EVIDENCE_TYPES - {"selfie"}

#: The application states a client renders. ``suspended`` is not a
#: verification outcome: it is an approved artisan Management has paused.
NOT_STARTED = "not_started"
APPROVED = "approved"
SUSPENDED = "suspended"


# --- reading -------------------------------------------------------------------


def artisan_verification(user):
    """The newest decision on this person's artisan application, if any."""
    from apps.trust.models import SubjectType, Verification, VerificationKind, VerificationStatus

    return (
        Verification.objects.for_subject(SubjectType.USER, user.id)
        .filter(kind=VerificationKind.ARTISAN)
        .exclude(status=VerificationStatus.SUPERSEDED)
        .first()
    )


def profile_for(user) -> ArtisanProfile | None:
    return ArtisanProfile.objects.filter(user=user).first()


def _status(verification, profile) -> str:
    if verification is None:
        return NOT_STARTED
    if verification.is_current:
        return SUSPENDED if profile is not None and profile.is_suspended else APPROVED
    return verification.status


def artisan_status(user) -> str:
    return _status(artisan_verification(user), profile_for(user))


def artisan_capabilities(user) -> dict:
    """The artisan block of ``/me/``'s capabilities.

    ``workspace_access`` stays open while suspended: an artisan's finished and
    current jobs are their record too, and suspension is meant to preserve that.
    ``can_quote`` is the one that closes.
    """
    status = artisan_status(user)
    return {
        "status": status,
        "workspace_access": status in (APPROVED, SUSPENDED),
        "can_quote": status == APPROVED,
    }


def require_working_artisan(user) -> ArtisanProfile:
    """The gate in front of anything that starts new work. Read live, every time."""
    profile = profile_for(user)
    status = _status(artisan_verification(user), profile)
    if status == SUSPENDED:
        raise PermissionDenied(
            "Your artisan account is suspended, so you cannot take on new work. "
            "Your existing jobs are still here."
        )
    if status != APPROVED or profile is None:
        raise PermissionDenied("This needs an approved artisan account.")
    return profile


# --- applying ------------------------------------------------------------------


def _ready_file(*, user, file_id, purpose: str, what: str) -> StoredFile:
    """A file this person uploaded, for this purpose, that has passed its checks.

    Ownership is checked even though the id came from their own upload: knowing
    somebody else's file id must not put their photograph in this application.
    """
    stored = StoredFile.objects.filter(id=file_id).first()
    if stored is None or not stored.is_owned_by(user):
        raise NotFound(f"We could not find that {what}.")
    if stored.purpose != purpose:
        raise ValidationFailed(f"That file was not uploaded as {what}.")
    if not stored.is_usable:
        raise ValidationFailed(f"That {what} is still being checked. Wait a moment and try again.")
    return stored


def _clean_trades(trades) -> list[str]:
    cleaned = list(dict.fromkeys(trades or []))
    if not cleaned:
        raise ValidationFailed("Choose at least one trade you work in.")
    unknown = [trade for trade in cleaned if trade not in Trade.values]
    if unknown:
        raise ValidationFailed("Choose trades from the list.")
    return cleaned


def _districts(district_ids):
    from apps.geo.models import District

    ids = list(dict.fromkeys(str(value) for value in (district_ids or [])))
    if not ids:
        raise ValidationFailed("Choose at least one district you work in.")
    if len(ids) > MAX_SERVICE_DISTRICTS:
        raise ValidationFailed(f"Choose up to {MAX_SERVICE_DISTRICTS} districts.")
    found = list(District.objects.filter(id__in=ids))
    if len(found) != len(ids):
        raise ValidationFailed("Choose districts from the list.")
    return found


def _certificates(*, user, rows) -> list[dict]:
    rows = rows or []
    if len(rows) > MAX_CERTIFICATES:
        raise ValidationFailed(f"Add up to {MAX_CERTIFICATES} certificates.")
    today = timezone.localdate()
    cleaned = []
    for row in rows:
        trade = row.get("trade")
        if trade not in Trade.values:
            raise ValidationFailed("Say which trade each certificate is for.")
        issuing_body = (row.get("issuing_body") or "").strip()
        if not issuing_body:
            raise ValidationFailed("Say who issued each certificate.")
        expires_on = row.get("expires_on")
        if expires_on is not None and expires_on < today:
            raise ValidationFailed(
                "That certificate has already expired. Add a current one, or leave it out."
            )
        cleaned.append(
            {
                "trade": trade,
                "issuing_body": issuing_body[:160],
                "expires_on": expires_on,
                "file": _ready_file(
                    user=user,
                    file_id=row.get("file_id"),
                    purpose=FilePurpose.ARTISAN_CERTIFICATE,
                    what="a certificate",
                ),
            }
        )
    return cleaned


def _identity_documents(*, user, rows) -> list[tuple[str, StoredFile]]:
    documents = []
    for row in rows or []:
        evidence_type = row.get("evidence_type")
        if evidence_type not in IDENTITY_EVIDENCE_TYPES:
            raise ValidationFailed("That document type is not accepted here.")
        documents.append(
            (
                evidence_type,
                _ready_file(
                    user=user,
                    file_id=row.get("file_id"),
                    purpose=FilePurpose.IDENTITY_DOCUMENT,
                    what="an identity document",
                ),
            )
        )
    return documents


def _has_current_identity(user) -> bool:
    from apps.trust.models import SubjectType, VerificationKind
    from apps.trust.services import current_for

    return current_for(SubjectType.USER, user.id, VerificationKind.IDENTITY) is not None


def _portfolio(*, user, file_ids) -> list[StoredFile]:
    ids = list(dict.fromkeys(str(value) for value in (file_ids or [])))
    if not MIN_PORTFOLIO_PHOTOS <= len(ids) <= MAX_PORTFOLIO_PHOTOS:
        raise ValidationFailed(
            f"Add between {MIN_PORTFOLIO_PHOTOS} and {MAX_PORTFOLIO_PHOTOS} photos of your work."
        )
    return [
        _ready_file(
            user=user,
            file_id=file_id,
            purpose=FilePurpose.ARTISAN_WORK_PHOTO,
            what="a photo of your work",
        )
        for file_id in ids
    ]


def _write_profile(profile, *, trades, bio, districts, portfolio, certificate_rows) -> None:
    """Make the profile say what was just sent.

    Photographs are replaced outright. A certificate is kept by its file, so a
    check Management already made survives an unrelated edit — but describing
    the certificate differently undoes the check, because the check vouched for
    it as it was described then.
    """
    profile.trades = trades
    profile.bio = (bio or "").strip()[:600]
    profile.save(update_fields=["trades", "bio", "updated_at"])
    profile.districts.set(districts)

    # What an earlier review saw survives on that review's evidence, which these
    # rows never were.
    profile.portfolio.all().delete()
    ArtisanPortfolioPhoto.objects.bulk_create(
        ArtisanPortfolioPhoto(profile=profile, file=file, position=index)
        for index, file in enumerate(portfolio)
    )
    kept = {str(row["file"].id) for row in certificate_rows}
    profile.certificates.exclude(file_id__in=kept).delete()
    existing = {str(row.file_id): row for row in profile.certificates.all()}
    for row in certificate_rows:
        certificate = existing.get(str(row["file"].id))
        if certificate is None:
            ArtisanCertificate.objects.create(profile=profile, **row)
            continue
        changed = (
            certificate.trade != row["trade"]
            or certificate.issuing_body != row["issuing_body"]
            or certificate.expires_on != row["expires_on"]
        )
        if changed:
            certificate.trade = row["trade"]
            certificate.issuing_body = row["issuing_body"]
            certificate.expires_on = row["expires_on"]
            certificate.verified_at = None
            certificate.verified_by_management_id = None
            certificate.declined_at = None
            certificate.decision_note = ""
            certificate.save()


@transaction.atomic
def update_profile(
    *, user, trades, district_ids, bio="", portfolio_file_ids=None, certificates=None
):
    """An approved artisan keeps their profile current.

    No new review: approval was about the person, and what they show customers
    is theirs to keep up to date. A new certificate still reads "Certificate
    provided" until Management checks it. Allowed while suspended — a suspended
    artisan is hidden from Discover, so nobody sees the change until they are
    reinstated, and their records are theirs to tidy.
    """
    profile = profile_for(user)
    verification = artisan_verification(user)
    if profile is None or verification is None or not verification.is_current:
        raise PermissionDenied("This needs an approved artisan account.")

    trades = _clean_trades(trades)
    districts = _districts(district_ids)
    portfolio = _portfolio(user=user, file_ids=portfolio_file_ids)
    certificate_rows = _certificates(user=user, rows=certificates)
    profile = ArtisanProfile.objects.select_for_update().get(id=profile.id)
    _write_profile(
        profile,
        trades=trades,
        bio=bio,
        districts=districts,
        portfolio=portfolio,
        certificate_rows=certificate_rows,
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="artisan_profile",
        aggregate_id=profile.id,
        actor=user,
        metadata={
            "trades": trades,
            "districts": len(districts),
            "portfolio": len(portfolio),
            "certificates": len(certificate_rows),
        },
    )
    return profile


@transaction.atomic
def apply(
    *,
    user,
    trades,
    district_ids,
    bio: str = "",
    portfolio_file_ids=None,
    identity_documents=None,
    certificates=None,
):
    """Ask to work as an artisan. One application, one review, one decision.

    A government ID is asked for only when Danpa HQ does not already hold a
    current identity check — a provider who has been through review is not
    asked for their Ghana Card a second time. Certificates are optional for
    every trade.

    Answering a reviewer's "more information needed" is the same call: the
    profile is rewritten from what is sent and the application returns to the
    queue. Anything already attached stays attached, because the history of
    what was reviewed is not the applicant's to edit.
    """
    from apps.trust import services as trust_services
    from apps.trust.models import (
        EvidenceType,
        SubjectType,
        VerificationKind,
        VerificationMethod,
        VerificationStatus,
    )

    if not user.is_phone_verified:
        raise PermissionDenied("Confirm your phone number first.")
    if not user.is_registration_complete:
        raise PermissionDenied("Finish setting up your account first.")

    latest = artisan_verification(user)
    if latest is not None and latest.is_current:
        raise Conflict("You are already approved as an artisan.")
    if latest is not None and latest.status == VerificationStatus.PENDING:
        raise Conflict("Your application is with our team. We will let you know the outcome.")

    trades = _clean_trades(trades)
    districts = _districts(district_ids)
    portfolio = _portfolio(user=user, file_ids=portfolio_file_ids)
    documents = _identity_documents(user=user, rows=identity_documents)
    if not _has_current_identity(user) and not any(
        evidence_type in _PHOTO_ID_TYPES for evidence_type, _ in documents
    ):
        raise ValidationFailed("Add a photo of your Ghana Card, passport or driver's licence.")
    certificate_rows = _certificates(user=user, rows=certificates)

    profile, created = ArtisanProfile.objects.get_or_create(user=user)
    _write_profile(
        profile,
        trades=trades,
        bio=bio,
        districts=districts,
        portfolio=portfolio,
        certificate_rows=certificate_rows,
    )

    if latest is not None and latest.status == VerificationStatus.NEEDS_MORE:
        verification = latest
    else:
        verification = trust_services.start_verification(
            subject_type=SubjectType.USER,
            subject_id=user.id,
            kind=VerificationKind.ARTISAN,
            method=VerificationMethod.DOCUMENT_REVIEW,
            submitted_by=user,
        )

    attached = {str(file_id) for file_id in verification.evidence.values_list("file_id", flat=True)}
    evidence = [
        *documents,
        *((EvidenceType.ARTISAN_WORK_PHOTO, file) for file in portfolio),
        *((EvidenceType.TRADE_CERTIFICATE, row["file"]) for row in certificate_rows),
    ]
    for evidence_type, file in evidence:
        if str(file.id) in attached:
            continue
        attached.add(str(file.id))
        trust_services.attach_evidence(
            verification,
            evidence_type=evidence_type,
            file=file,
            collected_by=user,
            notes="Submitted with an artisan application.",
        )
    verification.refresh_from_db()
    if verification.status == VerificationStatus.NEEDS_MORE:
        trust_services.resubmit(verification)

    record(
        action=AuditAction.CREATE if created else AuditAction.UPDATE,
        aggregate_type="artisan_profile",
        aggregate_id=profile.id,
        actor=user,
        metadata={
            "verification_id": str(verification.id),
            "trades": trades,
            "districts": len(districts),
            "portfolio": len(portfolio),
            "certificates": len(certificate_rows),
        },
    )
    emit(
        DomainEvent(
            "artisan.applied.v1",
            "artisan_profile",
            str(profile.id),
            {"user_id": str(user.id), "verification_id": str(verification.id)},
        )
    )
    return verification


# --- the decision and after ------------------------------------------------------


def apply_artisan_approval(*, verification, decided_by=None, management_actor=None) -> None:
    """Record that approving an artisan also established who they are.

    Only when the application carried their ID: one that relied on an existing
    identity check has nothing new to say about it.
    """
    from apps.identity.models import User
    from apps.identity.services import record_identity_from_review

    if not verification.evidence.filter(evidence_type__in=_PHOTO_ID_TYPES).exists():
        return
    user = User.objects.filter(id=verification.subject_id).first()
    if user is None:
        return
    record_identity_from_review(
        user=user,
        verification=verification,
        decided_by=decided_by,
        management_actor=management_actor,
        evidence_types=set(IDENTITY_EVIDENCE_TYPES),
        reviewed_for="artisan application",
    )


def _approved_profile(user_id) -> ArtisanProfile:
    profile = ArtisanProfile.objects.select_related("user").filter(user_id=user_id).first()
    if profile is None:
        raise NotFound("We could not find that artisan.")
    verification = artisan_verification(profile.user)
    if verification is None or not verification.is_current:
        raise Conflict("Only an approved artisan can be suspended or reinstated.")
    return profile


@transaction.atomic
def suspend(*, user_id, management_actor, reason: str) -> ArtisanProfile:
    """Pause an approved artisan. New quotes and new assignments stop at once.

    Nothing is taken away: their jobs, quotes, photographs and history stay as
    they are, readable by them and by the people they worked for.
    """
    reason = (reason or "").strip()
    if not reason:
        raise ValidationFailed("Say why, and what the artisan should do next. They will see it.")
    profile = _approved_profile(user_id)
    profile = ArtisanProfile.objects.select_for_update().get(id=profile.id)
    if profile.is_suspended:
        raise Conflict("This artisan is already suspended.")
    profile.suspended_at = timezone.now()
    profile.suspended_reason = reason[:300]
    profile.suspended_by_management_id = getattr(management_actor, "id", None)
    profile.save(
        update_fields=[
            "suspended_at",
            "suspended_reason",
            "suspended_by_management_id",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="artisan_profile",
        aggregate_id=profile.id,
        management_actor=management_actor,
        changes={"suspended": [False, True]},
        metadata={"reason": reason[:200]},
    )
    emit(
        DomainEvent(
            "artisan.suspended.v1",
            "artisan_profile",
            str(profile.id),
            {"user_id": str(profile.user_id)},
        )
    )
    return profile


@transaction.atomic
def reinstate(*, user_id, management_actor) -> ArtisanProfile:
    profile = _approved_profile(user_id)
    profile = ArtisanProfile.objects.select_for_update().get(id=profile.id)
    if not profile.is_suspended:
        raise Conflict("This artisan is not suspended.")
    profile.suspended_at = None
    profile.suspended_reason = ""
    profile.suspended_by_management_id = None
    profile.save(
        update_fields=[
            "suspended_at",
            "suspended_reason",
            "suspended_by_management_id",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.PERMISSION_CHANGE,
        aggregate_type="artisan_profile",
        aggregate_id=profile.id,
        management_actor=management_actor,
        changes={"suspended": [True, False]},
    )
    emit(
        DomainEvent(
            "artisan.reinstated.v1",
            "artisan_profile",
            str(profile.id),
            {"user_id": str(profile.user_id)},
        )
    )
    return profile


# --- certificates ---------------------------------------------------------------------


@transaction.atomic
def decide_certificate(
    *, certificate_id, management_actor, verified: bool, note: str = ""
) -> ArtisanCertificate:
    """Management checks one certificate: verified with the date, or not accepted.

    A decision is final for the certificate as described. Describing it
    differently later (another trade, another issuer, another expiry) clears
    the decision and it waits to be checked again.
    """
    certificate = (
        ArtisanCertificate.objects.select_for_update()
        .select_related("profile")
        .filter(id=certificate_id)
        .first()
    )
    if certificate is None:
        raise NotFound("We could not find that certificate.")
    if certificate.verified_at is not None or certificate.declined_at is not None:
        raise Conflict("This certificate has already been checked.")
    note = (note or "").strip()
    if not verified and not note:
        raise ValidationFailed("Say why, and what the artisan should do next. They will see it.")

    now = timezone.now()
    if verified:
        certificate.verified_at = now
        certificate.verified_by_management_id = getattr(management_actor, "id", None)
    else:
        certificate.declined_at = now
    certificate.decision_note = note[:300]
    certificate.save(
        update_fields=[
            "verified_at",
            "verified_by_management_id",
            "declined_at",
            "decision_note",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.VERIFICATION_DECISION,
        aggregate_type="artisan_certificate",
        aggregate_id=certificate.id,
        management_actor=management_actor,
        changes={"status": ["provided", certificate.status]},
        metadata={"trade": certificate.trade, "issuing_body": certificate.issuing_body},
    )
    emit(
        DomainEvent(
            "artisan.certificate_decided.v1",
            "artisan_certificate",
            str(certificate.id),
            {"user_id": str(certificate.profile.user_id), "verified": verified},
        )
    )
    return certificate


def certificates_to_check(*, limit: int = 50) -> list[dict]:
    """Certificates nobody has checked yet, oldest first, whoever added them."""
    rows = (
        ArtisanCertificate.objects.filter(verified_at__isnull=True, declined_at__isnull=True)
        .select_related("profile__user")
        .order_by("created_at")[:limit]
    )
    return [
        {
            "id": str(row.id),
            "user_id": str(row.profile.user_id),
            "artisan": row.profile.user.display_name,
            "trade": row.get_trade_display(),
            "issuing_body": row.issuing_body,
            "expires_on": row.expires_on.isoformat() if row.expires_on else None,
            "status": row.status,
            "added_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


def certificate_file(certificate_id):
    certificate = (
        ArtisanCertificate.objects.select_related("file").filter(id=certificate_id).first()
    )
    if certificate is None or certificate.file is None or not certificate.file.is_usable:
        raise NotFound("That certificate is not available.")
    return certificate


# --- what Management sees -----------------------------------------------------------


def _management_row(profile, verification) -> dict:
    from apps.core.phone import mask

    labels = dict(Trade.choices)
    user = profile.user
    return {
        "user_id": str(user.id),
        "display_name": user.display_name,
        "phone": mask(user.phone),
        "status": _status(verification, profile),
        "verification_id": str(verification.id) if verification else None,
        "trades": [labels.get(trade, trade) for trade in profile.trades],
        "districts": [district.name for district in profile.districts.all()],
        "work_photos": len(profile.portfolio.all()),
        "certificates": len(profile.certificates.all()),
        "applied_at": profile.created_at.isoformat(),
        "suspended_at": profile.suspended_at.isoformat() if profile.suspended_at else None,
        "suspended_reason": profile.suspended_reason,
    }


def management_rows(*, status: str = "", limit: int = 50) -> list[dict]:
    """Every application, newest first, with its live status.

    Status is decided per row from the verification, so filtering happens after
    reading. The list is bounded, and one query gathers every verification.
    """
    from apps.trust.models import SubjectType, Verification, VerificationKind, VerificationStatus

    profiles = list(
        ArtisanProfile.objects.select_related("user")
        .prefetch_related("districts", "portfolio", "certificates")
        .order_by("-created_at")[:500]
    )
    latest: dict[str, object] = {}
    for verification in (
        Verification.objects.filter(
            subject_type=SubjectType.USER,
            subject_id__in=[str(profile.user_id) for profile in profiles],
            kind=VerificationKind.ARTISAN,
        )
        .exclude(status=VerificationStatus.SUPERSEDED)
        .order_by("subject_id", "-created_at")
    ):
        latest.setdefault(verification.subject_id, verification)

    rows = [_management_row(profile, latest.get(str(profile.user_id))) for profile in profiles]
    if status:
        rows = [row for row in rows if row["status"] == status]
    return rows[:limit]


def management_row_for(*, user_id) -> dict:
    profile = (
        ArtisanProfile.objects.select_related("user")
        .prefetch_related("districts", "portfolio", "certificates")
        .filter(user_id=user_id)
        .first()
    )
    if profile is None:
        raise NotFound("We could not find that artisan.")
    return _management_row(profile, artisan_verification(profile.user))


# --- what a reviewer sees ----------------------------------------------------------


def review_context(user_id) -> dict | None:
    """The application around the evidence, for the verification queue."""
    profile = ArtisanProfile.objects.filter(user_id=user_id).prefetch_related("districts").first()
    if profile is None:
        return None
    labels = dict(Trade.choices)
    certificates = profile.certificates.count()
    return {
        "trades": ", ".join(labels.get(trade, trade) for trade in profile.trades),
        "districts": ", ".join(district.name for district in profile.districts.all()),
        "about": profile.bio or "—",
        "work_photos": str(profile.portfolio.count()),
        "certificates": str(certificates) if certificates else "none",
    }
