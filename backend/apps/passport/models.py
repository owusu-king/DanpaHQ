"""Housing Passport: a tenant's housing history, and who they chose to show it.

The passport itself is **not stored**. It is read, every time, from the records
that already own each fact — tenancies and their accepted agreements, the rent
ledger, identity verifications — so there is no second housing history to drift
from the first, and a correction made at the source is the correction everyone
sees. What this module owns is only what exists nowhere else:

* **PassportShare** — the tenant's consent to show a chosen part of that record
  to someone, through a link that expires and can be withdrawn. The scope is
  stored; the content is not. A recipient opening the link a week later sees
  today's facts about the records the tenant chose, never a snapshot that a
  revocation or a correction cannot reach.
* **PassportCorrection** — the tenant saying a record is wrong. It is reviewed
  by Management in the existing support queue, and while it is open the record
  is shown as disputed to the tenant and to anyone they have shared it with.

Nothing here scores anyone. Absence of a record is absence, not evidence.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class PassportShare(BaseModel):
    """One read-only link to a scoped view of one person's passport."""

    owner = models.ForeignKey(
        "identity.User", on_delete=models.CASCADE, related_name="passport_shares"
    )
    #: Who it is for, in the owner's words. Shown to the recipient as well, and
    #: the form says so.
    recipient_label = models.CharField(max_length=80, blank=True)

    include_identity = models.BooleanField(default=True)
    #: The tenancies chosen, by id. Validated against the owner's own records
    #: when the link is made and filtered again on every read.
    tenancy_ids = models.JSONField(default=list, blank=True)
    include_payments = models.BooleanField(default=True)
    #: Rent and payment amounts are a separate decision from the payment record:
    #: someone may want to show they always paid on time without saying how much.
    include_amounts = models.BooleanField(default=False)

    #: SHA-256 of the link token. The token itself is derived from `salt` under
    #: a server-held pepper (see `apps.passport.tokens`), so the owner can copy
    #: their link again while a database read alone never yields one.
    token_digest = models.CharField(max_length=64, unique=True)
    salt = models.CharField(max_length=32)

    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    view_count = models.PositiveIntegerField(default=0)
    first_viewed_at = models.DateTimeField(null=True, blank=True)
    last_viewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "passport_share"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["owner", "-created_at"], name="passport_share_owner_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expires_at__gt=models.F("created_at")),
                name="passport_share_expires_after_creation",
            ),
        ]

    def __str__(self) -> str:
        return f"passport share {self.id} by {self.owner_id}"

    @property
    def state(self) -> str:
        if self.revoked_at is not None:
            return "revoked"
        if self.expires_at <= timezone.now():
            return "expired"
        return "active"


class CorrectionRecord(models.TextChoices):
    IDENTITY = "identity", "Identity checks"
    TENANCY = "tenancy", "Tenancy"
    PAYMENTS = "payments", "Rent payments"


class PassportCorrection(BaseModel):
    """A tenant reporting that a record in their passport is wrong."""

    owner = models.ForeignKey(
        "identity.User", on_delete=models.CASCADE, related_name="passport_corrections"
    )
    record_type = models.CharField(max_length=16, choices=CorrectionRecord.choices)
    #: The tenancy id for a tenancy or its payments; empty for identity.
    record_id = models.CharField(max_length=64, blank=True)
    reason = models.TextField(max_length=1000)
    #: The support conversation Management reviews it in. Its state is the
    #: correction's state; nothing here duplicates it.
    support_case_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "passport_correction"
        ordering = ("-created_at",)
        indexes = [
            models.Index(
                fields=["owner", "record_type", "record_id"], name="passport_corr_record_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"correction of {self.record_type} {self.record_id} by {self.owner_id}"
