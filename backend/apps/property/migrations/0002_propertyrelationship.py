import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import apps.core.ids


def backfill_relationships(apps, schema_editor):
    Property = apps.get_model("property", "Property")
    Relationship = apps.get_model("property", "PropertyRelationship")
    UserRole = apps.get_model("identity", "UserRole")

    rows = []
    for prop in Property.objects.all().iterator():
        rows.append(Relationship(property_id=prop.id, user_id=prop.owner_id, relationship_type="owner"))
        if prop.managed_by_id:
            is_agent = UserRole.objects.filter(
                user_id=prop.managed_by_id, role="agent", revoked_at__isnull=True
            ).exists()
            rows.append(
                Relationship(
                    property_id=prop.id,
                    user_id=prop.managed_by_id,
                    relationship_type="agent" if is_agent else "manager",
                )
            )
    Relationship.objects.bulk_create(rows, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("property", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PropertyRelationship",
            fields=[
                ("id", models.UUIDField(default=apps.core.ids.uuid7, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("relationship_type", models.CharField(choices=[("owner", "Owner"), ("manager", "Property manager"), ("agent", "Agent"), ("listing_manager", "Listing manager")], max_length=24)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("note", models.CharField(blank=True, max_length=200)),
                ("granted_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("property", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="relationships", to="property.property")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="property_relationships", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "property_relationship"},
        ),
        migrations.AddConstraint(
            model_name="propertyrelationship",
            constraint=models.UniqueConstraint(condition=models.Q(("ended_at__isnull", True)), fields=("property", "user", "relationship_type"), name="property_unique_active_relationship"),
        ),
        migrations.AddIndex(model_name="propertyrelationship", index=models.Index(fields=["user", "relationship_type"], name="property_actor_rel_idx")),
        migrations.AddIndex(model_name="propertyrelationship", index=models.Index(fields=["property", "relationship_type"], name="property_resource_rel_idx")),
        migrations.RunPython(backfill_relationships, migrations.RunPython.noop),
    ]
