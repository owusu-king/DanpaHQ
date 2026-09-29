"""Selling a property: its details, its place on the market, and buyers' enquiries.

What may change when follows the property's verification, the way the property's
own details do (see `apps.property.policies.can_edit_property`):

* **Before it is sent** everything is editable — it is still being described.
* **With our team** nothing is, so the reviewer decides what they are reading.
* **Once verified** only the presentation moves: the price, whether it is
  negotiable, the headline and the description. The size, the rooms and the
  tenure are facts the reviewer checked against the title and the photographs,
  and changing one would leave a verified badge on something nobody checked.

Going on or off the market is the seller's call at any time; being *public* also
needs a current verification, which `read_models.public_sales` derives.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.outbox.services import emit

from .models import (
    CommercialUse,
    EnquiryStatus,
    LandSizeUnit,
    SaleEnquiry,
    SaleEnquiryMessage,
    SaleListing,
    SaleStatus,
    Tenure,
)

#: What a verified sale may still change. Everything else was checked.
PRESENTATION_FIELDS = frozenset({"price_minor", "price_negotiable", "headline", "description"})
#: Facts a reviewer read against the title and the photographs.
CHECKED_FIELDS = frozenset(
    {
        "tenure",
        "lease_years_remaining",
        "bedrooms",
        "bathrooms",
        "floor_area_sqm",
        "commercial_use",
        "land_size",
        "land_size_unit",
        "is_serviced",
    }
)
EDITABLE_FIELDS = PRESENTATION_FIELDS | CHECKED_FIELDS

#: A description short enough to say nothing is not a description.
MIN_DESCRIPTION = 40


# --- the sale record ----------------------------------------------------------


def _assert_manages(prop, user) -> None:
    from apps.property.services import assert_can_manage

    assert_can_manage(prop, user)


def sale_for(prop) -> SaleListing:
    sale = SaleListing.objects.filter(property=prop).first()
    if sale is None:
        raise NotFound("This property is not for sale.")
    return sale


@transaction.atomic
def start_sale(*, prop, user, data: dict) -> SaleListing:
    """The sale record, created with its property. Nothing is public yet."""
    if not prop.is_for_sale:
        raise ValidationFailed("Only a property for sale has sale details.")
    sale = SaleListing.objects.create(
        property=prop,
        created_by=user,
        status=SaleStatus.ACTIVE,
        status_changed_at=timezone.now(),
    )
    if data:
        _apply(sale, _clean(sale, data, allowed=EDITABLE_FIELDS))
    _apply_public_location(sale)
    sale.save()
    return sale


def _editable_fields(prop) -> frozenset[str]:
    """Which fields this sale may change right now, decided by its verification."""
    from apps.property.verification import (
        OPEN_STATES,
        WITH_REVIEWER,
        PropertyVerificationState,
        lifecycle,
    )

    state = lifecycle(prop)["state"]
    if state in WITH_REVIEWER:
        return frozenset()
    if state == PropertyVerificationState.VERIFIED:
        return PRESENTATION_FIELDS
    if state in OPEN_STATES:
        return EDITABLE_FIELDS
    # Suspended: our team withdrew the verification. Nothing moves until they
    # have been spoken to — the same rule the property's own details follow.
    return frozenset()


@transaction.atomic
def update_sale(*, prop, user, data: dict) -> SaleListing:
    """Correct what may still be corrected. Refuses the rest, by name."""
    _assert_manages(prop, user)
    sale = SaleListing.objects.select_for_update().get(id=sale_for(prop).id)
    if sale.status == SaleStatus.SOLD:
        raise Conflict("This property has been sold, so its details are final.")

    allowed = _editable_fields(prop)
    asked = {key for key in data if key in EDITABLE_FIELDS}
    refused = asked - allowed
    if refused and not allowed:
        raise Conflict("This property is with our team, so nothing about it can change right now.")
    if refused:
        raise Conflict(
            "This property has been verified, so only its price, headline and description "
            "can change. Its size, rooms and tenure were checked against its title."
        )

    changes = _clean(sale, data, allowed=allowed)
    before = {key: getattr(sale, key) for key in changes}
    _apply(sale, changes)
    sale.save()

    diff = {
        key: [_plain(before[key]), _plain(value)]
        for key, value in changes.items()
        if before[key] != value
    }
    if diff:
        record(
            action=AuditAction.UPDATE,
            aggregate_type="property",
            aggregate_id=prop.id,
            actor=user,
            changes=diff,
            metadata={"sale_id": str(sale.id)},
        )
    return sale


def _plain(value):
    return str(value) if isinstance(value, Decimal) else value


def _apply(sale: SaleListing, changes: dict) -> None:
    for key, value in changes.items():
        setattr(sale, key, value)


def _clean(sale: SaleListing, data: dict, *, allowed) -> dict:
    """The accepted values from `data`, validated. Unknown keys are ignored."""
    out: dict = {}
    for key in allowed:
        if key not in data:
            continue
        value = data[key]
        if key == "price_minor":
            out[key] = _positive_int(value, "Give a price above zero.")
        elif key == "price_negotiable" or key == "is_serviced":
            out[key] = None if value is None and key == "is_serviced" else bool(value)
        elif key == "headline":
            out[key] = str(value or "").strip()[:160]
        elif key == "description":
            out[key] = str(value or "").strip()[:3000]
        elif key == "tenure":
            out[key] = _choice(value, Tenure, "Choose freehold, leasehold or customary land.")
        elif key == "lease_years_remaining":
            out[key] = (
                None
                if value in (None, "")
                else _positive_int(value, "Say how many years are left on the lease.", maximum=999)
            )
        elif key in {"bedrooms", "bathrooms"}:
            out[key] = None if value in (None, "") else _count(value, key)
        elif key in {"floor_area_sqm", "land_size"}:
            out[key] = None if value in (None, "") else _decimal(value, key)
        elif key == "commercial_use":
            out[key] = _choice(value, CommercialUse, "Choose what the building is used for.")
        elif key == "land_size_unit":
            out[key] = _choice(value, LandSizeUnit, "Choose plots, acres or square metres.")
    return out


def _positive_int(value, message: str, *, maximum: int | None = None) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationFailed(message) from exc
    if number <= 0 or (maximum is not None and number > maximum):
        raise ValidationFailed(message)
    return number


def _count(value, key: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationFailed(f"Give the number of {key}.") from exc
    if number < 0 or number > 50:
        raise ValidationFailed(f"Give the number of {key}, from 0 to 50.")
    return number


def _decimal(value, key: str) -> Decimal:
    label = "floor area" if key == "floor_area_sqm" else "land size"
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValidationFailed(f"Give the {label} as a number.") from exc
    if number <= 0:
        raise ValidationFailed(f"Give a {label} above zero.")
    return (
        number.quantize(Decimal("0.001"))
        if key == "land_size"
        else number.quantize(Decimal("0.01"))
    )


def _choice(value, choices, message: str) -> str:
    value = str(value or "").strip()
    if value == "":
        return ""
    if value not in choices.values:
        raise ValidationFailed(message)
    return value


def _apply_public_location(sale: SaleListing) -> None:
    from apps.listing.location import public_location_for_property

    point, precision = public_location_for_property(sale.property)
    sale.public_point = point
    sale.public_point_precision = precision


# --- what setup still needs ----------------------------------------------------


def sale_blockers(prop) -> list[dict]:
    """What the sale details still need before the property can be sent.

    Each entry is `{"field", "message"}` — named, because "not finished" tells a
    seller nothing about which of six things is missing. Asked of the kind of
    property it is: a house has rooms, land has a size, a commercial building a
    use and a floor area.
    """
    sale = SaleListing.objects.filter(property=prop).first()
    if sale is None:
        return [{"field": "sale", "message": "The sale details have not been started."}]

    missing: list[dict] = []

    def need(field: str, message: str) -> None:
        missing.append({"field": field, "message": message})

    if not sale.price_minor:
        need("price_minor", "Give the asking price.")
    if not sale.headline:
        need("headline", "Give it a headline buyers will read first.")
    if len(sale.description) < MIN_DESCRIPTION:
        need("description", f"Describe it in at least {MIN_DESCRIPTION} characters.")
    if not sale.tenure:
        need("tenure", "Say whether it is freehold, leasehold or customary land.")
    elif sale.tenure == Tenure.LEASEHOLD and not sale.lease_years_remaining:
        need("lease_years_remaining", "Say how many years are left on the lease.")

    kind = prop.property_type
    if kind == "land":
        if not sale.land_size:
            need("land_size", "Give the size of the land.")
        if not sale.land_size_unit:
            need("land_size_unit", "Say whether the size is in plots, acres or square metres.")
    elif kind == "commercial":
        if not sale.commercial_use:
            need("commercial_use", "Say what the building is used for.")
        if not sale.floor_area_sqm:
            need("floor_area_sqm", "Give the floor area.")
    else:
        if sale.bedrooms is None:
            need("bedrooms", "Give the number of bedrooms.")
        if sale.bathrooms is None:
            need("bathrooms", "Give the number of bathrooms.")
    return missing


# --- on and off the market ----------------------------------------------------


def _set_status(*, prop, user, to: str, allowed_from: set[str], message: str) -> SaleListing:
    _assert_manages(prop, user)
    sale = SaleListing.objects.select_for_update().get(id=sale_for(prop).id)
    if sale.status == to:
        return sale
    if sale.status not in allowed_from:
        raise Conflict(message)
    before = sale.status
    sale.status = to
    sale.status_changed_at = timezone.now()
    sale.save(update_fields=["status", "status_changed_at", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        aggregate_type="property",
        aggregate_id=prop.id,
        actor=user,
        changes={"sale_status": [before, to]},
        metadata={"sale_id": str(sale.id)},
    )
    emit(
        DomainEvent(
            "sale.status_changed.v1",
            "property",
            str(prop.id),
            {"sale_id": str(sale.id), "from": before, "to": to},
        )
    )
    return sale


@transaction.atomic
def withdraw_sale(*, prop, user) -> SaleListing:
    """Take it off the market. Verification is kept; it can come back."""
    return _set_status(
        prop=prop,
        user=user,
        to=SaleStatus.WITHDRAWN,
        allowed_from={SaleStatus.ACTIVE},
        message="This property has been sold.",
    )


@transaction.atomic
def relist_sale(*, prop, user) -> SaleListing:
    """Back on the market — and public again at once, if it is still verified."""
    return _set_status(
        prop=prop,
        user=user,
        to=SaleStatus.ACTIVE,
        allowed_from={SaleStatus.WITHDRAWN},
        message="This property has been sold, so it cannot go back on the market.",
    )


@transaction.atomic
def mark_sold(*, prop, user) -> SaleListing:
    """Sold. Final: it leaves the market and its open enquiries close."""
    sale = _set_status(
        prop=prop,
        user=user,
        to=SaleStatus.SOLD,
        allowed_from={SaleStatus.ACTIVE, SaleStatus.WITHDRAWN},
        message="This property has already been sold.",
    )
    SaleEnquiry.objects.filter(sale=sale, status=EnquiryStatus.OPEN).update(
        status=EnquiryStatus.CLOSED
    )
    return sale


# --- buyers' enquiries ---------------------------------------------------------


def _is_seller(sale: SaleListing, user) -> bool:
    from apps.organization.services import can_manage_property

    return bool(
        user.is_authenticated
        and (user.is_staff or can_manage_property(prop=sale.property, user=user))
    )


def _clean_body(body: str) -> str:
    text = str(body or "").strip()
    if not text:
        raise ValidationFailed("Write a message.")
    if len(text) > 2000:
        raise ValidationFailed("Keep a message under 2,000 characters.")
    return text


@transaction.atomic
def start_enquiry(*, sale_id, buyer, body: str) -> SaleEnquiry:
    """A buyer asks about a property that is publicly for sale.

    Only one that is public: an enquiry is a question about an advertisement,
    and a property that is not advertised has nothing to ask about. A buyer who
    has asked before continues the same conversation.
    """
    from .read_models import public_sales

    sale = public_sales().filter(id=sale_id).select_related("property").first()
    if sale is None:
        raise NotFound("This property is not for sale right now.")
    if _is_seller(sale, buyer):
        raise PermissionDenied("You are selling this property.")
    text = _clean_body(body)

    enquiry, created = SaleEnquiry.objects.select_for_update().get_or_create(
        sale=sale, buyer=buyer, defaults={"status": EnquiryStatus.OPEN}
    )
    if enquiry.status == EnquiryStatus.CLOSED:
        enquiry.status = EnquiryStatus.OPEN
    _post(enquiry, author=buyer, body=text, from_buyer=True)
    if created:
        emit(
            DomainEvent(
                "sale.enquiry_received.v1",
                "sale_enquiry",
                str(enquiry.id),
                {"sale_id": str(sale.id), "property_id": str(sale.property_id)},
            )
        )
    return enquiry


def enquiry_for(*, enquiry_id, user) -> SaleEnquiry:
    """An enquiry its buyer or its seller may read. Anyone else gets a 404."""
    enquiry = (
        SaleEnquiry.objects.select_related("sale__property__address__locality", "buyer")
        .filter(id=enquiry_id)
        .first()
    )
    if enquiry is None or not (enquiry.buyer_id == user.id or _is_seller(enquiry.sale, user)):
        raise NotFound("We could not find that enquiry.")
    return enquiry


@transaction.atomic
def reply(*, enquiry_id, user, body: str) -> SaleEnquiryMessage:
    """Either side answers. A sold property's conversation is closed."""
    enquiry = enquiry_for(enquiry_id=enquiry_id, user=user)
    enquiry = SaleEnquiry.objects.select_for_update().get(id=enquiry.id)
    if enquiry.sale.status == SaleStatus.SOLD:
        raise Conflict("This property has been sold, so this conversation is closed.")
    from_buyer = enquiry.buyer_id == user.id
    message = _post(enquiry, author=user, body=_clean_body(body), from_buyer=from_buyer)
    emit(
        DomainEvent(
            "sale.enquiry_replied.v1",
            "sale_enquiry",
            str(enquiry.id),
            {"message_id": str(message.id), "from_buyer": from_buyer},
        )
    )
    return message


def _post(enquiry: SaleEnquiry, *, author, body: str, from_buyer: bool) -> SaleEnquiryMessage:
    now = timezone.now()
    message = SaleEnquiryMessage.objects.create(enquiry=enquiry, author=author, body=body)
    enquiry.last_message_at = now
    # Writing is reading: whoever wrote has seen everything up to their message.
    if from_buyer:
        enquiry.buyer_read_at = now
    else:
        enquiry.seller_read_at = now
    enquiry.save(
        update_fields=["status", "last_message_at", "buyer_read_at", "seller_read_at", "updated_at"]
    )
    return message


def mark_enquiry_read(*, enquiry: SaleEnquiry, user) -> None:
    field = "buyer_read_at" if enquiry.buyer_id == user.id else "seller_read_at"
    SaleEnquiry.objects.filter(id=enquiry.id).update(**{field: timezone.now()})


def enquiries_for_seller(user):
    """Every enquiry on a property this person may sell, newest conversation first."""
    from apps.organization.services import can_manage_property

    rows = SaleEnquiry.objects.select_related(
        "sale__property__address__locality", "buyer"
    ).order_by("-last_message_at", "-created_at")
    # Managing a property is decided per property (Portfolio roles, assignments),
    # so this narrows to the sales first and asks once per property.
    sale_ids = [
        sale.id
        for sale in SaleListing.objects.select_related("property").filter(
            id__in=rows.values("sale_id")
        )
        if can_manage_property(prop=sale.property, user=user)
    ]
    return rows.filter(sale_id__in=sale_ids)


def enquiries_for_buyer(user):
    return (
        SaleEnquiry.objects.select_related("sale__property__address__locality", "buyer")
        .filter(buyer=user)
        .order_by("-last_message_at", "-created_at")
    )
