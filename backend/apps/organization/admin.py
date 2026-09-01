from django.contrib import admin

from .models import (
    Organization,
    OrganizationActivity,
    OrganizationInvitation,
    OrganizationInvitationProperty,
    OrganizationMembership,
    OrganizationPropertyRelationship,
    PropertyAssignment,
)

admin.site.register(Organization)
admin.site.register(OrganizationActivity)
admin.site.register(OrganizationInvitation)
admin.site.register(OrganizationInvitationProperty)
admin.site.register(OrganizationMembership)
admin.site.register(OrganizationPropertyRelationship)
admin.site.register(PropertyAssignment)
