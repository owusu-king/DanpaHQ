"""What each party reads about artisan work. Privacy is decided here.

Three readers, three views of the same request:

* **An invited artisan** reads the kind of problem, what the tenant wrote, the
  photograph and the area (locality, district, region). Never the address,
  the tenant's name or a phone number.
* **The assigned artisan** — and only once the payer approved their quote —
  also reads the address, the unit, the contact on site (the tenant, with a
  phone number), who approved them, and the request's history.
* **The people who run or pay for the property** read every invitation and
  quote. **The tenant** reads who is doing the repair, and never the price —
  the payer's money is the payer's business.
"""

from __future__ import annotations

from apps.core.money import Money

from .models import Quote, QuoteInvitation, QuoteStatus
from .quotes import MAX_OPEN_INVITATIONS, _pays, _runs
from .serializers import inline_photo_url


def _media(file) -> dict | None:
    """The request's own photograph, signed for an invited artisan to see."""
    from apps.maintenance.serializers import _media as maintenance_media

    return maintenance_media(file)


def _quote(quote: Quote) -> dict:
    return {
        "id": str(quote.id),
        "status": quote.status,
        "status_display": quote.get_status_display(),
        "price_minor": quote.price_minor,
        "price_display": Money(quote.price_minor).format(),
        "scope": quote.scope,
        "materials": quote.materials,
        "revises": str(quote.revises_id) if quote.revises_id else None,
        "reason": quote.reason,
        "decision_note": quote.decision_note,
        "created_at": quote.created_at,
        "decided_at": quote.decided_at,
    }


def _area(request) -> dict:
    address = request.property.address
    return {
        "locality": address.locality_label,
        "district": address.district_label,
        "region": address.region_label,
    }


def _invitation_state(invitation: QuoteInvitation, request) -> str:
    if request.assigned_artisan_id == invitation.artisan_id:
        return "assigned"
    if invitation.declined_at:
        return "declined"
    if invitation.closed_at or request.assigned_artisan_id:
        return "closed"
    if invitation.invited_at is None:
        return "suggested"
    if any(quote.status == QuoteStatus.SUBMITTED for quote in invitation.quotes.all()):
        return "quoted"
    return "invited"


# --- the artisan's side ------------------------------------------------------------


def artisan_view(invitation: QuoteInvitation) -> dict:
    """One request as an artisan reads it. Unlocked only on their own assignment."""
    request = invitation.maintenance_request
    state = _invitation_state(invitation, request)
    unlocked = state == "assigned"
    view = {
        "id": str(invitation.id),
        "state": state,
        "invited_at": invitation.invited_at,
        "request": {
            "id": str(request.id),
            "category": request.category,
            "category_display": request.get_category_display(),
            "description": request.description,
            "photo": _media(request.photo),
            "reported_at": request.created_at,
            "status": request.status,
            "status_display": request.get_status_display(),
            "area": _area(request),
        },
        "quotes": [_quote(quote) for quote in invitation.quotes.all()],
        "unlocked": unlocked,
    }
    if not unlocked:
        return view

    from apps.core.phone import format_national

    address = request.property.address
    approved = request.assigned_quote
    view["job"] = {
        "address": {
            "line": str(address),
            "street": address.street,
            "house_number": address.house_number,
            "digital_address": address.digital_address,
            "landmark": address.landmark,
        },
        "place": {"property_title": request.property.title, "unit_label": request.unit.label},
        "contact": {
            "name": request.tenant.display_name,
            "phone": format_national(request.tenant.phone) if request.tenant.phone else "",
            "role": "Tenant, on site",
        },
        "approved_by": approved.decided_by.display_name
        if approved and approved.decided_by_id
        else "",
        "approved_at": approved.decided_at if approved else None,
        "price_on_record": _quote(approved) if approved else None,
        "history": [
            {
                "kind": event.kind,
                "kind_display": event.get_kind_display(),
                "note": event.note,
                "at": event.created_at,
            }
            for event in request.events.all()
        ],
    }
    return view


def _artisan_rows(user, *, assigned: bool):
    rows = (
        QuoteInvitation.objects.filter(artisan__user=user, invited_at__isnull=False)
        .select_related(
            "maintenance_request__property__address__locality__district__region",
            "maintenance_request__tenant",
            "maintenance_request__unit",
            "maintenance_request__photo",
            "maintenance_request__assigned_quote__decided_by",
        )
        .prefetch_related("quotes", "maintenance_request__events")
        .order_by("-invited_at")
    )
    if assigned:
        return rows.filter(maintenance_request__assigned_artisan__user=user)
    return rows.exclude(maintenance_request__assigned_artisan__user=user)


def my_invitations(user) -> list[dict]:
    return [artisan_view(row) for row in _artisan_rows(user, assigned=False)[:100]]


def my_jobs(user) -> list[dict]:
    return [artisan_view(row) for row in _artisan_rows(user, assigned=True)[:100]]


def my_invitation(user, invitation_id) -> dict:
    row = (
        _artisan_rows(user, assigned=False).filter(id=invitation_id).first()
        or _artisan_rows(user, assigned=True).filter(id=invitation_id).first()
    )
    if row is None:
        from apps.core.exceptions import NotFound

        raise NotFound("We could not find that invitation.")
    return artisan_view(row)


# --- the customer's side -----------------------------------------------------------


def _artisan_card(profile) -> dict:
    photos = list(profile.portfolio.all())
    return {
        "id": str(profile.id),
        "name": profile.user.display_name,
        "trades": [{"value": trade, "label": label} for trade, label in _labels(profile.trades)],
        "cover_url": inline_photo_url(photos[0].file) if photos else None,
    }


def _labels(trades):
    from .models import Trade

    names = dict(Trade.choices)
    return [(trade, names.get(trade, trade)) for trade in trades]


def work_for(request, user) -> dict:
    """The artisan block of a maintenance request, for whoever is reading it."""
    runs = _runs(request, user)
    pays = _pays(request, user)
    tenant = str(request.tenant_id) == str(user.id)
    invitations = list(
        QuoteInvitation.objects.filter(maintenance_request=request)
        .select_related("artisan__user")
        .prefetch_related("quotes", "artisan__portfolio__file")
        .order_by("created_at")
    )
    assigned = request.assigned_artisan
    open_now = request.is_open and not request.assigned_artisan_id
    open_invitations = sum(1 for row in invitations if row.is_open)

    if runs or pays:
        rows = [
            {
                "id": str(row.id),
                "state": _invitation_state(row, request),
                "artisan": _artisan_card(row.artisan),
                "suggested_by_tenant": bool(row.suggested_by_id),
                "quotes": [_quote(quote) for quote in row.quotes.all()],
            }
            for row in invitations
        ]
    else:
        # The tenant sees who they suggested and who is doing the work; prices
        # and other people's quotes are the payer's.
        rows = [
            {
                "id": str(row.id),
                "state": _invitation_state(row, request),
                "artisan": _artisan_card(row.artisan),
                "suggested_by_tenant": bool(row.suggested_by_id),
                "quotes": [],
            }
            for row in invitations
            if row.suggested_by_id == user.id or row.artisan_id == request.assigned_artisan_id
        ]

    return {
        "assigned": None
        if assigned is None
        else {
            "artisan": _artisan_card(assigned),
            "assigned_at": request.assigned_at,
            "price_on_record": _quote(request.assigned_quote)
            if (runs or pays) and request.assigned_quote_id
            else None,
        },
        "invitations": rows,
        "permissions": {
            "invite": runs and open_now and open_invitations < MAX_OPEN_INVITATIONS,
            "approve": pays,
            "suggest": tenant and open_now,
        },
        "max_open_invitations": MAX_OPEN_INVITATIONS,
    }


def customer_overview(user) -> dict:
    """Artisans' sheet: Requests (quotes asked for and waiting) and Records (jobs).

    A provider reads the requests on properties they run; a tenant reads their
    own requests, without prices.
    """
    from apps.maintenance.models import MaintenanceRequest
    from apps.organization.services import properties_for_user

    rows = (
        MaintenanceRequest.objects.filter(quote_invitations__isnull=False)
        .filter(_customer_scope(user, properties_for_user))
        .select_related("property", "unit", "assigned_artisan__user", "assigned_quote")
        .distinct()
        .order_by("-status_changed_at")[:100]
    )
    requests, records = [], []
    for request in rows:
        block = work_for(request, user)
        summary = {
            "request": {
                "id": str(request.id),
                "category_display": request.get_category_display(),
                "status": request.status,
                "status_display": request.get_status_display(),
                "place": f"{request.unit.label} · {request.property.title}",
            },
            **block,
        }
        (records if request.assigned_artisan_id else requests).append(summary)
    return {"requests": requests, "records": records}


def _customer_scope(user, properties_for_user):
    from django.db.models import Q

    return Q(tenant=user) | Q(property__in=properties_for_user(user))
