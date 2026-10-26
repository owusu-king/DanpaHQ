"""Billing periods and the credit for unused paid time.

Calendar months, not thirty-day blocks. A Portfolio that pays on 31 January is
paid until 28 (or 29) February and then until 31 March — the day of the month is
clamped, never carried into the next month, because "paid until 3 March" for a
January payment is a renewal date nobody would recognise.

All proration is integer arithmetic. Durations are counted in microseconds and
money in pesewas, so no float ever touches an amount (ADR 0006). The credit is
rounded down: when a pesewa has to go somewhere, it stays with the charge rather
than being given away twice across two invoices.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta

from ..models import BillingInterval

_MICROSECOND = timedelta(microseconds=1)


def add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def period_end(start: datetime, interval: str) -> datetime:
    """When a period of `interval` that begins at `start` ends."""
    return add_months(start, 12 if interval == BillingInterval.ANNUAL else 1)


def unused_credit_minor(
    *, list_price_minor: int, period_start: datetime, period_end: datetime, now: datetime
) -> int:
    """The value of the paid time still left in a period, in minor units."""
    if list_price_minor <= 0 or now >= period_end:
        return 0
    total = (period_end - period_start) // _MICROSECOND
    if total <= 0:
        return 0
    remaining = (period_end - max(now, period_start)) // _MICROSECOND
    return list_price_minor * remaining // total
