from django.contrib import admin

from .models import Occupancy, PropertyInvitation, PropertyJoinRequest

admin.site.register(Occupancy)
admin.site.register(PropertyInvitation)
admin.site.register(PropertyJoinRequest)
