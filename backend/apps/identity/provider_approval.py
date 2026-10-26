"""Provider approval uses the existing trust queue; property evidence stays separate."""

from django.db import transaction
from django.utils import timezone


@transaction.atomic
def start_approval(*, user, terms):
    from apps.core.exceptions import PermissionDenied
    from apps.trust import services
    from apps.trust.models import SubjectType, VerificationKind, VerificationMethod

    from .models import User
    from .services import provider_verification

    user = User.objects.select_for_update().get(id=user.id)
    if not user.is_active or not user.is_registration_complete:
        raise PermissionDenied("Finish setting up your account first.")
    require_verified_phone(user)
    latest = provider_verification(user)
    if user.account_type != "provider" and latest is None:
        raise PermissionDenied("Register as a provider before requesting approval.")
    if latest and latest.status in {"approved", "pending", "needs_more_info"}:
        return latest
    approval = services.start_verification(
        subject_type=SubjectType.USER,
        subject_id=user.id,
        kind=VerificationKind.PROVIDER,
        method=VerificationMethod.MANAGEMENT_APPROVAL,
        submitted_by=user,
    )
    snapshot = record_terms_acceptance(user=user, terms=terms, approval_id=approval.id)
    approval.provider_reference = terms["digest"]
    approval.provider_response = {"terms": snapshot}
    approval.save(update_fields=["provider_reference", "provider_response", "updated_at"])
    return approval


def has_verified_phone(user):
    return bool(user.phone and user.is_phone_verified)


def require_verified_phone(user):
    from apps.core.exceptions import PermissionDenied

    if not has_verified_phone(user):
        raise PermissionDenied(
            "Add a phone number and verify it by OTP before submitting for review."
        )


def record_terms_acceptance(*, user, terms, approval_id=None):
    from apps.audit.models import AuditAction
    from apps.audit.services import record

    now = timezone.now()
    user.provider_terms_version = terms["version"]
    user.provider_terms_digest = terms["digest"]
    user.provider_terms_accepted_at = now
    user.save(
        update_fields=[
            "provider_terms_version",
            "provider_terms_digest",
            "provider_terms_accepted_at",
            "updated_at",
        ]
    )
    snapshot = {
        "version": terms["version"],
        "digest": terms["digest"],
        "text": terms["text"],
        "accepted_at": now.isoformat(),
    }
    metadata = {"provider_terms_accepted": snapshot}
    if approval_id is not None:
        metadata["approval_id"] = str(approval_id)
    record(
        action=AuditAction.UPDATE,
        aggregate_type="user",
        aggregate_id=user.id,
        actor=user,
        metadata=metadata,
    )
    return snapshot


def reviewable_entries(entries):
    """Hide incomplete pre-existing management applications without deleting history."""
    from django.db.models import CharField, Q
    from django.db.models.functions import Cast

    from .models import User

    verified_users = (
        User.objects.filter(is_phone_verified=True, phone__isnull=False)
        .exclude(phone="")
        .annotate(subject_key=Cast("id", output_field=CharField()))
        .values("subject_key")
    )
    incomplete = Q(
        verification__kind="provider",
        verification__subject_type="user",
    ) & ~Q(verification__subject_id__in=verified_users)
    return entries.exclude(incomplete)


def has_accepted_terms(verification):
    import hashlib

    from .models import User

    terms = (verification.provider_response or {}).get("terms", {})
    return bool(
        verification.subject_type == "user"
        and verification.kind == "provider"
        and terms.get("text")
        and terms.get("version")
        and terms.get("accepted_at")
        and hashlib.sha256(terms["text"].encode()).hexdigest() == terms.get("digest")
        and verification.provider_reference == terms.get("digest")
        and User.objects.filter(
            id=verification.subject_id, provider_terms_accepted_at__isnull=False
        ).exists()
    )
