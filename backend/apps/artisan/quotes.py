"""Quotes on maintenance requests: who may ask, answer, approve, and see what.

The maintenance request stays the record. This module holds only what it has
no place for — who was asked to quote and what each quote said — and hands the
assignment back to ``maintenance.services`` so status remains maintenance's.

Who may do what, decided here and nowhere else:

* **Anyone who runs the property** (``maintenance.services.is_provider_for``)
  invites up to three artisans to quote. Asking costs nobody anything.
* **The tenant** may *suggest* an artisan; it becomes an invitation only when
  somebody who runs the property sends it.
* **An approved, unsuspended artisan** quotes on invitations sent to them, and
  sends a revised quote for extra cost on a job they hold.
* **The payer** — owner, Portfolio owner or administrator, or the assigned
  Property Manager (``organization.services.may_approve_spending``) — approves
  or declines. Approving assigns the artisan; approving a revision makes it the
  price on record. Without that approval no extra cost exists.

### What an artisan sees

Invited, they see the kind of problem, what the tenant wrote, the photograph
and the area — locality and district — and never the address, the tenant's
name or a phone number. Those open only on the request they were assigned to,
once the payer approved their quote.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.core.money import Money
from apps.outbox.services import emit

from .models import ArtisanProfile, Quote, QuoteInvitation, QuoteStatus
from .services import require_working_artisan

#: "Invite two or three artisans to quote." More is a broadcast, not a choice.
MAX_OPEN_INVITATIONS = 3
MAX_MATERIALS = 20


# --- reading the request -------------------------------------------------------


def _request(request_id, *, lock: bool = False):
    from apps.maintenance.models import MaintenanceRequest

    rows = MaintenanceRequest.objects.select_related(
        "property__address__locality__district__region",
        "tenant",
        "unit",
        "assigned_artisan__user",
        "assigned_quote",
    )
    if lock:
        rows = rows.select_for_update(of=("self",))
    request = rows.filter(id=request_id).first()
    if request is None:
        raise NotFound("We could not find that maintenance request.")
    return request


def _runs(request, user) -> bool:
    from apps.maintenance.services import is_provider_for

    return is_provider_for(request=request, user=user)


def _pays(request, user) -> bool:
    from apps.organization.services import may_approve_spending

    return may_approve_spending(prop=request.property, user=user)


def _listed_artisan(artisan_id) -> ArtisanProfile:
    from .discover import listed

    artisan = listed().select_related("user").filter(id=artisan_id).first()
    if artisan is None:
        raise NotFound("We could not find that artisan.")
    return artisan


def _still_open(request) -> None:
    if not request.is_open:
        raise Conflict("This repair is already finished.")


def _money(minor: int) -> str:
    return Money(int(minor)).format()


# --- asking ---------------------------------------------------------------------


@transaction.atomic
def invite(*, user, request_id, artisan_id) -> QuoteInvitation:
    request = _request(request_id, lock=True)
    if not _runs(request, user):
        raise PermissionDenied("Only the people who run this property can invite artisans.")
    _still_open(request)
    if request.assigned_artisan_id:
        raise Conflict("An artisan is already doing this repair.")
    artisan = _listed_artisan(artisan_id)
    if artisan.user_id == user.id:
        raise ValidationFailed("You cannot invite yourself to quote.")

    open_count = QuoteInvitation.objects.filter(
        maintenance_request=request,
        invited_at__isnull=False,
        declined_at__isnull=True,
        closed_at__isnull=True,
    ).count()
    if open_count >= MAX_OPEN_INVITATIONS:
        raise Conflict(
            f"Up to {MAX_OPEN_INVITATIONS} artisans can be asked at once. "
            "Wait for an answer, or decline a quote first."
        )

    invitation, _ = QuoteInvitation.objects.get_or_create(
        maintenance_request=request, artisan=artisan
    )
    if invitation.invited_at is not None:
        raise Conflict("That artisan has already been asked to quote.")
    invitation.invited_by = user
    invitation.invited_at = timezone.now()
    invitation.save(update_fields=["invited_by", "invited_at", "updated_at"])
    record(
        action=AuditAction.CREATE,
        aggregate_type="quote_invitation",
        aggregate_id=invitation.id,
        actor=user,
        metadata={"maintenance_request": str(request.id), "artisan": str(artisan.id)},
    )
    emit(
        DomainEvent(
            "artisan.quote_invited.v1",
            "quote_invitation",
            str(invitation.id),
            {"user_id": str(artisan.user_id)},
        )
    )
    return invitation


@transaction.atomic
def suggest(*, user, request_id, artisan_id) -> QuoteInvitation:
    """A tenant names an artisan they would like asked. Nobody pays for a suggestion."""
    request = _request(request_id, lock=True)
    if str(request.tenant_id) != str(user.id):
        raise PermissionDenied("Only the tenant who reported this can suggest an artisan.")
    _still_open(request)
    if request.assigned_artisan_id:
        raise Conflict("An artisan is already doing this repair.")
    artisan = _listed_artisan(artisan_id)
    invitation, created = QuoteInvitation.objects.get_or_create(
        maintenance_request=request, artisan=artisan, defaults={"suggested_by": user}
    )
    if not created:
        raise Conflict("That artisan has already been suggested or asked.")
    emit(
        DomainEvent(
            "artisan.suggested.v1",
            "quote_invitation",
            str(invitation.id),
            {"maintenance_request": str(request.id)},
        )
    )
    return invitation


@transaction.atomic
def decline_invitation(*, user, invitation_id) -> QuoteInvitation:
    invitation = _own_invitation(user=user, invitation_id=invitation_id, lock=True)
    if not invitation.is_open:
        raise Conflict("This invitation is no longer open.")
    if invitation.quotes.filter(status=QuoteStatus.SUBMITTED).exists():
        raise Conflict("Withdraw your quote first.")
    invitation.declined_at = timezone.now()
    invitation.save(update_fields=["declined_at", "updated_at"])
    return invitation


def _own_invitation(*, user, invitation_id, lock: bool = False) -> QuoteInvitation:
    rows = QuoteInvitation.objects.select_related("artisan", "maintenance_request")
    if lock:
        rows = rows.select_for_update(of=("self",))
    invitation = rows.filter(id=invitation_id, artisan__user=user, invited_at__isnull=False).first()
    if invitation is None:
        raise NotFound("We could not find that invitation.")
    return invitation


# --- quoting --------------------------------------------------------------------


def _clean_quote(*, price_minor, scope, materials) -> tuple[int, str, list[dict]]:
    try:
        price = int(price_minor)
    except (TypeError, ValueError) as error:
        raise ValidationFailed("Enter the price.") from error
    if price <= 0:
        raise ValidationFailed("Enter the price.")
    scope = (scope or "").strip()
    if len(scope) < 10:
        raise ValidationFailed("Say in a sentence or two what the price covers.")
    rows = []
    for row in (materials or [])[: MAX_MATERIALS + 1]:
        item = str(row.get("item", "")).strip()[:120]
        if not item:
            continue
        cost = row.get("cost_minor")
        rows.append(
            {
                "item": item,
                "quantity": str(row.get("quantity", "")).strip()[:40],
                "cost_minor": int(cost) if cost not in (None, "") else None,
            }
        )
    if len(rows) > MAX_MATERIALS:
        raise ValidationFailed(f"List up to {MAX_MATERIALS} materials.")
    return price, scope[:1000], rows


@transaction.atomic
def submit_quote(*, user, invitation_id, price_minor, scope, materials=None) -> Quote:
    require_working_artisan(user)
    invitation = _own_invitation(user=user, invitation_id=invitation_id, lock=True)
    if not invitation.is_open:
        raise Conflict("This invitation is no longer open.")
    request = _request(invitation.maintenance_request_id, lock=True)
    _still_open(request)
    if request.assigned_artisan_id:
        raise Conflict("Another artisan is already doing this repair.")
    if invitation.quotes.filter(status=QuoteStatus.SUBMITTED).exists():
        raise Conflict("Your quote is waiting for an answer. Withdraw it to send another.")
    price, scope, rows = _clean_quote(price_minor=price_minor, scope=scope, materials=materials)

    quote = Quote.objects.create(
        invitation=invitation, price_minor=price, scope=scope, materials=rows
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="artisan_quote",
        aggregate_id=quote.id,
        actor=user,
        metadata={"maintenance_request": str(request.id), "price_minor": price},
    )
    emit(
        DomainEvent(
            "artisan.quote_submitted.v1",
            "artisan_quote",
            str(quote.id),
            {"maintenance_request": str(request.id), "revision": False},
        )
    )
    return quote


@transaction.atomic
def submit_revision(*, user, request_id, price_minor, scope, reason, materials=None) -> Quote:
    """Extra cost on a job already held. Counts for nothing until the payer approves."""
    require_working_artisan(user)
    request = _request(request_id, lock=True)
    if request.assigned_artisan is None or request.assigned_artisan.user_id != user.id:
        raise NotFound("We could not find that job.")
    _still_open(request)
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise ValidationFailed("Say what you found that changes the price.")
    on_record = request.assigned_quote
    if Quote.objects.filter(revises=on_record, status=QuoteStatus.SUBMITTED).exists():
        raise Conflict("A revised quote is already waiting for an answer.")
    price, scope, rows = _clean_quote(price_minor=price_minor, scope=scope, materials=materials)
    if price == on_record.price_minor:
        raise ValidationFailed("A revised quote changes the price. Keep the one on record instead.")

    # The pending-quote constraint is per invitation, and a revision shares the
    # original's invitation; the approved original is no longer pending, so it
    # does not stand in the way.
    quote = Quote.objects.create(
        invitation=on_record.invitation,
        price_minor=price,
        scope=scope,
        materials=rows,
        revises=on_record,
        reason=reason[:500],
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="artisan_quote",
        aggregate_id=quote.id,
        actor=user,
        metadata={
            "maintenance_request": str(request.id),
            "revises": str(on_record.id),
            "price_minor": price,
        },
    )
    emit(
        DomainEvent(
            "artisan.quote_submitted.v1",
            "artisan_quote",
            str(quote.id),
            {"maintenance_request": str(request.id), "revision": True},
        )
    )
    return quote


@transaction.atomic
def withdraw_quote(*, user, quote_id) -> Quote:
    quote = (
        Quote.objects.select_for_update(of=("self",))
        .select_related("invitation__artisan")
        .filter(id=quote_id, invitation__artisan__user=user)
        .first()
    )
    if quote is None:
        raise NotFound("We could not find that quote.")
    if quote.status != QuoteStatus.SUBMITTED:
        raise Conflict("Only a quote waiting for an answer can be withdrawn.")
    quote.status = QuoteStatus.WITHDRAWN
    quote.save(update_fields=["status", "updated_at"])
    return quote


# --- deciding ---------------------------------------------------------------------


def _quote_for_payer(*, user, quote_id):
    quote = (
        Quote.objects.select_for_update(of=("self",))
        .select_related("invitation__artisan__user", "revises")
        .filter(id=quote_id)
        .first()
    )
    if quote is None:
        raise NotFound("We could not find that quote.")
    request = _request(quote.invitation.maintenance_request_id, lock=True)
    if not _runs(request, user) and not _pays(request, user):
        raise NotFound("We could not find that quote.")
    if not _pays(request, user):
        raise PermissionDenied(
            "Only the owner, a Portfolio owner or administrator, or the Property Manager "
            "assigned to this property can approve spending."
        )
    if quote.status != QuoteStatus.SUBMITTED:
        raise Conflict("This quote has already been answered.")
    return quote, request


@transaction.atomic
def approve_quote(*, user, quote_id) -> Quote:
    from apps.maintenance import services as maintenance_services

    quote, request = _quote_for_payer(user=user, quote_id=quote_id)
    _still_open(request)
    artisan = quote.invitation.artisan
    now = timezone.now()

    if quote.revises_id is None:
        if request.assigned_artisan_id:
            raise Conflict("An artisan is already doing this repair.")
        # Suspension stops new assignments at once, even for a quote sent before it.
        if not _is_working(artisan):
            raise Conflict("This artisan cannot take on new work right now.")
        quote.status = QuoteStatus.APPROVED
        quote.decided_by, quote.decided_at = user, now
        quote.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        # Everybody else asked is told the job went elsewhere.
        others = QuoteInvitation.objects.filter(maintenance_request=request).exclude(
            id=quote.invitation_id
        )
        Quote.objects.filter(invitation__in=others, status=QuoteStatus.SUBMITTED).update(
            status=QuoteStatus.DECLINED,
            decided_at=now,
            decision_note="Another artisan was chosen.",
        )
        others.filter(closed_at__isnull=True).update(closed_at=now)
        maintenance_services.assign_artisan(
            request=request,
            quote=quote,
            approver=user,
            note=f"{artisan.user.display_name} approved at {_money(quote.price_minor)} "
            f"by {user.display_name}.",
        )
        event = "artisan.quote_approved.v1"
    else:
        if request.assigned_quote_id != quote.revises_id:
            raise Conflict("This revision is for a price that is no longer on record.")
        quote.status = QuoteStatus.APPROVED
        quote.decided_by, quote.decided_at = user, now
        quote.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        Quote.objects.filter(id=quote.revises_id).update(status=QuoteStatus.SUPERSEDED)
        maintenance_services.record_revision(
            request=request,
            quote=quote,
            approver=user,
            note=f"{_money(quote.revises.price_minor)} → {_money(quote.price_minor)}, "
            f"approved by {user.display_name}. {quote.reason}",
        )
        event = "artisan.revision_approved.v1"

    record(
        action=AuditAction.UPDATE,
        aggregate_type="artisan_quote",
        aggregate_id=quote.id,
        actor=user,
        changes={"status": [QuoteStatus.SUBMITTED, QuoteStatus.APPROVED]},
        metadata={"maintenance_request": str(request.id), "price_minor": quote.price_minor},
    )
    emit(
        DomainEvent(
            event,
            "artisan_quote",
            str(quote.id),
            {"user_id": str(artisan.user_id), "maintenance_request": str(request.id)},
        )
    )
    return quote


@transaction.atomic
def decline_quote(*, user, quote_id, note: str = "") -> Quote:
    quote, request = _quote_for_payer(user=user, quote_id=quote_id)
    quote.status = QuoteStatus.DECLINED
    quote.decided_by, quote.decided_at = user, timezone.now()
    quote.decision_note = (note or "").strip()[:300]
    quote.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="artisan_quote",
        aggregate_id=quote.id,
        actor=user,
        changes={"status": [QuoteStatus.SUBMITTED, QuoteStatus.DECLINED]},
        metadata={"maintenance_request": str(request.id)},
    )
    emit(
        DomainEvent(
            "artisan.quote_declined.v1",
            "artisan_quote",
            str(quote.id),
            {"user_id": str(quote.invitation.artisan.user_id), "revision": bool(quote.revises_id)},
        )
    )
    return quote


def _is_working(artisan: ArtisanProfile) -> bool:
    from .discover import listed

    return listed().filter(id=artisan.id).exists()
