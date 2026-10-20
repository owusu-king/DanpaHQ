"""Sharing a passport, withdrawing it, and asking for a record to be corrected.

Every decision about who may see what is made here, on the server, on every
read. A link is a scope and a lifetime; opening it re-checks both and then reads
the tenant's records afresh, so revoking takes effect on the very next request
and nothing a recipient once saw is cached anywhere they can return to.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record as audit
from apps.core.exceptions import Conflict, Gone, NotFound, ValidationFailed

from . import tokens
from .models import CorrectionRecord, PassportCorrection, PassportShare
from .record import assemble, eligible_tenancies

#: The lifetimes a tenant may choose. Long enough for a landlord to get round
#: to reading it; short enough that a forgotten link stops working by itself.
EXPIRY_DAYS = (1, 7, 30)
DEFAULT_EXPIRY_DAYS = 7
#: Live links per person. Generous for someone flat-hunting; a ceiling on a
#: compromised account minting links in a loop.
MAX_ACTIVE_SHARES = 20
#: How long an expired or revoked link stays in the owner's list, so they can
#: see what they shared and when it stopped. The row itself is kept for audit.
HISTORY_DAYS = 30


class ShareExpired(Gone):
    code = "passport_share_expired"
    message = "This Housing Passport link has expired."


class ShareRevoked(Gone):
    code = "passport_share_revoked"
    message = "The tenant has withdrawn this Housing Passport link."


# --- scope --------------------------------------------------------------------


def clean_scope(user, data: dict) -> dict:
    """Validate a requested scope against this person's own records."""
    eligible = {str(row.id) for row in eligible_tenancies(user)}
    requested = [str(value) for value in data.get("tenancy_ids") or []]
    unknown = [value for value in requested if value not in eligible]
    if unknown:
        raise ValidationFailed(
            "One of the chosen tenancies is not in your passport.",
            details={"tenancy_ids": ["Choose from your own tenancies."]},
        )
    scope = {
        "identity": bool(data.get("include_identity")),
        "tenancy_ids": list(dict.fromkeys(requested)),
        "payments": bool(data.get("include_payments")) and bool(requested),
        "amounts": bool(data.get("include_amounts")) and bool(requested),
    }
    if not scope["identity"] and not scope["tenancy_ids"]:
        raise ValidationFailed(
            "Choose at least one thing to share.",
            details={"scope": ["Include your identity checks or a tenancy."]},
        )
    return scope


def preview(user, data: dict) -> dict:
    """Exactly what a recipient would see for this scope, without saving anything."""
    return assemble(user, scope=clean_scope(user, data), audience="recipient")


def share_scope(share: PassportShare) -> dict:
    return {
        "identity": share.include_identity,
        "tenancy_ids": list(share.tenancy_ids or []),
        "payments": share.include_payments,
        "amounts": share.include_amounts,
    }


# --- the owner's links ---------------------------------------------------------


def visible_shares(user):
    """Live links, and ones that stopped working within the last month."""
    cutoff = timezone.now() - timedelta(days=HISTORY_DAYS)
    return PassportShare.objects.filter(owner=user).filter(
        Q(revoked_at__isnull=True, expires_at__gt=cutoff) | Q(revoked_at__gt=cutoff)
    )


@transaction.atomic
def create_share(user, data: dict) -> PassportShare:
    scope = clean_scope(user, data)
    days = int(data.get("expires_in_days") or DEFAULT_EXPIRY_DAYS)
    if days not in EXPIRY_DAYS:
        raise ValidationFailed(
            "Choose how long the link should last.",
            details={
                "expires_in_days": [f"Choose one of {', '.join(map(str, EXPIRY_DAYS))} days."]
            },
        )
    # The owner's row is the lock: two tabs creating at once queue here, so the
    # cap counts the other's link instead of both seeing room for one more.
    type(user).objects.select_for_update().filter(pk=user.pk).first()
    now = timezone.now()
    live = PassportShare.objects.filter(owner=user, revoked_at__isnull=True, expires_at__gt=now)
    if live.count() >= MAX_ACTIVE_SHARES:
        raise Conflict(
            f"You already have {MAX_ACTIVE_SHARES} live links. "
            "Withdraw one you no longer need first."
        )

    salt = tokens.new_salt()
    share = PassportShare.objects.create(
        owner=user,
        recipient_label=str(data.get("recipient_label") or "").strip()[:80],
        include_identity=scope["identity"],
        tenancy_ids=scope["tenancy_ids"],
        include_payments=scope["payments"],
        include_amounts=scope["amounts"],
        salt=salt,
        token_digest=tokens.digest(tokens.token_for(salt)),
        expires_at=now + timedelta(days=days),
    )
    # The scope, never the token or its digest.
    audit(
        action=AuditAction.CREATE,
        aggregate_type="passport_share",
        aggregate_id=share.id,
        actor=user,
        metadata={
            "identity": scope["identity"],
            "tenancies": len(scope["tenancy_ids"]),
            "payments": scope["payments"],
            "amounts": scope["amounts"],
            "expires_in_days": days,
        },
    )
    return share


def owned_share(user, share_id) -> PassportShare:
    share = PassportShare.objects.filter(owner=user, id=share_id).first()
    if share is None:
        raise NotFound("We could not find that link.")
    return share


@transaction.atomic
def revoke_share(user, share_id) -> PassportShare:
    share = PassportShare.objects.select_for_update().filter(owner=user, id=share_id).first()
    if share is None:
        raise NotFound("We could not find that link.")
    if share.revoked_at is None:
        share.revoked_at = timezone.now()
        share.save(update_fields=["revoked_at", "updated_at"])
        audit(
            action=AuditAction.UPDATE,
            aggregate_type="passport_share",
            aggregate_id=share.id,
            actor=user,
            changes={"state": ["active", "revoked"]},
        )
    return share


def link_token(share: PassportShare) -> str | None:
    """The token, for the owner, while the link still works. Never afterwards."""
    return tokens.token_for(share.salt) if share.state == "active" else None


# --- the recipient --------------------------------------------------------------


def open_share(token: str) -> tuple[PassportShare, dict]:
    """Resolve a link and read the passport it allows, counting the view.

    Unknown and malformed tokens are one answer. Expired and revoked are told
    apart, because whoever holds the token already holds the link and is owed
    an explanation of why it stopped — and neither tells them anything about
    the tenant.
    """
    if not tokens.looks_like_token(token):
        raise NotFound("This Housing Passport link is not valid.")
    share = (
        PassportShare.objects.select_related("owner")
        .filter(token_digest=tokens.digest(token))
        .first()
    )
    if share is None or not share.owner.is_active:
        raise NotFound("This Housing Passport link is not valid.")
    if share.revoked_at is not None:
        raise ShareRevoked()
    if share.expires_at <= timezone.now():
        raise ShareExpired()

    now = timezone.now()
    PassportShare.objects.filter(id=share.id).update(
        view_count=F("view_count") + 1,
        last_viewed_at=now,
        first_viewed_at=share.first_viewed_at or now,
    )
    audit(
        action=AuditAction.VIEW,
        aggregate_type="passport_share",
        aggregate_id=share.id,
        actor=None,
        actor_label="Housing Passport recipient",
        metadata={"owner_id": str(share.owner_id)},
    )
    view = assemble(share.owner, scope=share_scope(share), audience="recipient")
    return share, view


# --- corrections -----------------------------------------------------------------


_CATEGORY = {
    CorrectionRecord.IDENTITY: "verification",
    CorrectionRecord.TENANCY: "lease",
    CorrectionRecord.PAYMENTS: "payment",
}


@transaction.atomic
def request_correction(
    user, *, record_type: str, record_id: str, reason: str
) -> PassportCorrection:
    """Open a review of one record, in Management's support queue.

    The record itself is not touched: it belongs to its own domain, and only a
    reviewed decision there changes it. Until the review closes, the passport
    shows the record as disputed to the tenant and to anyone they share it with.
    """
    from apps.operations.services import create_support_case

    from .record import correction_states

    if record_type not in CorrectionRecord.values:
        raise ValidationFailed("Choose the record to correct.")
    clean_reason = str(reason or "").strip()
    if len(clean_reason) < 10:
        raise ValidationFailed(
            "Say what is wrong, so the reviewer knows what to check.",
            details={"reason": ["Write at least a sentence."]},
        )

    record_id = "" if record_type == CorrectionRecord.IDENTITY else str(record_id or "")
    if record_type == CorrectionRecord.IDENTITY:
        subject = "identity checks"
    else:
        tenancy = next((row for row in eligible_tenancies(user) if str(row.id) == record_id), None)
        if tenancy is None:
            raise NotFound("We could not find that record in your passport.")
        where = f"{tenancy.property.title} · {tenancy.space_label}"
        subject = (
            f"tenancy at {where}"
            if record_type == CorrectionRecord.TENANCY
            else f"rent payments at {where}"
        )

    existing = correction_states(user).get((record_type, record_id))
    if existing and existing["state"] == "under_review":
        raise Conflict("This record is already being reviewed. You will hear back in Support.")

    case = create_support_case(
        user=user,
        category=_CATEGORY[record_type],
        summary=f"Housing Passport correction: {subject}"[:180],
        message=(
            f"Housing Passport correction request.\n"
            f"Record: {subject} ({record_type}{':' + record_id if record_id else ''}).\n\n"
            f"{clean_reason}"
        ),
    )
    correction = PassportCorrection.objects.create(
        owner=user,
        record_type=record_type,
        record_id=record_id,
        reason=clean_reason[:1000],
        support_case_id=case.id,
    )
    audit(
        action=AuditAction.CREATE,
        aggregate_type="passport_correction",
        aggregate_id=correction.id,
        actor=user,
        metadata={"record_type": record_type, "support_case_id": str(case.id)},
    )
    return correction
