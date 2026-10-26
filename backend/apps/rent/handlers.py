"""The schedule is built when a tenancy goes live, and never before.

Subscribing to the event rather than calling from the lease service keeps the
dependency pointing the right way: rent knows about leases, leases know nothing
about rent.
"""

from __future__ import annotations

import logging

from apps.outbox.tasks import subscribe

logger = logging.getLogger("rent")


@subscribe("lease.activated.v1")
def on_lease_activated(event) -> None:
    from apps.lease.models import Lease

    from .services import build_schedule

    lease = Lease.objects.filter(id=event.aggregate_id).select_related("unit").first()
    if lease is None:
        return
    charges = build_schedule(lease)
    logger.info(
        "rent schedule built",
        extra={"event": "rent_schedule_built", "count": len(charges)},
    )


@subscribe("lease.ended.v1")
def on_lease_ended(event) -> None:
    """A tenancy that stopped is not a tenancy that owes the rest of its year."""
    from django.utils import timezone

    from apps.lease.models import Lease

    from .services import close_schedule

    lease = Lease.objects.filter(id=event.aggregate_id).first()
    if lease is None:
        return
    closed = close_schedule(lease=lease, through=timezone.localdate(), reason="tenancy_ended")
    logger.info(
        "rent schedule closed",
        extra={"event": "rent_schedule_closed", "count": closed},
    )


@subscribe("lease.superseded.v1")
def on_lease_superseded(event) -> None:
    """The replacement bills the whole term, so the original must stop."""
    from apps.lease.models import Lease

    from .services import close_schedule

    lease = Lease.objects.filter(id=event.aggregate_id).first()
    if lease is None:
        return
    closed = close_schedule(lease=lease, through=None, reason="agreement_superseded")
    logger.info(
        "rent schedule closed",
        extra={"event": "rent_schedule_closed", "count": closed},
    )
