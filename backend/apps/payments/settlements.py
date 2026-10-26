"""Import provider payout facts without confusing them with payment success."""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import timedelta

from django.db import transaction

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.events import DomainEvent
from apps.core.exceptions import PermissionDenied, ProviderUnavailable, ValidationFailed
from apps.outbox.services import emit

from .models import (
    ProviderFeeBearer,
    ReconciliationKind,
    Settlement,
    SettlementStatus,
)
from .providers import ProviderSettlementBatch, ProviderSettlementTransaction, get_payment_provider
from .reconciliation import open_exception

logger = logging.getLogger("payments.settlements")


def import_provider_settlements(*, limit: int = 200) -> int:
    """Import batch settlements and return the number truthfully confirmed.

    A successful Paystack charge says the tenant paid. Only a successful batch
    containing that exact provider transaction says the Portfolio was paid.
    Those are separate facts and this importer is the boundary between them.
    """
    pending = list(
        Settlement.objects.filter(status=SettlementStatus.PENDING)
        .select_related("transaction__intent", "payout_profile")
        .order_by("created_at")[:limit]
    )
    grouped: dict[tuple[str, str], list[Settlement]] = defaultdict(list)
    for settlement in pending:
        if settlement.provider_subaccount_id:
            grouped[(settlement.provider, settlement.provider_subaccount_id)].append(settlement)

    confirmed = 0
    for (provider_name, provider_account_id), rows in grouped.items():
        try:
            provider = get_payment_provider(provider_name)
            if provider.settlement_mode != "batch":
                continue
            since = min(row.created_at for row in rows) - timedelta(days=1)
            batches = provider.list_settlement_batches(
                since=since, provider_account_id=provider_account_id
            )
        except (ProviderUnavailable, PermissionDenied, ValidationFailed) as exc:
            logger.warning(
                "settlement batch import unavailable",
                extra={
                    "event": "settlement_batch_import_unavailable",
                    "provider": provider_name,
                    "provider_account_id": provider_account_id,
                    "detail": str(exc),
                },
            )
            continue

        by_transaction = {row.transaction.provider_transaction_id: row for row in rows}
        for batch in batches:
            if batch.status != SettlementStatus.SETTLED:
                continue
            for item in batch.transactions:
                settlement = by_transaction.get(item.provider_transaction_id)
                if settlement is None:
                    continue
                if _import_item(settlement=settlement, batch=batch, item=item):
                    confirmed += 1
                    by_transaction.pop(item.provider_transaction_id, None)
    return confirmed


def _import_item(
    *,
    settlement: Settlement,
    batch: ProviderSettlementBatch,
    item: ProviderSettlementTransaction,
) -> bool:
    transaction_row = settlement.transaction
    intent = transaction_row.intent
    currency = item.currency or batch.currency
    problems = {}
    if item.amount_minor != transaction_row.amount_minor:
        problems["amount_minor"] = {
            "danpahq": transaction_row.amount_minor,
            "provider": item.amount_minor,
        }
    if currency != transaction_row.amount_currency:
        problems["currency"] = {
            "danpahq": transaction_row.amount_currency,
            "provider": currency,
        }
    if batch.settled_at is None:
        problems["settled_at"] = {"danpahq": None, "provider": None}

    provider_fee = (
        item.provider_fee_minor if intent.provider_fee_bearer == ProviderFeeBearer.SUBACCOUNT else 0
    )
    total_fee = intent.platform_charge_minor + provider_fee
    net_minor = transaction_row.amount_minor - total_fee
    if net_minor < 0:
        problems["net_minor"] = {
            "gross": transaction_row.amount_minor,
            "platform_charge": intent.platform_charge_minor,
            "provider_fee": provider_fee,
        }

    if problems:
        open_exception(
            kind=ReconciliationKind.SETTLEMENT_AMOUNT_MISMATCH,
            provider=settlement.provider,
            provider_reference=batch.provider_settlement_reference,
            settlement=settlement,
            transaction_row=transaction_row,
            detail=problems,
        )
        return False
    return _confirm_settlement(
        settlement_id=settlement.id,
        batch=batch,
        total_fee=total_fee,
        net_minor=net_minor,
    )


@transaction.atomic
def _confirm_settlement(
    *, settlement_id, batch: ProviderSettlementBatch, total_fee: int, net_minor: int
) -> bool:
    settlement = (
        Settlement.objects.select_for_update()
        .select_related("transaction")
        .filter(id=settlement_id)
        .first()
    )
    if settlement is None or settlement.status != SettlementStatus.PENDING:
        return False

    settlement.provider_settlement_reference = batch.provider_settlement_reference[:120]
    settlement.status = SettlementStatus.SETTLED
    settlement.settled_at = batch.settled_at
    settlement.gross_amount_minor = settlement.transaction.amount_minor
    settlement.gross_amount_currency = settlement.transaction.amount_currency
    settlement.fee_amount_minor = total_fee
    settlement.fee_amount_currency = settlement.transaction.amount_currency
    settlement.net_amount_minor = net_minor
    settlement.net_amount_currency = settlement.transaction.amount_currency
    settlement.save(
        update_fields=[
            "provider_settlement_reference",
            "status",
            "settled_at",
            "gross_amount_minor",
            "gross_amount_currency",
            "fee_amount_minor",
            "fee_amount_currency",
            "net_amount_minor",
            "net_amount_currency",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.MONEY_MOVEMENT,
        aggregate_type="settlement",
        aggregate_id=settlement.id,
        actor=None,
        metadata={
            "provider": settlement.provider,
            "provider_settlement_reference": settlement.provider_settlement_reference,
            "transaction_id": str(settlement.transaction_id),
            "gross_minor": settlement.gross_amount_minor,
            "fee_minor": settlement.fee_amount_minor,
            "net_minor": settlement.net_amount_minor,
            "currency": settlement.net_amount_currency,
        },
    )
    emit(
        DomainEvent(
            "payment.settlement_confirmed.v1",
            "settlement",
            str(settlement.id),
            {
                "transaction_id": str(settlement.transaction_id),
                "beneficiary_organization_id": (
                    str(settlement.beneficiary_organization_id)
                    if settlement.beneficiary_organization_id
                    else None
                ),
            },
        )
    )
    return True
