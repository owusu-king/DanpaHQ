"""Close the schedules of tenancies that finished before anything closed them.

`close_schedule` runs off `lease.ended.v1` and `lease.superseded.v1`. Those
events fired for existing leases long before there was a handler listening, and
nothing replays them — so every tenancy that had already finished kept its whole
remaining schedule sitting at `due`, ageing into *overdue* on the provider's
dashboard for rooms nobody lives in.

Fixing the behaviour did not fix the rows. This does, once, applying exactly the
rules the handler applies:

- **Ended** closes only what had not yet fallen due when the tenancy stopped.
  Arrears are real debts and survive — measured against the lease's own
  `ended_on` rather than today, so a tenancy that ended in March is judged as it
  stood in March.
- **Superseded** closes the whole unpaid schedule, because the replacement
  agreement bills the same term afresh.

A charge with money against it is never touched, whatever its lease's state.
What was actually paid is evidence.
"""

from django.db import migrations
from django.db.models import Q

# Written as literals rather than imported from the enum: a migration must keep
# meaning the same thing after the enum it was written against has moved on.
DUE = "due"
PART_PAID = "part_paid"
CANCELLED = "cancelled"

ENDED = "ended"
SUPERSEDED = "superseded"


def close_finished_schedules(apps, schema_editor):
    RentCharge = apps.get_model("rent", "RentCharge")

    unpaid = Q(amount_paid_minor__isnull=True) | Q(amount_paid_minor=0)
    open_status = Q(status__in=[DUE, PART_PAID])

    # Superseded: the whole unpaid schedule goes.
    superseded = RentCharge.objects.filter(
        open_status, unpaid, lease__status=SUPERSEDED
    )
    superseded_closed = superseded.update(status=CANCELLED)

    # Ended: only what had not yet fallen due when it stopped. `ended_on` is the
    # honest cut-off; using today would forgive arrears that accrued between the
    # tenancy ending and this migration running.
    ended_closed = 0
    ended_leases = (
        RentCharge.objects.filter(open_status, unpaid, lease__status=ENDED)
        .values_list("lease_id", "lease__ended_on")
        .distinct()
    )
    for lease_id, ended_on in ended_leases:
        if ended_on is None:
            # An ended lease with no recorded date cannot be judged against one.
            # Left alone deliberately: guessing a cut-off here would either
            # forgive real arrears or keep billing a finished tenancy, and both
            # are worse than a row somebody can still look at.
            continue
        ended_closed += RentCharge.objects.filter(
            open_status, unpaid, lease_id=lease_id, due_on__gt=ended_on
        ).update(status=CANCELLED)

    if superseded_closed or ended_closed:
        print(
            f"\n  closed {ended_closed} charge(s) on ended tenancies and "
            f"{superseded_closed} on superseded agreements"
        )


def reopen(apps, schema_editor):
    """Deliberately not reversible.

    Reversing would have to put these back to `due`, which cannot distinguish
    the rows this migration closed from any a person cancelled afterwards. A
    reverse that guesses is worse than one that refuses.
    """
    raise RuntimeError(
        "Closing a finished schedule cannot be reversed automatically; "
        "restore from a backup if this must be undone."
    )


class Migration(migrations.Migration):
    dependencies = [
        ("rent", "0004_charge_cancelled"),
        ("lease", "0006_canonical_lifecycle_fields"),
    ]

    operations = [
        migrations.RunPython(close_finished_schedules, reopen),
    ]
