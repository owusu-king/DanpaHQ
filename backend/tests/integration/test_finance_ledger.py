"""P&L reads complete confirmed records, never recent or disputed claims."""
from datetime import date

import pytest

from apps.organization.finance import portfolio_profit_loss

pytestmark = pytest.mark.django_db


def test_profit_loss_groups_full_confirmed_history_and_scoped_expenses(user, landlord):
    from apps.organization.models import Organization
    from apps.payments.models import Settlement
    from apps.rent.models import PropertyExpense, RentPayment

    from .test_tenancy_portfolio import _house

    occupancy = _house(user, landlord, "Ledger house")
    organization = Organization.objects.create(
        name="Ledger portfolio", organization_type="individual_owner", created_by=landlord,
    )
    for _index in range(25):
        RentPayment.objects.create(
            lease=occupancy.lease, amount_minor=10001, paid_on=date(2026, 9, 1),
            method="cash", status="confirmed", recorded_by=user, confirmed_by=landlord,
        )
    RentPayment.objects.create(
        lease=occupancy.lease, amount_minor=999999, paid_on=date(2026, 9, 1),
        method="cash", status="claimed", recorded_by=user,
    )
    PropertyExpense.objects.create(
        organization=organization, property=occupancy.property, amount_minor=20000,
        incurred_on=date(2026, 9, 15), category="maintenance", recorded_by=landlord,
    )
    # An expense outside the caller's scope must not enter its ledger.
    PropertyExpense.objects.create(
        organization=organization, property=occupancy.property, amount_minor=999999,
        incurred_on=date(2026, 9, 15), category="tax", recorded_by=landlord,
    )
    report = portfolio_profit_loss(
        payments=RentPayment.objects.filter(lease=occupancy.lease, status="confirmed"),
        expenses=PropertyExpense.objects.filter(category="maintenance"),
        settlements=Settlement.objects.none(),
    )["ledgers"][0]
    assert report["revenue_minor"] == 250025
    assert report["expenses_minor"] == 20000
    assert report["profit_minor"] == 230025
    assert len(report["monthly"]) == 1
