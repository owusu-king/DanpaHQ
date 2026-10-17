import django.db.models.deletion
from django.db import migrations, models


def repair_legacy_active_rows(apps, schema_editor):
    Lease = apps.get_model("lease", "Lease")
    Occupancy = apps.get_model("occupancy", "Occupancy")
    Tenancy = apps.get_model("tenancy", "Tenancy")

    for tenancy in Tenancy.objects.filter(status__in=["upcoming", "active"]).iterator():
        lease = Lease.objects.filter(tenancy_id=tenancy.id, status="active").first()
        if lease is None:
            occupancy = Occupancy.objects.filter(
                tenancy_id=tenancy.id,
                ended_at__isnull=True,
                lease_id__isnull=False,
                lease__status="active",
            ).first()
            lease = occupancy.lease if occupancy is not None else None

        if lease is not None:
            tenancy.activation_lease_id = lease.id
            tenancy.save(update_fields=["activation_lease"])
            Occupancy.objects.filter(
                tenancy_id=tenancy.id, ended_at__isnull=True, lease_id__isnull=True
            ).update(lease_id=lease.id)
        else:
            # Preserve historical/real-world context, but stop calling it an
            # active Danpa HQ tenancy until the parties accept an agreement.
            tenancy.status = "pending_lease"
            tenancy.save(update_fields=["status"])
            Occupancy.objects.filter(
                tenancy_id=tenancy.id, ended_at__isnull=True, status="active"
            ).update(status="pending_lease")


class Migration(migrations.Migration):
    dependencies = [
        ("lease", "0004_lease_activation_gate"),
        ("occupancy", "0009_lease_required_context"),
        ("tenancy", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenancy",
            name="activation_lease",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="activated_tenancies",
                to="lease.lease",
            ),
        ),
        migrations.AlterField(
            model_name="tenancy",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending_lease", "Lease required"),
                    ("upcoming", "Not started yet"),
                    ("active", "Active"),
                    ("ended", "Ended"),
                ],
                default="pending_lease",
                max_length=16,
            ),
        ),
        migrations.RemoveConstraint(
            model_name="tenancy", name="tenancy_one_live_per_unit_per_tenant"
        ),
        migrations.RemoveConstraint(
            model_name="tenancy", name="tenancy_one_live_per_bed_per_tenant"
        ),
        migrations.RemoveIndex(model_name="tenancy", name="tenancy_live_idx"),
        migrations.RunPython(repair_legacy_active_rows, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="tenancy",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    bed__isnull=True,
                    status__in=["pending_lease", "upcoming", "active"],
                ),
                fields=("tenant", "unit"),
                name="tenancy_one_live_per_unit_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="tenancy",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    bed__isnull=False,
                    status__in=["pending_lease", "upcoming", "active"],
                ),
                fields=("tenant", "unit", "bed"),
                name="tenancy_one_live_per_bed_per_tenant",
            ),
        ),
        migrations.AddConstraint(
            model_name="tenancy",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(status__in=["pending_lease", "ended"])
                    | models.Q(activation_lease__isnull=False)
                ),
                name="tenancy_active_requires_activation_lease",
            ),
        ),
        migrations.AddIndex(
            model_name="tenancy",
            index=models.Index(
                condition=models.Q(status__in=["pending_lease", "upcoming", "active"]),
                fields=["status", "-started_on"],
                name="tenancy_live_idx",
            ),
        ),
    ]
