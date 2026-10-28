"""Cash-basis P&L from complete, property-scoped accounting records."""
from collections import defaultdict

from django.db.models import Sum
from django.db.models.functions import TruncMonth

COLUMNS = ("revenue_minor", "refunds_minor", "expenses_minor", "fees_minor")


def build_profit_loss(records):
    """Keep integer minor units and currencies separate; payouts are transfers."""
    periods = defaultdict(lambda: defaultdict(lambda: dict.fromkeys(COLUMNS, 0)))
    for currency, period, column, amount in records:
        periods[currency][period][column] += amount
    if not periods:
        periods["GHS"] = {}
    ledgers = []
    for currency, months in sorted(periods.items()):
        totals = dict.fromkeys(COLUMNS, 0)
        rows = []
        for period, amounts in sorted(months.items(), reverse=True):
            amounts["profit_minor"] = (
                amounts["revenue_minor"] - amounts["refunds_minor"]
                - amounts["expenses_minor"] - amounts["fees_minor"]
            )
            rows.append({"period": period, **amounts})
            for column in COLUMNS:
                totals[column] += amounts[column]
        totals["profit_minor"] = (
            totals["revenue_minor"] - totals["refunds_minor"]
            - totals["expenses_minor"] - totals["fees_minor"]
        )
        ledgers.append({"currency": currency, **totals, "monthly": rows})
    return {"basis": "cash", "ledgers": ledgers}


def portfolio_profit_loss(*, payments, expenses, settlements):
    from apps.payments.models import Refund, RefundStatus, SettlementStatus

    def grouped(query, date, currency, amount, column):
        rows = query.annotate(month=TruncMonth(date)).values("month", currency).annotate(
            total=Sum(amount)
        ).order_by()
        for row in rows:
            if row["month"] is not None:
                yield row[currency], row["month"].strftime("%Y-%m"), column, row["total"] or 0

    refunds = Refund.objects.filter(
        transaction__rent_record__in=payments, status=RefundStatus.COMPLETED,
    )
    # Completed refunds restate the original rent-receipt month. They are not
    # dated by editable notes or an approval that may never have paid out.
    records = [
        *grouped(payments, "paid_on", "amount_currency", "amount_minor", "revenue_minor"),
        *grouped(expenses, "incurred_on", "amount_currency", "amount_minor", "expenses_minor"),
        *grouped(refunds, "transaction__rent_record__paid_on", "amount_currency",
                 "amount_minor", "refunds_minor"),
        *grouped(settlements.filter(status=SettlementStatus.SETTLED), "settled_at",
                 "gross_amount_currency", "fee_amount_minor", "fees_minor"),
    ]
    return build_profit_loss(records)
