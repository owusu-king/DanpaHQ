"""Read model for high-trust payment operations.

This surface explains disagreements; it never repairs financial records. The
immutable transaction, allocation, receipt and ledger remain the source facts.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from apps.core.money import Money

from . import alerts
from .models import (
    OPEN_EXCEPTION_STATUSES,
    PaymentTransaction,
    ReconciliationException,
    ReconciliationStatus,
    Settlement,
    SettlementStatus,
    TransactionStatus,
)


def _iso(value):
    return value.isoformat() if value else None


def _money(minor: int, currency: str) -> str:
    return str(Money(minor, currency))


def payment_operations_snapshot(*, status: str = "", kind: str = "", limit: int = 50) -> dict:
    exceptions = ReconciliationException.objects.select_related(
        "intent__tenant",
        "intent__lease__unit__property",
        "transaction__intent__tenant",
        "transaction__intent__lease__unit__property",
        "settlement__beneficiary_organization",
    )
    if status:
        exceptions = exceptions.filter(status=status)
    if kind:
        exceptions = exceptions.filter(kind=kind)

    transactions = (
        PaymentTransaction.objects.filter(status=TransactionStatus.SUCCEEDED)
        .select_related(
            "intent__tenant",
            "intent__lease__unit__property",
            "settlement__beneficiary_organization",
        )
        .prefetch_related("refunds")
        .order_by("-paid_at", "-created_at")[:limit]
    )
    settlements = Settlement.objects.all()
    open_rows = ReconciliationException.objects.filter(status__in=OPEN_EXCEPTION_STATUSES)
    oldest = open_rows.order_by("detected_at").values_list("detected_at", flat=True).first()
    breach_hours = int(getattr(settings, "PAYMENT_RECONCILIATION_BREACH_HOURS", 24))
    counts = {
        "open_exceptions": open_rows.count(),
        # Neglect, stated as a number. An operator opening this workspace should
        # not have to read every row's timestamp to notice that one of them has
        # been unanswered since Tuesday.
        "oldest_open_age_hours": (
            int((timezone.now() - oldest).total_seconds() // 3600) if oldest else 0
        ),
        "breached_exceptions": open_rows.filter(
            detected_at__lte=timezone.now() - timedelta(hours=breach_hours)
        ).count(),
        "breach_after_hours": breach_hours,
        # Named here as well as in every alert. An operator opening this queue
        # should not have to ask whose it is.
        "owner": alerts.alert_owner(),
        "alerting_configured": bool(
            str(getattr(settings, "PAYMENT_ALERT_WEBHOOK_URL", "")).strip()
        ),
        # `investigating` *is* the acknowledgement: a person has this one, so
        # alerting quietens for it. Named once rather than twice.
        "investigating": ReconciliationException.objects.filter(
            status=ReconciliationStatus.INVESTIGATING
        ).count(),
        "payments_confirmed": PaymentTransaction.objects.filter(
            status=TransactionStatus.SUCCEEDED
        ).count(),
        "awaiting_settlement": settlements.filter(
            status__in=[SettlementStatus.PENDING, SettlementStatus.PROCESSING]
        ).count(),
        "settlement_attention": settlements.filter(
            status__in=[SettlementStatus.FAILED, SettlementStatus.REVERSED]
        ).count(),
    }
    return {
        "counts": counts,
        "exceptions": [_exception_row(row) for row in exceptions[:limit]],
        "transactions": [_transaction_row(row) for row in transactions],
    }


def _exception_row(row: ReconciliationException) -> dict:
    intent = row.intent or (row.transaction.intent if row.transaction_id else None)
    return {
        "id": str(row.id),
        "kind": row.kind,
        "kind_display": row.get_kind_display(),
        "status": row.status,
        "status_display": row.get_status_display(),
        "provider": row.provider,
        "provider_reference": row.provider_reference,
        "detail": row.detail,
        "detected_at": _iso(row.detected_at),
        "resolved_at": _iso(row.resolved_at),
        "resolved_by_management_id": str(row.resolved_by_management_id or ""),
        "resolution_note": row.resolution_note,
        "subject": {
            "intent_id": str(intent.id) if intent else "",
            "transaction_id": str(row.transaction_id or ""),
            "settlement_id": str(row.settlement_id or ""),
            "tenant": intent.tenant.display_name if intent else "",
            "property": intent.lease.unit.property.title if intent else "",
            "unit": intent.lease.unit.label if intent else "",
            "amount_formatted": (
                _money(intent.amount_minor, intent.amount_currency) if intent else ""
            ),
        },
    }


def _transaction_row(row: PaymentTransaction) -> dict:
    settlement = getattr(row, "settlement", None)
    refunds = list(row.refunds.all())
    return {
        "id": str(row.id),
        "provider_transaction_id": row.provider_transaction_id,
        "provider": row.provider,
        "status": row.status,
        "amount_formatted": _money(row.amount_minor, row.amount_currency),
        "payment_method": row.payment_method,
        # Provider adapters call this event timestamp ``occurred_at``; the
        # durable transaction model names the same fact ``paid_at``.
        "occurred_at": _iso(row.paid_at),
        "tenant": row.intent.tenant.display_name,
        "property": row.intent.lease.unit.property.title,
        "unit": row.intent.lease.unit.label,
        "settlement": (
            {
                "status": settlement.status,
                "gross_formatted": _money(
                    settlement.gross_amount_minor, settlement.gross_amount_currency
                ),
                "net_formatted": _money(
                    settlement.net_amount_minor, settlement.net_amount_currency
                ),
                "organization": (
                    settlement.beneficiary_organization.name
                    if settlement.beneficiary_organization_id
                    else ""
                ),
                "settled_at": _iso(settlement.settled_at),
            }
            if settlement
            else None
        ),
        "refunds": {
            "count": len(refunds),
            "statuses": dict(Counter(refund.status for refund in refunds)),
        },
    }
