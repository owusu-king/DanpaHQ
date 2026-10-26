"""Append-only audit log.

This table is the answer to "who changed the rent, and when?" - a question that
decides disputes. Its integrity properties matter more than its ergonomics:

* **Append-only.** ``save()`` on an existing row raises. There is no update path
  and no soft delete, and a database-level rule blocks UPDATE and DELETE for the
  application role (see the migration in this app).
* **Denormalised actor.** The actor's id *and* their display label at the time
  are stored. If the account is later deleted, the record still reads sensibly.
* **Hash chain.** Each row stores the digest of the previous row for the same
  aggregate, so a silent edit or deletion in the middle of a history becomes
  detectable. This is tamper *evidence*, not tamper *proofing* - anyone with
  write access to the database could recompute the chain. Real prevention is the
  database grants, and eventually shipping the log off-box.
"""

from __future__ import annotations

import hashlib
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from apps.core.models import BaseModel


class AuditAction(models.TextChoices):
    CREATE = "create", "Created"
    UPDATE = "update", "Updated"
    DELETE = "delete", "Deleted"
    VIEW = "view", "Viewed"  # only for sensitive reads: ID documents, payouts
    LOGIN = "login", "Signed in"
    LOGIN_FAILED = "login_failed", "Sign-in failed"
    PASSWORD_CHANGE = "password_change", "Password changed"
    PERMISSION_CHANGE = "permission_change", "Permissions changed"
    VERIFICATION_DECISION = "verification_decision", "Verification decided"
    MONEY_MOVEMENT = "money_movement", "Money moved"
    EXPORT = "export", "Data exported"


class AuditLog(BaseModel):
    action = models.CharField(max_length=32, choices=AuditAction.choices)

    aggregate_type = models.CharField(max_length=64)  # "listing", "lease"
    aggregate_id = models.CharField(max_length=64)

    actor = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_entries",
    )
    actor_label = models.CharField(max_length=120, blank=True)
    actor_role = models.CharField(max_length=40, blank=True)
    # Management principals deliberately do not live in identity.User. Keep a
    # denormalised id so audit remains readable if the operational account is
    # later deactivated or removed, without coupling this platform table to a
    # domain foreign key.
    management_actor_id = models.UUIDField(null=True, blank=True, db_index=True)
    on_behalf_of = models.ForeignKey(
        "identity.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_entries_on_behalf",
        help_text="Set when staff act for a user, e.g. phone support.",
    )

    # Recorded values are domain values: UUIDs, dates, money Decimals. The
    # encoder must match the one compute_hash uses, or a row would hash
    # differently on write and on verification.
    changes = models.JSONField(  # {"field": [old, new]}
        default=dict, blank=True, encoder=DjangoJSONEncoder
    )
    metadata = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)

    request_id = models.CharField(max_length=64, blank=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    source = models.CharField(max_length=20, blank=True)

    previous_hash = models.CharField(max_length=64, blank=True)
    entry_hash = models.CharField(max_length=64, blank=True, db_index=True)

    class Meta:
        db_table = "audit_log"
        ordering = ("-created_at",)
        indexes = [
            models.Index(
                fields=["aggregate_type", "aggregate_id", "-created_at"], name="audit_aggregate_idx"
            ),
            models.Index(fields=["actor", "-created_at"], name="audit_actor_idx"),
            models.Index(fields=["action", "-created_at"], name="audit_action_idx"),
        ]

    def compute_hash(self) -> str:
        """Digest of this entry, chained to the previous one.

        Deliberately computable *before* the row is inserted. ``created_at`` is
        not in the material because the database assigns it, and needing it
        would force an UPDATE after the INSERT - the one operation the
        append-only rules in ``apps/core/sql/audit_append_only.sql`` forbid. The id is
        a UUIDv7, so the creation time is already inside the hashed material.
        """
        values = {
            "id": str(self.id),
            "action": self.action,
            "aggregate": f"{self.aggregate_type}:{self.aggregate_id}",
            "actor": str(self.actor_id or ""),
            # Everything a dispute would turn on is covered. A field left
            # out of the material is a field an editor can change without
            # the chain noticing, which defeats the point of having one.
            "actor_label": self.actor_label,
            "actor_role": self.actor_role,
            "on_behalf_of": str(self.on_behalf_of_id or ""),
            "changes": self.changes,
            "metadata": self.metadata,
            "request_id": self.request_id,
            "ip_address": self.ip_address or "",
            "source": self.source,
            "previous": self.previous_hash,
        }
        # Existing audit entries predate this field. Omitting the empty key is
        # what lets their original hashes continue to verify after migration.
        if self.management_actor_id:
            values["management_actor"] = str(self.management_actor_id)
        material = json.dumps(
            values,
            sort_keys=True,
            cls=DjangoJSONEncoder,
        )
        return hashlib.sha256(material.encode()).hexdigest()

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Audit entries are append-only and cannot be modified.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Audit entries cannot be deleted.")

    def __str__(self) -> str:
        return f"{self.action} {self.aggregate_type}:{self.aggregate_id}"
