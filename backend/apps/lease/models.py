"""Leases — the agreement itself.

This is the record the whole product exists to produce. When a tenant says "we
agreed six months, not twelve" eight months later, this is what answers them,
and that only works if three things hold:

* **Terms are a snapshot, not a reference.** The listing can be edited or
  withdrawn and the rent on it changed; none of that may alter what was agreed.
  Every term is copied onto the lease when it is offered.
* **Neither side can bind the other alone.** A lease becomes binding only when
  both parties have accepted, and each acceptance is separately timestamped. A
  landlord marking a lease "signed" on their own is exactly the move this
  prevents.
* **Nothing is edited after acceptance.** A change is a new lease that
  supersedes the old one, so the history stays readable.

### The advance rent question

Ghana's Rent Act 1963 (Act 220) limits rent paid in advance on a monthly
tenancy to six months. In practice one and two year advances are routine, and
that gap is the single most consequential thing about renting here.

This module records what was actually agreed either way. What the product then
*says* about it - nothing, a plainly stated notice, or a refusal - is a
configurable decision in ``apps.lease.advance_policy`` rather than a rule
hard-coded here, because it turns on a legal reading this codebase is not
entitled to make. The default states the threshold and refuses nothing. It is
not legal advice - see ``docs/known-limitations.md``; the wording and the
position need a Ghanaian lawyer's review before this is shown at launch.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from django.db import models
from django.utils import timezone

from apps.core.fields import MoneyField
from apps.core.models import BaseModel

#: The advance-rent threshold, and what the product does about it, now live in
#: `apps.lease.advance_policy` — one definition, configurable by an operator who
#: has taken legal advice. A constant here as well would be a second answer to
#: the same question, and the two would drift the first time one was changed.


class LeaseStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    READY = "ready", "Ready to send"
    OFFERED = "offered", "Waiting for the tenant"
    TENANT_ACCEPTED = "tenant_accepted", "Tenant accepted — provider confirmation needed"
    AWAITING_ACTIVATION = "awaiting_activation", "Accepted — awaiting activation"
    ACTIVE = "active", "Active"
    DECLINED = "declined", "Declined by the tenant"
    CANCELLED = "cancelled", "Cancelled"
    SUPERSEDED = "superseded", "Superseded by a later agreement"
    ENDED = "ended", "Ended"


OPEN_STATUSES = (
    LeaseStatus.DRAFT,
    LeaseStatus.READY,
    LeaseStatus.OFFERED,
    LeaseStatus.TENANT_ACCEPTED,
    LeaseStatus.AWAITING_ACTIVATION,
    LeaseStatus.ACTIVE,
)


class LeaseWorkflow(models.TextChoices):
    """The lifecycle contract an installed client created this lease under."""

    LEGACY = "legacy", "Legacy quick offer"
    CANONICAL = "canonical_v1", "Canonical agreement builder"


class TemplateReviewStatus(models.TextChoices):
    REQUIRES_REVIEW = "requires_ghana_legal_review", "Requires Ghana legal review"
    APPROVED = "approved_for_production", "Approved for production"
    RETIRED = "retired", "Retired"


class AgreementHashScope(models.TextChoices):
    TERMS = "terms_json", "Structured terms"
    RENDERED = "rendered_document", "Complete rendered agreement"


class LeaseTemplate(BaseModel):
    """One immutable release of Rooomly's controlled agreement language.

    Configuration is additive: changing a clause means creating a new version,
    never editing a version an offer may already name. The complete rendered
    result is copied onto ``LeaseAgreement`` as well, so this table is a release
    catalogue rather than a dependency of historical reproduction.
    """

    code = models.CharField(max_length=80)
    version = models.CharField(max_length=24)
    jurisdiction = models.CharField(max_length=8, default="GH")
    agreement_type = models.CharField(max_length=40, default="residential_tenancy")
    title = models.CharField(max_length=180)
    review_status = models.CharField(
        max_length=40,
        choices=TemplateReviewStatus.choices,
        default=TemplateReviewStatus.REQUIRES_REVIEW,
    )
    clauses = models.JSONField(default=list)
    source_manifest = models.JSONField(default=list)
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "lease_template"
        ordering = ("code", "-version")
        constraints = [
            models.UniqueConstraint(
                fields=["code", "version"], name="lease_template_code_version_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.version})"


class LeaseActivationRequirement(models.TextChoices):
    """The event that is allowed to turn an accepted lease into a tenancy.

    Only acceptance is enforced today. ``INITIAL_PAYMENT`` is deliberately a
    reserved seam for Payment Core: choosing it leaves the agreement accepted
    but inactive until a trusted payment event explicitly activates it.
    """

    LEASE_ACCEPTED = "lease_accepted", "Lease accepted"
    INITIAL_PAYMENT = "initial_payment", "Required initial payment confirmed"


class Lease(BaseModel):
    workflow_version = models.CharField(
        max_length=24, choices=LeaseWorkflow.choices, default=LeaseWorkflow.LEGACY
    )
    template = models.ForeignKey(
        LeaseTemplate,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="leases",
    )
    unit = models.ForeignKey("property.Unit", on_delete=models.PROTECT, related_name="leases")
    #: A lease may be of a bed inside the unit rather than the whole of it.
    #: Null is a whole-unit lease, which is every lease the product could write
    #: until now - a four-bed hostel room admitted one live lease in total, so
    #: the arrangement most students in this market actually rent under could
    #: not be recorded at all.
    bed = models.ForeignKey(
        "property.Bed",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="leases",
    )
    landlord = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="leases_as_landlord"
    )
    tenant = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="leases_as_tenant"
    )
    #: The relationship this agreement belongs to. Three successive one-year
    #: leases on the same room are one tenancy, not three - which is the whole
    #: reason the tenancy is a separate record.
    tenancy = models.ForeignKey(
        "tenancy.Tenancy",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="leases",
    )
    #: Where this came from. Null for a lease agreed outside the platform and
    #: recorded afterwards, which is most of this market today.
    application = models.ForeignKey(
        "application.RentalApplication",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leases",
    )
    listing = models.ForeignKey(
        "listing.Listing",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leases",
    )

    status = models.CharField(max_length=24, choices=LeaseStatus.choices, default=LeaseStatus.DRAFT)
    activation_requirement = models.CharField(
        max_length=24,
        choices=LeaseActivationRequirement.choices,
        default=LeaseActivationRequirement.LEASE_ACCEPTED,
    )

    # --- the terms, snapshotted -----------------------------------------------
    rent = MoneyField()
    rent_period = models.CharField(max_length=8, default="monthly")
    advance_months = models.PositiveSmallIntegerField(default=0)
    deposit_months = models.PositiveSmallIntegerField(default=0)
    agency_fee_months = models.PositiveSmallIntegerField(default=0)

    starts_on = models.DateField()
    #: Months, not an end date, because that is how tenancies are agreed here.
    term_months = models.PositiveSmallIntegerField(default=12)
    ends_on = models.DateField(null=True, blank=True)

    #: What is included, in the landlord's own words. Water and electricity
    #: arrangements are the commonest source of a later argument.
    conditions = models.TextField(blank=True, max_length=2000)
    #: Negotiable inputs owned by the builder. Standard legal clauses remain
    #: on the versioned template and cannot be rewritten through this payload.
    structured_terms = models.JSONField(default=dict, blank=True)

    # --- acceptance -----------------------------------------------------------
    offered_at = models.DateTimeField(null=True, blank=True)
    ready_at = models.DateTimeField(null=True, blank=True)
    tenant_reviewed_at = models.DateTimeField(null=True, blank=True)
    landlord_accepted_at = models.DateTimeField(null=True, blank=True)
    tenant_accepted_at = models.DateTimeField(null=True, blank=True)
    provider_confirmed_at = models.DateTimeField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)

    declined_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.CharField(max_length=300, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    ended_on = models.DateField(null=True, blank=True)
    superseded_at = models.DateTimeField(null=True, blank=True)

    #: Set when a later lease replaces this one, so a renegotiation reads as a
    #: history rather than an edit.
    supersedes = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="superseded_by"
    )

    class Meta:
        db_table = "lease_lease"
        ordering = ("-created_at",)
        constraints = [
            # Two live leases on the same thing is the double-letting scam this
            # product exists to make impossible. What "the same thing" means
            # depends on what is being let, so it takes two constraints: a
            # single one keyed on `unit` would have to say that four beds in a
            # room conflict with each other, which is the whole point of beds.
            models.UniqueConstraint(
                fields=["unit"],
                condition=models.Q(
                    status__in=[
                        "draft",
                        "ready",
                        "offered",
                        "tenant_accepted",
                        "awaiting_activation",
                        "active",
                    ],
                    bed__isnull=True,
                    supersedes__isnull=True,
                ),
                name="lease_one_live_per_unit",
            ),
            models.UniqueConstraint(
                fields=["unit", "bed"],
                condition=models.Q(
                    status__in=[
                        "draft",
                        "ready",
                        "offered",
                        "tenant_accepted",
                        "awaiting_activation",
                        "active",
                    ],
                    bed__isnull=False,
                    supersedes__isnull=True,
                ),
                name="lease_one_live_per_bed",
            ),
            models.UniqueConstraint(
                fields=["supersedes"],
                condition=models.Q(
                    supersedes__isnull=False,
                    status__in=[
                        "draft",
                        "ready",
                        "offered",
                        "tenant_accepted",
                        "awaiting_activation",
                        "active",
                    ],
                ),
                name="lease_one_open_amendment_per_version",
            ),
            # The third case - a whole-unit lease against the beds inside it -
            # is not expressible either way round, and lives in
            # `services.assert_target_is_free`, exactly as the equivalent
            # occupancy rule does.
        ]
        indexes = [
            models.Index(fields=["tenant", "-created_at"], name="lease_tenant_idx"),
            models.Index(fields=["landlord", "-created_at"], name="lease_landlord_idx"),
            models.Index(
                fields=["status", "-created_at"],
                name="lease_open_idx",
                condition=models.Q(
                    status__in=[
                        "draft",
                        "ready",
                        "offered",
                        "tenant_accepted",
                        "awaiting_activation",
                        "active",
                    ]
                ),
            ),
        ]

    def __str__(self) -> str:
        return f"lease of {self.unit_id} to {self.tenant_id} ({self.status})"

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES

    @property
    def both_accepted(self) -> bool:
        return self.landlord_accepted_at is not None and self.tenant_accepted_at is not None

    @property
    def move_in_total_minor(self) -> int:
        """Everything due on day one, in pesewas."""
        rent = self.rent_minor or 0
        return rent * (self.advance_months + self.deposit_months + self.agency_fee_months)

    @property
    def advance_total_minor(self) -> int:
        return (self.rent_minor or 0) * self.advance_months

    @property
    def exceeds_statutory_advance(self) -> bool:
        """More advance than the stated threshold, per the configured policy.

        Defers to `advance_policy` rather than comparing against the constant
        itself, so the threshold has one definition. When the policy was a
        literal here and a check elsewhere, an operator changing one would have
        moved the warning without moving the enforcement.

        Informational, and not legal advice - see `apps.lease.advance_policy`.
        """
        from .advance_policy import assess

        return assess(advance_months=self.advance_months, rent_period=self.rent_period).exceeds

    def compute_ends_on(self):
        """The final day before the same calendar date after ``term_months``.

        A twelve-month agreement starting 1 September ends 31 August, not
        27 August after twelve approximated 30-day months. Month-end starts are
        clamped to the last valid day in the destination month.
        """
        if not self.starts_on or not self.term_months:
            return None
        month_index = self.starts_on.month - 1 + self.term_months
        year = self.starts_on.year + month_index // 12
        month = month_index % 12 + 1
        day = min(self.starts_on.day, monthrange(year, month)[1])
        anniversary = date(year, month, day)
        return anniversary - timedelta(days=1)

    @property
    def days_until_start(self) -> int | None:
        if self.starts_on is None:
            return None
        return (self.starts_on - timezone.now().date()).days


# --------------------------------------------------------------------------- #
# The executed agreement
# --------------------------------------------------------------------------- #

#: Bumped when the shape of the frozen terms changes. Stored on every snapshot
#: so an old agreement can still be read by the code that understands it,
#: rather than being reinterpreted by code written afterwards.
TERMS_SCHEMA_VERSION = "2026.08.1"


class AcceptanceParty(models.TextChoices):
    LANDLORD = "landlord", "The provider"
    TENANT = "tenant", "The tenant"


class AcceptanceMethod(models.TextChoices):
    """How the agreement was accepted.

    Only one of these exists today. It is a field rather than an assumption so
    that a formal e-signature provider, or a scanned wet-ink copy, can be added
    later as *another* acceptance record without changing the meaning of the
    ones already stored.
    """

    IN_APP = "in_app_confirmation", "Confirmed in the app"


class LeaseAgreement(BaseModel):
    """What the parties agreed, frozen at the moment both had accepted.

    The lease row keeps moving - it ends, it is superseded, a later phase may
    add fields to it. This does not. It is the answer to "what did we actually
    agree", and it is only useful if it cannot be quietly edited afterwards.

    ### What this is not

    This is a record of what happened in this product: who pressed accept, when,
    and what text was in front of them, with a hash so a later dispute can tell
    whether the stored terms are the ones that were accepted.

    **It is not a claim that this constitutes a legally binding electronic
    signature.** Whether it does under Ghana's Electronic Transactions Act 2008
    (Act 772) is a question for a Ghanaian lawyer, and this codebase does not
    answer it. Nothing here should be presented to a user as one - see
    ``docs/known-limitations.md``. The design keeps a formal signature provider
    addable later as an additional record rather than a replacement, so taking
    that step does not invalidate anything already stored.
    """

    lease = models.OneToOneField(Lease, on_delete=models.PROTECT, related_name="agreement")

    #: The terms as agreed, in full. A copy, not a reference: the lease row it
    #: came from may be superseded tomorrow and that must not change this.
    terms = models.JSONField()
    #: SHA-256 of the canonical serialisation of `terms`. Two parties agreeing
    #: to the same hash agreed to the same words.
    content_hash = models.CharField(max_length=64, db_index=True)
    schema_version = models.CharField(max_length=16, default=TERMS_SCHEMA_VERSION)
    hash_scope = models.CharField(
        max_length=24,
        choices=AgreementHashScope.choices,
        default=AgreementHashScope.TERMS,
    )

    #: The exact contract release and complete rendered words shown to both
    #: parties. These are copies, not references to today's template.
    template_code = models.CharField(max_length=80, blank=True)
    template_version = models.CharField(max_length=24, blank=True)
    legal_review_status = models.CharField(max_length=40, blank=True)
    reference_number = models.CharField(max_length=40, null=True, blank=True, unique=True)
    rendered_document = models.JSONField(default=dict, blank=True)
    rendered_text = models.TextField(blank=True)

    #: Null while the offer is out: the terms are frozen when it is made, but
    #: it is not an agreement until the other party has accepted it.
    executed_at = models.DateTimeField(null=True, blank=True)

    #: What the advance policy said at the time. Recorded because the policy is
    #: configurable, so the setting today does not tell you what was shown then.
    advance_stance = models.CharField(max_length=16, blank=True)
    advance_threshold_months = models.PositiveSmallIntegerField(null=True, blank=True)
    advance_acknowledged = models.BooleanField(default=False)

    #: The final printable artifact is stored as bytes after both acceptance
    #: acts. A later PDF renderer upgrade therefore cannot alter what a 2026
    #: party downloads in 2028.
    final_pdf = models.BinaryField(null=True, blank=True, editable=False)
    final_pdf_hash = models.CharField(max_length=64, blank=True)
    final_pdf_generated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "lease_agreement"
        ordering = ("-executed_at",)

    def __str__(self) -> str:
        return f"agreement for lease {self.lease_id}"

    def save(self, *args, **kwargs):
        """Prevent application code from rewriting an executed snapshot.

        The initial execution write is allowed because it adds the stored PDF
        and execution evidence atomically. After that point, even a Django
        admin or maintenance script must create an amendment instead of
        changing the agreement that both parties accepted.
        """
        if self.pk:
            original = type(self).objects.filter(pk=self.pk).only("executed_at").first()
            if original and original.executed_at is not None:
                raise RuntimeError("Executed lease agreements are immutable; create an amendment.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Lease agreement snapshots cannot be deleted.")


class LeaseAcceptance(BaseModel):
    """One party's act of agreeing, and what was observed while they did it.

    Separate rows per party, never a pair of timestamps on one row, because the
    two acceptances are different events by different people - often days apart,
    from different devices - and a dispute is usually about one of them
    specifically.
    """

    agreement = models.ForeignKey(
        LeaseAgreement, on_delete=models.PROTECT, related_name="acceptances"
    )
    party = models.CharField(max_length=16, choices=AcceptanceParty.choices)
    user = models.ForeignKey(
        "identity.User", on_delete=models.PROTECT, related_name="lease_acceptances"
    )
    accepted_at = models.DateTimeField()
    method = models.CharField(
        max_length=32, choices=AcceptanceMethod.choices, default=AcceptanceMethod.IN_APP
    )

    #: The hash of what *this person* accepted. Normally identical to the
    #: agreement's. Stored separately so that if it ever is not, the record says
    #: so rather than implying an agreement that never happened.
    content_hash = models.CharField(max_length=64)

    #: Circumstances, kept because they are what makes the record worth
    #: anything in a dispute. Deliberately thin: enough to corroborate, not a
    #: device fingerprint.
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "lease_acceptance"
        ordering = ("accepted_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["agreement", "party"],
                name="lease_one_acceptance_per_party",
            )
        ]

    def __str__(self) -> str:
        return f"{self.party} accepted {self.agreement_id}"

    @property
    def matches_agreement(self) -> bool:
        """Whether this person accepted the terms the agreement now holds."""
        return self.content_hash == self.agreement.content_hash


class TermsTemplate(BaseModel):
    """A Portfolio's reusable wording for an agreement's additional terms.

    Rooomly's standard clauses stay controlled: a template never touches them.
    It only pre-fills the clearly labelled custom section of an agreement being
    prepared, where the provider's own wording already lives. Placeholders in
    the body are filled from the same agreement facts the standard clauses use,
    at render time, and the rendered agreement is what is kept - editing or
    deleting a template changes no agreement already prepared from it.
    """

    organization = models.ForeignKey(
        "organization.Organization",
        on_delete=models.CASCADE,
        related_name="terms_templates",
    )
    name = models.CharField(max_length=120)
    body = models.TextField()
    is_default = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        "identity.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="terms_templates_created",
    )

    class Meta:
        db_table = "lease_terms_template"
        ordering = ("-is_default", "name")
        constraints = [
            models.UniqueConstraint(
                fields=["organization"],
                condition=models.Q(is_default=True),
                name="lease_terms_template_one_default",
            )
        ]

    def __str__(self) -> str:
        return self.name
