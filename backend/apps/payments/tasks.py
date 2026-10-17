from celery import shared_task

from .services import expire_due_intents


@shared_task(name="payments.expire_intents")
def expire_intents() -> int:
    return expire_due_intents()


@shared_task(name="payments.reconcile")
def reconcile() -> dict:
    """Compare Danpa HQ's financial record with the provider's.

    Scheduled rather than triggered, because the failure it exists to catch is
    precisely the one where nothing triggered: the callback that never arrived.
    It opens exceptions and never repairs — see `reconciliation` for why.
    """
    from .payouts import reconcile_payout_provisioning
    from .reconciliation import run_reconciliation
    from .settlements import import_provider_settlements

    # Importing a provider-reported payout is the normal settlement lifecycle;
    # reconciliation then records (and never auto-repairs) anything that still
    # disagrees.
    return {
        "payout_destinations_recovered": reconcile_payout_provisioning(),
        "settlements_imported": import_provider_settlements(),
        **run_reconciliation(),
    }


@shared_task(name="payments.alert_open_exceptions")
def alert_open_exceptions() -> dict:
    """Keep an unresolved disagreement audible until somebody answers it.

    Scheduled separately from `payments.reconcile` on purpose: if the sweep
    itself is failing, the alerting for everything it already found must not
    fail with it.
    """
    from .reconciliation import alert_open_exceptions as run

    return run()
