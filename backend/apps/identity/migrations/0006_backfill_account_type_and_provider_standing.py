"""Carry existing accounts across to declared account types and provider standing.

Two jobs, and they pull in opposite directions.

The first is not to lock anyone out. People are mid-tenancy on this platform.
Anyone who has already been through a property authority review had a human
look at their evidence and approve it, so they are granted provider standing
here rather than being made to queue again behind a check they have effectively
already passed.

The second is that the self-granted landlord role is exactly what this release
exists to stop trusting. Holding that role is therefore *not* grounds for
grandfathering: an account that gave itself the role and never submitted
anything loses provider navigation and rejoins the queue like anyone else.
Their private inventory is untouched, because creating it never required
approval and still does not.
"""

from __future__ import annotations

from django.db import migrations
from django.utils import timezone

PROVIDER_ROLES = ("landlord", "agent", "property_manager")


def backfill(apps, schema_editor):
    User = apps.get_model("identity", "User")
    UserRole = apps.get_model("identity", "UserRole")
    Verification = apps.get_model("trust", "Verification")

    # Everyone who has an approved, live property authority decision behind them.
    reviewed_property_ids = set(
        Verification.objects.filter(
            subject_type="property",
            kind="property_authority",
            status="approved",
        ).values_list("subject_id", flat=True)
    )

    approved_provider_ids: set = set()
    if reviewed_property_ids:
        PropertyRelationship = apps.get_model("property", "PropertyRelationship")
        approved_provider_ids |= set(
            str(value)
            for value in PropertyRelationship.objects.filter(
                property_id__in=reviewed_property_ids,
                ended_at__isnull=True,
                authority_verified_at__isnull=False,
            ).values_list("user_id", flat=True)
            if value
        )
        OrganizationMembership = apps.get_model("organization", "OrganizationMembership")
        OrganizationPropertyRelationship = apps.get_model(
            "organization", "OrganizationPropertyRelationship"
        )
        organization_ids = set(
            OrganizationPropertyRelationship.objects.filter(
                property_id__in=reviewed_property_ids,
                ended_at__isnull=True,
                authority_verified_at__isnull=False,
            ).values_list("organization_id", flat=True)
        )
        if organization_ids:
            approved_provider_ids |= set(
                str(value)
                for value in OrganizationMembership.objects.filter(
                    organization_id__in=organization_ids,
                    ended_at__isnull=True,
                ).values_list("user_id", flat=True)
                if value
            )

    now = timezone.now()
    declared_provider_ids = set(
        str(value)
        for value in UserRole.objects.filter(
            role__in=PROVIDER_ROLES, revoked_at__isnull=True
        ).values_list("user_id", flat=True)
    )

    for user in User.objects.all().iterator():
        user_id = str(user.id)
        is_provider = user_id in declared_provider_ids or user_id in approved_provider_ids
        if not user.account_type:
            user.account_type = "provider" if is_provider else "tenant"
            user.save(update_fields=["account_type"])

        if user_id not in approved_provider_ids:
            continue
        if Verification.objects.filter(
            subject_type="user", subject_id=user_id, kind="provider"
        ).exists():
            continue
        Verification.objects.create(
            subject_type="user",
            subject_id=user_id,
            kind="provider",
            method="manual_override",
            status="approved",
            decided_at=now,
            decision_note=(
                "Granted automatically: this account had already passed a reviewed "
                "property authority check before provider standing became a separate "
                "decision."
            ),
            internal_note="Backfilled by identity migration 0006.",
        )

    # Providers who were never reviewed keep their account type but lose the
    # navigation role, which is the whole point: it was self-granted.
    UserRole.objects.filter(role__in=PROVIDER_ROLES, revoked_at__isnull=True).exclude(
        user_id__in=approved_provider_ids
    ).update(
        revoked_at=now,
        revoked_reason="provider standing now requires an approved verification",
        is_primary=False,
    )


def unbackfill(apps, schema_editor):
    """Remove only what this migration created.

    Account types are left in place: they record a choice, and guessing which
    ones were inferred here rather than chosen would be worse than keeping them.
    """
    Verification = apps.get_model("trust", "Verification")
    Verification.objects.filter(
        subject_type="user",
        kind="provider",
        internal_note="Backfilled by identity migration 0006.",
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("identity", "0005_user_account_type_user_date_of_birth"),
        ("trust", "0004_alter_verification_kind"),
        ("property", "0005_property_created_by_property_join_code_and_more"),
        ("organization", "0002_backfill_personal_organizations"),
    ]

    operations = [migrations.RunPython(backfill, unbackfill)]
