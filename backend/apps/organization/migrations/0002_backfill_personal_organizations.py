from django.db import migrations
from django.utils import timezone


def backfill_personal_organizations(apps, schema_editor):
    Organization = apps.get_model("organization", "Organization")
    OrganizationActivity = apps.get_model("organization", "OrganizationActivity")
    OrganizationMembership = apps.get_model("organization", "OrganizationMembership")
    OrganizationPropertyRelationship = apps.get_model(
        "organization", "OrganizationPropertyRelationship"
    )
    Property = apps.get_model("property", "Property")
    PropertyRelationship = apps.get_model("property", "PropertyRelationship")

    organizations_by_owner = {}
    for prop in Property.objects.exclude(owner_id__isnull=True).select_related("owner").iterator():
        owner = prop.owner
        owner_label = (
            owner.preferred_name
            or " ".join(part for part in (owner.first_name, owner.last_name) if part)
            or owner.phone
        )
        organization = organizations_by_owner.get(owner.id)
        if organization is None:
            membership = OrganizationMembership.objects.filter(
                user_id=owner.id,
                role="owner",
                ended_at__isnull=True,
                organization__organization_type="individual_owner",
            ).select_related("organization").first()
            if membership:
                organization = membership.organization
            else:
                organization = Organization.objects.create(
                    name=f"{owner_label} Properties",
                    organization_type="individual_owner",
                    created_by_id=owner.id,
                )
                OrganizationActivity.objects.create(
                    organization=organization,
                    activity="residential",
                )
                OrganizationMembership.objects.create(
                    organization=organization,
                    user_id=owner.id,
                    role="owner",
                    invited_by_id=owner.id,
                    joined_at=timezone.now(),
                )
            organizations_by_owner[owner.id] = organization

        direct = PropertyRelationship.objects.filter(
            property_id=prop.id,
            user_id=owner.id,
            relationship_type="owner",
            ended_at__isnull=True,
        ).first()
        OrganizationPropertyRelationship.objects.get_or_create(
            organization=organization,
            property_id=prop.id,
            relationship_type="owner",
            ended_at=None,
            defaults={
                "granted_by_id": owner.id,
                "authority_verification_id": (
                    direct.authority_verification_id if direct else None
                ),
                "authority_verified_at": direct.authority_verified_at if direct else None,
                "note": "Backfilled from the legacy individual owner relationship.",
            },
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("identity", "0004_userintent"),
        ("organization", "0001_initial"),
        ("property", "0005_property_created_by_property_join_code_and_more"),
    ]

    operations = [migrations.RunPython(backfill_personal_organizations, noop_reverse)]
