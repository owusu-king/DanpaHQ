"""Viewing checkout on the shared provider, ledger and receipt rail."""

import hashlib
from types import SimpleNamespace

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, PermissionDenied, ValidationFailed
from apps.viewing.models import ViewingRequest, ViewingStatus

from .models import (
    OPEN_INTENT_STATUSES,
    AttemptStatus,
    IntentStatus,
    PaymentAllocation,
    PaymentIntent,
    PaymentPurpose,
    PaymentTransaction,
    Receipt,
    TransactionStatus,
)


def assert_payable(viewing):
    from apps.operations.configuration import value

    if value("VIEWING_FEE_MODE", "disabled") == "disabled":
        raise Conflict("Viewing fees are disabled by management.")
    if (
        not viewing.confirmed_at
        or viewing.fee_collection != "platform"
        or not viewing.fee_minor
        or viewing.fee_paid_at
        or viewing.status
        in (ViewingStatus.CANCELLED, ViewingStatus.DECLINED, ViewingStatus.WITHDRAWN)
    ):
        raise Conflict("This viewing has no online fee available to pay.")


def create_intent(*, viewing, user, payment_method):
    from . import services

    intent, resumed = reserve(viewing_id=viewing.id, user=user, payment_method=payment_method)
    if intent.provider_reference and intent.status in OPEN_INTENT_STATUSES:
        return intent
    return services._initiate_reserved_intent(intent=intent, user=user, resumed=resumed)


@transaction.atomic
def reserve(*, viewing_id, user, payment_method):
    from . import services
    from .models import DigitalPaymentMethod
    from .providers import get_payment_provider

    viewing = ViewingRequest.objects.select_for_update().get(pk=viewing_id)
    if viewing.tenant_id != user.id:
        raise PermissionDenied("Only this viewing's tenant may pay its fee.")
    assert_payable(viewing)
    if payment_method not in DigitalPaymentMethod.values:
        raise ValidationFailed("Choose a supported digital payment method.")
    for expired in viewing.fee_intents.select_for_update().filter(
        status__in=OPEN_INTENT_STATUSES, expires_at__lte=timezone.now()
    ):
        services._expire_intent(expired)
    existing = (
        viewing.fee_intents.select_for_update().filter(status__in=OPEN_INTENT_STATUSES).first()
    )
    if existing:
        resumed = services._resume_or_refuse(
            existing=existing,
            user=user,
            payment_method=payment_method,
            amount_minor=viewing.fee_minor,
        )
        if resumed:
            return resumed, True
    provider = get_payment_provider()
    provider.ensure_available()
    from apps.viewing.services import assert_host

    assert_host(viewing, viewing.responded_by)
    routing = services._routing_snapshot(
        provider=provider,
        lease=SimpleNamespace(unit=viewing.listing.unit, landlord=viewing.responded_by),
        amount_minor=viewing.fee_minor,
    )
    intent = PaymentIntent(
        purpose=PaymentPurpose.VIEWING_FEE,
        viewing=viewing,
        tenant=user,
        amount_minor=viewing.fee_minor,
        amount_currency="GHS",
        provider=provider.name,
        payment_method=payment_method,
        expires_at=timezone.now() + services._intent_ttl(),
        metadata={"provider_user_id": str(viewing.responded_by_id)},
        **routing,
    )
    intent.client_reference = f"vwf_{intent.id.hex}"
    intent.save()
    record(
        action=AuditAction.CREATE,
        aggregate_type="payment_intent",
        aggregate_id=intent.id,
        actor=user,
        metadata={
            "viewing_id": str(viewing.id),
            "amount_minor": viewing.fee_minor,
            "currency": "GHS",
            "phase": "reserved",
        },
    )
    return intent, False


def settle(*, intent, event, webhook, **_kwargs):
    from . import services
    from .receipts import render_pdf

    viewing = ViewingRequest.objects.select_for_update().get(pk=intent.viewing_id)
    # An in-flight success remains financial evidence even if the viewing was cancelled.
    if viewing.fee_paid_at:
        raise Conflict("A different payment already settled this viewing fee; reconcile it.")
    if intent.amount_minor != viewing.fee_minor or intent.amount_currency != "GHS":
        raise Conflict("The viewing fee no longer matches the payment; reconcile it.")
    if PaymentTransaction.objects.filter(
        provider=intent.provider, provider_transaction_id=event.provider_transaction_id
    ).exists():
        raise Conflict("That provider transaction was already assigned to another payment.")
    tx = PaymentTransaction.objects.create(
        intent=intent,
        provider=intent.provider,
        provider_transaction_id=event.provider_transaction_id,
        payment_method=intent.payment_method,
        status=TransactionStatus.SUCCEEDED,
        paid_at=event.occurred_at,
        raw_provider_status=event.raw_status[:80],
        amount_minor=intent.amount_minor,
        amount_currency=intent.amount_currency,
    )
    PaymentAllocation.objects.create(
        transaction=tx,
        viewing=viewing,
        amount_minor=tx.amount_minor,
        amount_currency="GHS",
        allocated_at=event.occurred_at,
        note="Provider-confirmed viewing fee",
    )
    viewing.fee_paid_at = event.occurred_at
    viewing.fee_payment_source = "psp"
    viewing.save(update_fields=["fee_paid_at", "fee_payment_source", "updated_at"])
    services._conclude_attempt(intent, AttemptStatus.SUCCEEDED)
    services._cancel_competing_intents(intent)
    services._create_ledger(tx)
    services._create_pending_settlement(tx)
    number = f"VW-{tx.created_at:%Y}-{tx.id.hex[-12:].upper()}"
    from django.contrib.auth import get_user_model

    signer = get_user_model().objects.get(pk=intent.metadata["provider_user_id"])
    unit = viewing.listing.unit
    prop = unit.property
    address = prop.address
    organization = intent.beneficiary_organization
    snapshot = {
        "schema_version": "danpahq.viewing_receipt.v1",
        "receipt_number": number,
        "issued_at": event.occurred_at.isoformat(),
        "tenant": {"account_id": str(viewing.tenant_id), "name": viewing.tenant.display_name},
        "provider": {
            "signer_account_id": str(signer.id),
            "signer_name": signer.display_name,
            "organization_id": str(organization.id) if organization else None,
            "organization_name": organization.name if organization else "",
        },
        "premises": {
            "property_id": str(prop.id),
            "property_title": prop.title,
            "unit_id": str(unit.id),
            "unit_label": unit.label,
            "bed_id": None,
            "bed_label": "",
            "space_type": unit.space_type,
            "space_type_label": unit.get_space_type_display(),
            "is_furnished": unit.is_furnished,
            "address": {
                "display": str(address),
                "house_number": address.house_number,
                "street": address.street,
                "landmark": address.landmark,
                "digital_address": address.digital_address,
                "locality": address.locality_label,
                "district": address.district_label,
                "region": address.region_label,
            },
        },
        "viewing": {"id": str(viewing.id)},
        "obligation": {
            "id": str(viewing.id),
            "kind": "viewing_fee",
            "kind_label": "Viewing fee",
            "due_on": None,
            "period_start": None,
            "period_end": None,
        },
        "payment": {
            "amount_minor": tx.amount_minor,
            "currency": "GHS",
            "paid_at": event.occurred_at.isoformat(),
            "method": tx.payment_method,
            "method_label": tx.get_payment_method_display(),
            "source": "PLATFORM_PSP",
            "source_label": "Processed through Danpa HQ",
        },
        "processor": {
            "name": tx.provider,
            "transaction_id": tx.provider_transaction_id,
            "provider_reference": intent.provider_reference,
        },
        "evidence": {"status": "PSP_CONFIRMED", "label": "Processor confirmed"},
        "stamp": {
            "status": "not_assessed",
            "notice": "This receipt records a viewing fee, separate from rent "
            "and lease activation.",
        },
    }
    document = render_pdf(snapshot)
    Receipt.objects.create(
        transaction=tx,
        receipt_number=number,
        issued_at=event.occurred_at,
        breakdown=snapshot,
        final_pdf=document,
        final_pdf_hash=hashlib.sha256(document).hexdigest(),
    )
    intent.status = IntentStatus.SUCCEEDED
    intent.failure_code = ""
    intent.failure_message = ""
    intent.next_action = {}
    intent.save(
        update_fields=["status", "failure_code", "failure_message", "next_action", "updated_at"]
    )
    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="payment_transaction",
        aggregate_id=tx.id,
        actor=None,
        metadata={
            "viewing_id": str(viewing.id),
            "intent_id": str(intent.id),
            "amount_minor": tx.amount_minor,
            "currency": "GHS",
            "server_confirmed": True,
        },
    )
    services._finish_provider_evidence(webhook)
    return intent
