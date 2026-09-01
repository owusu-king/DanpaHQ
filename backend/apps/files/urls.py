"""Files URL patterns.

The local-backend receiver is mounted at /storage/ when running in local mode.
In production (or when STORAGE_BACKEND=s3) the PUT and GET on /storage/ never
exist: those verbs go directly to object storage. Having them registered but
unreachable is still wrong—a request that hits the wrong URL in production would
get a 403 instead of a 404, which is confusing—so they are only registered when
the backend is local.
"""

from __future__ import annotations

from django.conf import settings
from django.urls import path

from . import views

app_name = "files"

urlpatterns = [
    path("files/limits/", views.UploadLimitsView.as_view(), name="limits"),
    path("files/uploads/", views.ReserveUploadView.as_view(), name="reserve"),
    path("files/uploads/<uuid:pk>/complete/", views.CompleteUploadView.as_view(), name="complete"),
    path("files/<uuid:pk>/", views.FileDetailView.as_view(), name="detail"),
    path("files/<uuid:pk>/download/", views.FileDownloadView.as_view(), name="download"),
]

# Local-backend receiver. Mounted separately and only when needed, so there
# is no route in the production URL table that talks to the filesystem.
_STORAGE_BACKEND = getattr(settings, "STORAGE_BACKEND", "s3")

if _STORAGE_BACKEND == "local":
    from django.urls import re_path

    urlpatterns += [
        re_path(
            r"^storage/upload/(?P<key>.+)$",
            views.local_upload,
            name="local-upload",
        ),
        re_path(
            r"^storage/download/(?P<key>.+)$",
            views.local_download,
            name="local-download",
        ),
    ]
