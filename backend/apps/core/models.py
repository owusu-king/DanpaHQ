"""Abstract model layer.

Every table in the platform inherits from :class:`BaseModel`. The guarantees it
buys us are the ones that are painful to retrofit once there is production data:
a time-ordered opaque primary key, honest timestamps, optimistic-locking
versions, and soft deletion that does not quietly hide rows from the code paths
that must still see them (audit, finance, disputes).
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from .ids import uuid7


class TimeStampedQuerySet(models.QuerySet):
    def created_between(self, start, end):
        return self.filter(created_at__gte=start, created_at__lt=end)


class SoftDeleteQuerySet(TimeStampedQuerySet):
    def alive(self):
        return self.filter(deleted_at__isnull=True)

    def dead(self):
        return self.filter(deleted_at__isnull=False)

    def delete(self):
        """Bulk soft delete. Use ``hard_delete()`` for a real DELETE."""
        return self.update(deleted_at=timezone.now())

    def hard_delete(self):
        return super().delete()


class AliveQuerySet(SoftDeleteQuerySet):
    """The queryset behind ``objects``, which has already excluded dead rows.

    ``dead()`` is refused rather than answered, because answering it would mean
    returning an empty list for a question the caller expected rows from - the
    filters compose to "deleted and not deleted".
    """

    def dead(self):
        raise NotImplementedError(
            "Model.objects hides soft-deleted rows, so objects.dead() is always "
            "empty. Use Model.all_objects.dead()."
        )


class AliveManager(models.Manager.from_queryset(AliveQuerySet)):
    """Default manager: hides soft-deleted rows.

    ``Model.objects`` is filtered. ``Model.all_objects`` is not. Anything that
    must reason about deleted rows - audit exports, financial reconciliation, a
    dispute over a listing that was taken down - uses ``all_objects`` explicitly,
    which makes that intent visible in review.
    """

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = models.Manager.from_queryset(TimeStampedQuerySet)()

    class Meta:
        abstract = True
        get_latest_by = "created_at"


class SoftDeleteModel(BaseModel):
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_reason = models.CharField(max_length=200, blank=True)

    objects = AliveManager()
    all_objects = models.Manager.from_queryset(SoftDeleteQuerySet)()

    class Meta:
        abstract = True

    def delete(self, using=None, keep_parents=False, reason: str = ""):
        self.deleted_at = timezone.now()
        self.deleted_reason = reason
        self.save(update_fields=["deleted_at", "deleted_reason", "updated_at"])

    def hard_delete(self, using=None, keep_parents=False):
        return super().delete(using=using, keep_parents=keep_parents)

    def restore(self):
        self.deleted_at = None
        self.deleted_reason = ""
        self.save(update_fields=["deleted_at", "deleted_reason", "updated_at"])


class StaleVersion(RuntimeError):
    """Raised when a row moved on between being read and being written."""


class VersionedModel(models.Model):
    """Optimistic locking for records two people edit at once.

    A landlord on web and an agent on mobile can both open the same listing.
    Last-write-wins would silently discard one of them; this makes the second
    write fail loudly so the UI can re-present the conflict.

    The lock is the conditional UPDATE below, not the counter. Incrementing
    ``version`` with an ``F`` expression would renumber the row without ever
    noticing the other writer - which is the failure this class exists to stop.
    """

    version = models.PositiveIntegerField(default=0)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self._state.adding or self.pk is None:
            return super().save(*args, **kwargs)

        expected = self.version
        # Claim the row at the version we read. Nobody else can be holding it at
        # that number, so zero rows updated means someone already wrote.
        claimed = (
            type(self)
            ._base_manager.filter(pk=self.pk, version=expected)
            .update(version=expected + 1)
        )
        if not claimed:
            raise StaleVersion(
                f"{type(self).__name__} {self.pk} was changed by someone else "
                f"(expected version {expected}). Re-read it and try again."
            )

        self.version = expected + 1
        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = [*update_fields, "version"]
        return super().save(*args, **kwargs)


class ActorStampedModel(models.Model):
    """Who created and last touched this row.

    Nullable on purpose: rows are also created by webhooks, Celery jobs and data
    migrations, and pretending a system action had a human author is worse than
    recording that it did not.
    """

    created_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        db_index=False,
    )
    updated_by = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        db_index=False,
    )

    class Meta:
        abstract = True
