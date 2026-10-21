"""Quotes: who may ask, answer, approve, and see what.

A quote is always *for* something, and there are two kinds of something:

* **A repair** — a maintenance request on a rented home. The request stays the
  record; this module hands the assignment back to ``maintenance.services`` so
  status remains maintenance's. Anyone who runs the property invites; the
  tenant may only *suggest*; the payer approves — the owner, a Portfolio owner
  or administrator, or the assigned Property Manager
  (``organization.services.may_approve_spending``).
* **A direct job** — work a tenant or provider posted for themselves
  (``DirectJob``), with no property and no repair behind it. Whoever posted it
  is its payer: they invite, approve and decline.

Everything else is the same for both, which is why it is written once against
``_Subject``: up to three open invitations; one pending quote per invitation;
an approved, unsuspended artisan quotes; approval assigns; extra cost is a
revised quote that counts only once the payer approves it; a suspended artisan
can neither quote nor be approved.

### What an artisan sees

Invited, they see what needs doing, its photograph and the area — locality and
district — and never the address, a name or a phone number. Those open only on
the repair or job they were assigned, once the payer approved their quote.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.core.money import Money
from apps.outbox.services import emit

from .models import ArtisanProfile, DirectJob, DirectJobStatus, Quote, QuoteInvitation, QuoteStatus
from .services import require_working_artisan

#: "Invite two or three artisans to quote." More is a broadcast, not a choice.
MAX_OPEN_INVITATIONS = 3
MAX_MATERIALS = 20


# --- what a quote is for -------------------------------------------------------------


@dataclass
class _Subject:
    """A repair or a direct job, seen through what quoting needs of it."""

    kind: str  # "maintenance" | "direct_job"
    record: Any

    @property
    def noun(self) -> str:
        return "repair" if self.kind == "maintenance" else "job"

    @property
    def link(self) -> dict:
        """The invitation field that points at this subject."""
        return {self.field: self.record}

    @property
    def field(self) -> str:
        return "maintenance_request" if self.kind == "maintenance" else "direct_job"

    @property
    def payload(self) -> dict:
        return {self.field: str(self.record.id)}

    def is_open(self) -> bool:
        return self.record.is_open

    def may_invite(self, user) -> bool:
        if self.kind == "maintenance":
            from apps.maintenance.services import is_provider_for

            return is_provider_for(request=self.record, user=user)
        return self.record.owner_id == user.id

    def may_pay(self, user) -> bool:
        if self.kind == "maintenance":
            from apps.organization.services import may_approve_spending

            return may_approve_spending(prop=self.record.property, user=user)
        return self.record.owner_id == user.id

    def assign(self, *, quote, approver, note: str) -> None:
        if self.kind == "maintenance":
            from apps.maintenance import services as maintenance_services

            maintenance_services.assign_artisan(
                request=self.record, quote=quote, approver=approver, note=note
            )
            return
        job = self.record
        job.assigned_artisan = quote.invitation.artisan
        job.assigned_quote = quote
        job.assigned_at = timezone.now()
        job.status = DirectJobStatus.ASSIGNED
        job.save(
            update_fields=[
                "assigned_artisan",
                "assigned_quote",
                "assigned_at",
                "status",
                "updated_at",
            ]
        )

    def record_revision(self, *, quote, approver, note: str) -> None:
        if self.kind == "maintenance":
            from apps.maintenance import services as maintenance_services

            maintenance_services.record_revision(
                request=self.record, quote=quote, approver=approver, note=note
            )
            return
        self.record.assigned_quote = quote
        self.record.save(update_fields=["assigned_quote", "updated_at"])


def _maintenance(request_id, *, lock: bool = False) -> _Subject:
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
    return _Subject("maintenance", request)


def _direct_job(job_id, *, lock: bool = False) -> _Subject:
    rows = DirectJob.objects.select_related(
        "owner", "locality__district__region", "assigned_artisan__user", "assigned_quote"
    )
    if lock:
        rows = rows.select_for_update(of=("self",))
    job = rows.filter(id=job_id).first()
    if job is None:
        raise NotFound("We could not find that job.")
    return _Subject("direct_job", job)


def _subject_of(invitation: QuoteInvitation, *, lock: bool = False) -> _Subject:
    if invitation.maintenance_request_id:
        return _maintenance(invitation.maintenance_request_id, lock=lock)
    return _direct_job(invitation.direct_job_id, lock=lock)


def _listed_artisan(artisan_id) -> ArtisanProfile:
    from .discover import listed

    artisan = listed().select_related("user").filter(id=artisan_id).first()
    if artisan is None:
        raise NotFound("We could not find that artisan.")
    return artisan


def _still_open(subject: _Subject) -> None:
    if not subject.is_open():
        raise Conflict(f"This {subject.noun} is already finished.")


def _money(minor: int) -> str:
    return Money(int(minor)).format()


# --- asking ---------------------------------------------------------------------


@transaction.atomic
def invite(*, user, request_id, artisan_id) -> QuoteInvitation:
    return _invite(subject=_maintenance(request_id, lock=True), user=user, artisan_id=artisan_id)


@transaction.atomic
def invite_to_job(*, user, job_id, artisan_id) -> QuoteInvitation:
    return _invite(subject=_direct_job(job_id, lock=True), user=user, artisan_id=artisan_id)


@transaction.atomic
def _invite(*, subject: _Subject, user, artisan_id) -> QuoteInvitation:
    if not subject.may_invite(user):
        if subject.kind == "direct_job":
            raise NotFound("We could not find that job.")
        raise PermissionDenied("Only the people who run this property can invite artisans.")
    _still_open(subject)
    if subject.record.assigned_artisan_id:
        raise Conflict(f"An artisan is already doing this {subject.noun}.")
    artisan = _listed_artisan(artisan_id)
    if artisan.user_id == user.id:
        raise ValidationFailed("You cannot invite yourself to quote.")

    open_count = QuoteInvitation.objects.filter(
        **subject.link,
        invited_at__isnull=False,
        declined_at__isnull=True,
        closed_at__isnull=True,
    ).count()
    if open_count >= MAX_OPEN_INVITATIONS:
        raise Conflict(
            f"Up to {MAX_OPEN_INVITATIONS} artisans can be asked at once. "
            "Wait for an answer, or decline a quote first."
        )

    invitation, _ = QuoteInvitation.objects.get_or_create(**subject.link, artisan=artisan)
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
        metadata={**subject.payload, "artisan": str(artisan.id)},
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
    subject = _maintenance(request_id, lock=True)
    request = subject.record
    if str(request.tenant_id) != str(user.id):
        raise PermissionDenied("Only the tenant who reported this can suggest an artisan.")
    _still_open(subject)
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
    rows = QuoteInvitation.objects.select_related("artisan")
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
    subject = _subject_of(invitation, lock=True)
    _still_open(subject)
    if subject.record.assigned_artisan_id:
        raise Conflict(f"Another artisan is already doing this {subject.noun}.")
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
        metadata={**subject.payload, "price_minor": price},
    )
    emit(
        DomainEvent(
            "artisan.quote_submitted.v1",
            "artisan_quote",
            str(quote.id),
            {**subject.payload, "revision": False},
        )
    )
    return quote


@transaction.atomic
def submit_revision(*, user, request_id, price_minor, scope, reason, materials=None) -> Quote:
    return _revise(
        subject=_maintenance(request_id, lock=True),
        user=user,
        price_minor=price_minor,
        scope=scope,
        reason=reason,
        materials=materials,
    )


@transaction.atomic
def submit_job_revision(*, user, job_id, price_minor, scope, reason, materials=None) -> Quote:
    return _revise(
        subject=_direct_job(job_id, lock=True),
        user=user,
        price_minor=price_minor,
        scope=scope,
        reason=reason,
        materials=materials,
    )


@transaction.atomic
def _revise(*, subject: _Subject, user, price_minor, scope, reason, materials) -> Quote:
    """Extra cost on work already held. Counts for nothing until the payer approves."""
    require_working_artisan(user)
    held = subject.record.assigned_artisan
    if held is None or held.user_id != user.id:
        raise NotFound("We could not find that job.")
    _still_open(subject)
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise ValidationFailed("Say what you found that changes the price.")
    on_record = subject.record.assigned_quote
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
        metadata={**subject.payload, "revises": str(on_record.id), "price_minor": price},
    )
    emit(
        DomainEvent(
            "artisan.quote_submitted.v1",
            "artisan_quote",
            str(quote.id),
            {**subject.payload, "revision": True},
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


def _quote_for_payer(*, user, quote_id) -> tuple[Quote, _Subject]:
    quote = (
        Quote.objects.select_for_update(of=("self",))
        .select_related("invitation__artisan__user", "revises")
        .filter(id=quote_id)
        .first()
    )
    if quote is None:
        raise NotFound("We could not find that quote.")
    subject = _subject_of(quote.invitation, lock=True)
    if not subject.may_invite(user) and not subject.may_pay(user):
        raise NotFound("We could not find that quote.")
    if not subject.may_pay(user):
        raise PermissionDenied(
            "Only the owner, a Portfolio owner or administrator, or the Property Manager "
            "assigned to this property can approve spending."
        )
    if quote.status != QuoteStatus.SUBMITTED:
        raise Conflict("This quote has already been answered.")
    return quote, subject


@transaction.atomic
def approve_quote(*, user, quote_id) -> Quote:
    quote, subject = _quote_for_payer(user=user, quote_id=quote_id)
    _still_open(subject)
    artisan = quote.invitation.artisan
    now = timezone.now()

    if quote.revises_id is None:
        if subject.record.assigned_artisan_id:
            raise Conflict(f"An artisan is already doing this {subject.noun}.")
        # Suspension stops new assignments at once, even for a quote sent before it.
        if not _is_working(artisan):
            raise Conflict("This artisan cannot take on new work right now.")
        quote.status = QuoteStatus.APPROVED
        quote.decided_by, quote.decided_at = user, now
        quote.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        # Everybody else asked is told the work went elsewhere.
        others = QuoteInvitation.objects.filter(**subject.link).exclude(id=quote.invitation_id)
        Quote.objects.filter(invitation__in=others, status=QuoteStatus.SUBMITTED).update(
            status=QuoteStatus.DECLINED,
            decided_at=now,
            decision_note="Another artisan was chosen.",
        )
        others.filter(closed_at__isnull=True).update(closed_at=now)
        subject.assign(
            quote=quote,
            approver=user,
            note=f"{artisan.user.display_name} approved at {_money(quote.price_minor)} "
            f"by {user.display_name}.",
        )
        event = "artisan.quote_approved.v1"
    else:
        if subject.record.assigned_quote_id != quote.revises_id:
            raise Conflict("This revision is for a price that is no longer on record.")
        quote.status = QuoteStatus.APPROVED
        quote.decided_by, quote.decided_at = user, now
        quote.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        Quote.objects.filter(id=quote.revises_id).update(status=QuoteStatus.SUPERSEDED)
        subject.record_revision(
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
        metadata={**subject.payload, "price_minor": quote.price_minor},
    )
    emit(
        DomainEvent(
            event,
            "artisan_quote",
            str(quote.id),
            {"user_id": str(artisan.user_id), **subject.payload},
        )
    )
    return quote


@transaction.atomic
def decline_quote(*, user, quote_id, note: str = "") -> Quote:
    quote, subject = _quote_for_payer(user=user, quote_id=quote_id)
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
        metadata=subject.payload,
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
