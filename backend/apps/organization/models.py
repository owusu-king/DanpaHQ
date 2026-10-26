"""Business/workspace ownership and delegated property access.

Authentication identifies a person. These records describe the business
context in which that person may act. A tenant occupancy is deliberately not
an organization membership.
"""

from __future__ import annotations

import secrets

from django.db import models

from apps.core.fields import PhoneNumberField
from apps.core.models import BaseModel, SoftDeleteModel


class OrganizationType(models.TextChoices):
    INDIVIDUAL_OWNER = "individual_owner", "Individual property owner"
    PROPERTY_COMPANY = "property_company", "Property company"
    PROPERTY_MANAGER = "property_manager", "Property management company"
    HOSTEL_OPERATOR = "hostel_operator", "Student hostel operator"


class OrganizationActivityType(models.TextChoices):
    """What an organization does. Mirrors `property.PropertyType` deliberately.

    `COMMERCIAL` was added alongside the property categories: with residential,
    commercial and hostel being the three kinds of property, an organization
    letting shops and offices had no way to say so, and would have had to declare
    itself residential to declare anything at all.
    """

    RESIDENTIAL = "residential", "Residential property"
    COMMERCIAL = "commercial", "Commercial property"
    HOSTEL = "hostel", "Student hostel"
    #: Selling property rather than letting it. Recorded whatever kind of property
    #: is being sold, because the business is the selling (owner, 2026-09-28).
    SALES = "sales", "Property sales"


class MembershipRole(models.TextChoices):
    OWNER = "owner", "Owner"
    ADMIN = "admin", "Administrator"
    PROPERTY_MANAGER = "property_manager", "Property manager"
    ACCOUNTANT = "accountant", "Accountant"
    STAFF = "staff", "Staff"


class OrganizationPropertyRole(models.TextChoices):
    OWNER = "owner", "Property owner"
    MANAGER = "manager", "Property manager"
    LISTING_AGENT = "listing_agent", "Listing agent"


class OrganizationInvitationStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"
    REVOKED = "revoked", "Revoked"
    EXPIRED = "expired", "Expired"


def organization_invitation_nonce() -> str:
    """Unpredictable material bound into an invitation's signed token."""

    return secrets.token_urlsafe(24)


class Organization(SoftDeleteModel):
    name = models.CharField(max_length=180)
    organization_type = models.CharField(max_length=32, choices=OrganizationType.choices)
    created_by = models.ForeignKey(
        "identity.User",
        on_delete=models.PROTECT,
        related_name="organizations_created",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "organization_organization"
        ordering = ("name", "created_at")
        indexes = [models.Index(fields=["created_by", "-created_at"], name="org_creator_idx")]

    def __str__(self) -> str:
        return self.name


class OrganizationActivity(BaseModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="activities"
    )
    activity = models.CharField(max_length=24, choices=OrganizationActivityType.choices)

    class Meta:
        db_table = "organization_activity"
        constraints = [
            models.UniqueConstraint(fields=["organization", "activity"], name="org_unique_activity")
        ]


class OrganizationMembership(BaseModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="organization_memberships"
    )
    role = models.CharField(max_length=24, choices=MembershipRole.choices)
    invited_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    joined_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "organization_membership"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user"],
                condition=models.Q(ended_at__isnull=True),
                name="org_unique_active_membership",
            )
        ]
        indexes = [
            models.Index(fields=["user", "ended_at"], name="org_member_user_idx"),
            models.Index(fields=["organization", "role"], name="org_member_role_idx"),
        ]

    @property
    def is_active(self) -> bool:
        return self.ended_at is None and self.organization.is_active


class OrganizationInvitation(BaseModel):
    """A revocable request to join a Portfolio; never authority by itself."""

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="invitations"
    )
    invitee_phone = PhoneNumberField(db_index=True)
    invitee_user = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="organization_invitations",
    )
    role = models.CharField(max_length=24, choices=MembershipRole.choices)
    status = models.CharField(
        max_length=16,
        choices=OrganizationInvitationStatus.choices,
        default=OrganizationInvitationStatus.PENDING,
        db_index=True,
    )
    invited_by = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="organization_invitations_sent"
    )
    expires_at = models.DateTimeField(db_index=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    sms_sent_at = models.DateTimeField(null=True, blank=True)
    sms_failed_reason = models.CharField(max_length=200, blank=True)
    revoked_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    nonce = models.CharField(max_length=64, default=organization_invitation_nonce, editable=False)

    class Meta:
        db_table = "organization_invitation"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "invitee_phone"],
                condition=models.Q(status=OrganizationInvitationStatus.PENDING),
                name="org_unique_pending_invitation",
            )
        ]
        indexes = [
            models.Index(
                fields=["invitee_phone", "status", "-created_at"],
                name="org_invitee_pending_idx",
            )
        ]


class OrganizationInvitationProperty(BaseModel):
    invitation = models.ForeignKey(
        OrganizationInvitation, on_delete=models.CASCADE, related_name="property_selections"
    )
    property = models.ForeignKey(
        "property.Property", on_delete=models.CASCADE, related_name="organization_invitation_links"
    )

    class Meta:
        db_table = "organization_invitation_property"
        constraints = [
            models.UniqueConstraint(
                fields=["invitation", "property"], name="org_unique_invitation_property"
            )
        ]


class OrganizationPropertyRelationship(BaseModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="property_relationships"
    )
    property = models.ForeignKey(
        "property.Property", on_delete=models.CASCADE, related_name="organization_relationships"
    )
    relationship_type = models.CharField(max_length=24, choices=OrganizationPropertyRole.choices)
    granted_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    authority_verification_id = models.UUIDField(null=True, blank=True, db_index=True)
    authority_verified_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "organization_property_relationship"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "property", "relationship_type"],
                condition=models.Q(ended_at__isnull=True),
                name="org_unique_active_property_relationship",
            )
        ]
        indexes = [
            models.Index(fields=["organization", "ended_at"], name="org_property_org_idx"),
            models.Index(fields=["property", "ended_at"], name="org_property_resource_idx"),
        ]


class PropertyAssignment(BaseModel):
    membership = models.ForeignKey(
        OrganizationMembership, on_delete=models.CASCADE, related_name="property_assignments"
    )
    property = models.ForeignKey(
        "property.Property", on_delete=models.CASCADE, related_name="member_assignments"
    )
    assigned_by = models.ForeignKey(
        "identity.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    ended_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "organization_property_assignment"
        constraints = [
            models.UniqueConstraint(
                fields=["membership", "property"],
                condition=models.Q(ended_at__isnull=True),
                name="org_unique_active_property_assignment",
            )
        ]
        indexes = [models.Index(fields=["property", "ended_at"], name="org_assignment_idx")]
