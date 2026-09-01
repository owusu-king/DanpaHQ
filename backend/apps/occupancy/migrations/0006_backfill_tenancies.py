"""Give every existing allocation the relationship it always implied.

Occupancies predate `Tenancy`, so each one already describes an arrangement
that simply had nowhere to be recorded. This creates that record and links both
the allocation and its lease to it, so nothing that existed before this phase
reads as having no tenancy.

Grouped by (tenant, unit, bed) rather than one-per-occupancy: two occupancies
of the same space by the same person are the same arrangement re-recorded, and
giving them separate tenancies would invent a history that did not happen.

Fully reversible. At this point in the history nothing else creates tenancies,
so unlinking and removing them restores the previous state exactly.
"""

from django.db import migrations


def open_tenancies(apps, schema_editor):
    Occupancy = apps.get_model("occupancy", "Occupancy")
    Tenancy = apps.get_model("tenancy", "Tenancy")
    Lease = apps.get_model("lease", "Lease")

    by_space = {}

    for occupancy in Occupancy.objects.filter(tenancy__isnull=True).order_by("created_at"):
        key = (occupancy.user_id, occupancy.unit_id, occupancy.bed_id)
        tenancy = by_space.get(key)

        if tenancy is None:
            # An allocation that has ended describes a relationship that has
            # ended. Anything still open is active: the occupancy exists, so
            # somebody is already there, whatever the start date says.
            ended = occupancy.ended_at is not None
            tenancy = Tenancy.objects.create(
                tenant_id=occupancy.user_id,
                property_id=occupancy.property_id,
                unit_id=occupancy.unit_id,
                bed_id=occupancy.bed_id,
                status="ended" if ended else "active",
                started_on=occupancy.starts_on,
                ended_on=occupancy.ends_on if ended else None,
                ended_reason="Recorded before tenancies were kept." if ended else "",
            )
            by_space[key] = tenancy

        occupancy.tenancy = tenancy
        occupancy.save(update_fields=["tenancy"])

        if occupancy.lease_id:
            Lease.objects.filter(id=occupancy.lease_id).update(tenancy=tenancy)


def close_tenancies(apps, schema_editor):
    Occupancy = apps.get_model("occupancy", "Occupancy")
    Tenancy = apps.get_model("tenancy", "Tenancy")
    Lease = apps.get_model("lease", "Lease")

    # Unlink before deleting: both foreign keys are PROTECT, which is correct
    # for the running system and simply means the reverse has an order.
    Occupancy.objects.filter(tenancy__isnull=False).update(tenancy=None)
    Lease.objects.filter(tenancy__isnull=False).update(tenancy=None)
    Tenancy.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("occupancy", "0005_occupancy_tenancy"),
        ("tenancy", "0001_initial"),
        ("lease", "0003_lease_tenancy"),
    ]

    operations = [
        migrations.RunPython(open_tenancies, close_tenancies),
    ]
