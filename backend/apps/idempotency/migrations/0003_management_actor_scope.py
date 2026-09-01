"""Scope Management mutations to the dedicated Operations identity."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("idempotency", "0002_initial")]

    operations = [
        migrations.RemoveConstraint(
            model_name="idempotencykey",
            name="idempotency_unique_key",
        ),
        migrations.AddField(
            model_name="idempotencykey",
            name="management_actor_id",
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
        migrations.AddConstraint(
            model_name="idempotencykey",
            constraint=models.UniqueConstraint(
                fields=("actor", "management_actor_id", "endpoint", "key"),
                name="idempotency_unique_key",
                nulls_distinct=False,
            ),
        ),
    ]
