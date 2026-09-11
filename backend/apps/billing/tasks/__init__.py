"""Scheduled billing work."""

from celery import shared_task


@shared_task(name="billing.advance_subscriptions")
def advance_subscriptions() -> dict:
    """Close paid periods that have ended, and end grace that has run out.

    Scheduled rather than triggered, because the event is time passing. See
    `services.lifecycle_service` for what each transition means.
    """
    from ..services.lifecycle_service import advance_subscriptions as run

    return run()


@shared_task(name="billing.reconcile_resource_access")
def reconcile_resource_access() -> dict:
    """Bring restricted properties and units in line with what time has changed.

    Restrictions are applied as limits fall, inside the transaction that lowers
    them. This catches the rest: a wind-down whose last tenancy ended, or an
    override that ran out. See `services.resource_access_service`.
    """
    from ..services.resource_access_service import sweep

    return sweep()
