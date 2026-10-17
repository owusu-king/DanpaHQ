from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from apps.core.health import healthz, readyz


def _superadmin_only(request):
    user = request.user
    return bool(
        user
        and user.is_active
        and user.is_staff
        and user.is_superuser
        and user.is_email_verified
    )


# Django Admin is the Super Admin system. Even a previously issued non-super
# staff session cannot enter it after this boundary is deployed.
admin.site.has_permission = _superadmin_only

urlpatterns = [
    path(settings.ADMIN_URL if hasattr(settings, "ADMIN_URL") else "admin/", admin.site.urls),
    path("api/v1/", include("apps.api.urls", namespace="v1")),
    # Unversioned so orchestrators never need to know the API version.
    path("healthz", healthz, name="healthz"),
    path("readyz", readyz, name="readyz"),
]

if settings.DEBUG:
    from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    ]
