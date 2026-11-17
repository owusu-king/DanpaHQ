"""One optional walkthrough per Property or Unit; never a required photo."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.files.models import StoredFile
from apps.files.videos import MAX_DURATION_MS
from apps.trust import condition

from . import services, spaces
from .models import Property, Unit


@transaction.atomic
def set_video(*, subject, user, file_id):
    model = type(subject)
    subject = model.objects.select_for_update().get(pk=subject.pk)
    prop = subject if isinstance(subject, Property) else subject.property
    services.assert_can_manage(prop, user)
    from apps.billing import enforcement as billing

    billing.assert_details_editable(
        **({"prop": prop} if isinstance(subject, Property) else {"unit": subject})
    )
    if isinstance(subject, Unit):
        spaces.assert_not_occupied_for_sensitive_change(subject)
        spaces.assert_editable(subject)
    elif not condition.is_editable(subject):
        raise Conflict("Start a re-check before changing this Property's video.")
    file = None
    if file_id is not None:
        file = StoredFile.objects.select_for_update().filter(pk=file_id).first()
        if file is None:
            raise NotFound("That upload could not be found.")
        if not file.is_owned_by(user):
            raise PermissionDenied("That upload belongs to another account.")
        expected = "property_video" if isinstance(subject, Property) else "unit_video"
        if (
            file.purpose != expected
            or file.is_sensitive
            or not file.is_usable
            or not file.metadata.get("video_validated")
            or not 0 < file.metadata.get("duration_ms", 0) <= MAX_DURATION_MS
        ):
            raise ValidationFailed("Choose a checked video of 15 seconds or less.")
        if model.objects.filter(video=file).exclude(pk=subject.pk).exists():
            raise Conflict("This video is already attached to another record.")
    if subject.video_id == (file.pk if file else None):
        return subject  # Lost-response retries do not add records or audit events.
    previous = str(subject.video_id) if subject.video_id else None
    from apps.trust.models import Verification

    if (
        subject.video_id
        and not Verification.objects.filter(
            provider_response__walkthrough_file_id=str(subject.video_id),
        ).exists()
    ):
        StoredFile.objects.filter(pk=subject.video_id).update(
            retain_until=timezone.localdate() + timedelta(days=7),
        )
    if file is not None:
        file.retain_until = None
        file.save(update_fields=["retain_until", "updated_at"])
    subject.video = file
    subject.save(update_fields=["video", "updated_at"])
    record(
        action=AuditAction.UPDATE,
        actor=user,
        aggregate_type="property" if isinstance(subject, Property) else "unit",
        aggregate_id=subject.id,
        changes={"video": [previous, str(file.pk) if file else None]},
    )
    return subject
