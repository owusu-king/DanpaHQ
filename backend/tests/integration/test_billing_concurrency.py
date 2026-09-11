"""Two requests, one slot.

Separate from the rest of the billing tests because it needs a real transaction
per test rather than pytest-django's wrapping one — a row lock inside a
surrounding transaction is not a lock against anything, and the whole point here
is that two connections contend.

`transaction=True` truncates the tables between tests, which takes the plan
catalogue seeded by `billing/0002` with it. `sync_catalogue` is idempotent and
additive precisely so it can be called again here.
"""

from __future__ import annotations

import threading

import pytest
from django.db import connections

from apps.billing.catalogue import sync_catalogue
from apps.billing.services import entitlement_service, usage_service
from apps.organization import services as organization_services
from apps.property import services as property_services
from tests.conftest import approve_provider_standing, upgrade_portfolio

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def catalogue(db):
    sync_catalogue()


def _address(street):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, street=street)


@pytest.fixture
def portfolio(landlord):
    approve_provider_standing(landlord)
    return organization_services.create_organization(
        user=landlord,
        data={
            "name": "Osu Properties",
            "organization_type": "individual_owner",
            "activities": ["residential"],
        },
    )


def _make_property(landlord, organization, title, street):
    return property_services.create_private_property(
        user=landlord,
        organization=organization,
        data={
            "title": title,
            "property_type": "residential",
            "address_id": _address(street).id,
        },
    )


def test_two_concurrent_creations_cannot_both_take_the_last_slot(landlord, portfolio):
    """The race a limit check outside a transaction would lose.

    Count-then-create, in two separate transactions, is how two requests both
    see one slot free and both take it. `enforcement._lock_portfolio` makes the
    check and the create one decision, so one of these two waits and then finds
    the slot gone.
    """
    upgrade_portfolio(portfolio, "PRO")
    ceiling = entitlement_service.limit(organization=portfolio, key="PROPERTY_LIMIT")
    for index in range(ceiling - 1):
        _make_property(landlord, portfolio, f"Block {index}", f"{index} Fill Road")

    results: list[object] = []
    barrier = threading.Barrier(2)

    def attempt(street):
        barrier.wait()
        try:
            results.append(_make_property(landlord, portfolio, "Race", street))
        except Exception as exc:
            results.append(exc)
        finally:
            connections.close_all()

    threads = [
        threading.Thread(target=attempt, args=("90 Race Road",)),
        threading.Thread(target=attempt, args=("91 Race Road",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    refused = [row for row in results if isinstance(row, Exception)]
    assert len(refused) == 1, f"expected exactly one refusal, got {results}"
    assert isinstance(refused[0], entitlement_service.PlanLimitReached)
    assert usage_service.property_count(organization=portfolio) == ceiling


def test_two_concurrent_reactivations_cannot_both_take_the_last_place(landlord, portfolio):
    """The same race, after a downgrade: two restricted properties, room for one.

    Reactivation takes the Portfolio lock and counts what is fully active under
    it, so the second request waits, then finds the place taken.
    """
    from apps.billing.models import Entitlement, PortfolioPlanOverride, ResourceAccess
    from apps.billing.services import resource_access_service, subscription_service

    upgrade_portfolio(portfolio, "BUSINESS")
    _make_property(landlord, portfolio, "Kept", "1 Keep Road")
    waiting = [
        _make_property(landlord, portfolio, "Waiting A", "2 Wait Road"),
        _make_property(landlord, portfolio, "Waiting B", "3 Wait Road"),
    ]
    subscription_service.change_plan(
        organization=portfolio, plan_code="FREE", actor=landlord, reason="test downgrade"
    )
    PortfolioPlanOverride.objects.create(
        organization=portfolio,
        entitlement=Entitlement.objects.get(key="PROPERTY_LIMIT"),
        value=2,
        reason="Room for one more",
        created_by=landlord,
    )

    results: list[object] = []
    barrier = threading.Barrier(2)

    def attempt(prop):
        barrier.wait()
        try:
            results.append(
                resource_access_service.reactivate(
                    organization=portfolio, user=landlord, property_ids=[str(prop.id)]
                )
            )
        except Exception as exc:
            results.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=attempt, args=(prop,)) for prop in waiting]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    refused = [row for row in results if isinstance(row, Exception)]
    assert len(refused) == 1, f"expected exactly one refusal, got {results}"
    assert isinstance(refused[0], entitlement_service.PlanLimitReached)
    assert ResourceAccess.objects.filter(organization=portfolio, kind="property").count() == 1
