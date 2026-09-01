import django.db.models.deletion
from django.db import migrations, models


BLOCKING_STATUSES = ("submitted", "under_review", "accepted")


def backfill_units_and_supersede_duplicates(apps, schema_editor):
    RentalApplication = apps.get_model("application", "RentalApplication")
    Lease = apps.get_model("lease", "Lease")

    for application in RentalApplication.objects.select_related("listing").all().iterator():
        application.unit_id = application.listing.unit_id
        application.save(update_fields=["unit"])

    groups = (
        RentalApplication.objects.filter(status__in=BLOCKING_STATUSES)
        .values("tenant_id", "unit_id")
        .annotate(total=models.Count("id"))
        .filter(total__gt=1)
    )
    status_priority = {"submitted": 1, "under_review": 2, "accepted": 3}

    for group in groups.iterator():
        rows = list(
            RentalApplication.objects.filter(
                tenant_id=group["tenant_id"],
                unit_id=group["unit_id"],
                status__in=BLOCKING_STATUSES,
            ).order_by("created_at", "id")
        )
        linked_ids = set(
            Lease.objects.filter(application_id__in=[row.id for row in rows]).values_list(
                "application_id", flat=True
            )
        )
        # A record already used to produce a lease is authoritative. Otherwise
        # retain the furthest-progressed application, then the oldest original
        # submission. No row or historical decision is deleted or relabelled.
        winner = max(
            rows,
            key=lambda row: (
                row.id in linked_ids,
                status_priority[row.status],
                -row.created_at.timestamp(),
            ),
        )
        RentalApplication.objects.filter(id__in=[row.id for row in rows if row.id != winner.id]).update(
            superseded_by_id=winner.id
        )


class Migration(migrations.Migration):
    # PostgreSQL queues FK trigger checks during the backfill and will not
    # ALTER the same table to make the column non-null until those checks have
    # been committed. Each operation is independently safe and resumable.
    atomic = False

    dependencies = [
        ("application", "0001_initial"),
        ("lease", "0003_lease_tenancy"),
    ]

    operations = [
        migrations.AddField(
            model_name="rentalapplication",
            name="unit",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="rental_applications",
                to="property.unit",
            ),
        ),
        migrations.AddField(
            model_name="rentalapplication",
            name="superseded_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="superseded_applications",
                to="application.rentalapplication",
            ),
        ),
        migrations.RunPython(backfill_units_and_supersede_duplicates, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="rentalapplication",
            name="unit",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="rental_applications",
                to="property.unit",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="rentalapplication",
            name="application_one_open_per_tenant",
        ),
        migrations.AddConstraint(
            model_name="rentalapplication",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    status__in=["submitted", "under_review", "accepted"],
                    superseded_by__isnull=True,
                ),
                fields=("unit", "tenant"),
                name="app_one_current_per_unit",
            ),
        ),
    ]
