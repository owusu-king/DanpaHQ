"""Review console.

Designed for the person doing the work: the queue is ordered by urgency, the
evidence is inline with the decision, and the decision fields make it hard to
approve without a note or reject without saying what to fix.

Decisions are not made by editing the model here. The admin surfaces the record;
approvals go through the service layer so the audit entry and the event are never
skipped.
"""

from django.contrib import admin, messages
from django.utils.html import format_html

from . import services
from .models import ReviewQueueEntry, Verification, VerificationEvidence


class EvidenceInline(admin.TabularInline):
    model = VerificationEvidence
    extra = 0
    fields = ("evidence_type", "file", "reference", "collected_at", "notes")
    readonly_fields = ("collected_at",)
    can_delete = False


@admin.register(Verification)
class VerificationAdmin(admin.ModelAdmin):
    list_display = (
        "kind",
        "subject_type",
        "subject_id",
        "state_badge",
        "method",
        "decided_by",
        "decided_at",
        "expires_at",
    )
    list_filter = ("kind", "status", "method", "subject_type", "created_at")
    search_fields = ("subject_id", "provider_reference")
    readonly_fields = (
        "status",
        "decided_by",
        "decided_by_management_id",
        "created_at",
        "updated_at",
        "decided_at",
        "expires_at",
        "supersedes",
    )
    inlines = [EvidenceInline]
    actions = ("approve_through_workflow", "reject_through_workflow")

    @admin.action(description="Approve selected checks through the audited workflow")
    def approve_through_workflow(self, request, queryset):
        completed = 0
        for verification in queryset:
            try:
                services.decide(
                    verification,
                    approved=True,
                    decided_by=request.user,
                    note=verification.decision_note or "Approved by Super Admin.",
                )
                completed += 1
            except Exception as exc:
                self.message_user(request, f"{verification}: {exc}", level=messages.ERROR)
        if completed:
            self.message_user(
                request,
                f"Approved {completed} verification{'s' if completed != 1 else ''}.",
                level=messages.SUCCESS,
            )

    @admin.action(description="Reject selected checks using their decision note")
    def reject_through_workflow(self, request, queryset):
        completed = 0
        for verification in queryset:
            if not verification.decision_note.strip():
                self.message_user(
                    request,
                    f"{verification}: add an actionable decision note before rejecting.",
                    level=messages.ERROR,
                )
                continue
            try:
                services.decide(
                    verification,
                    approved=False,
                    decided_by=request.user,
                    note=verification.decision_note,
                )
                completed += 1
            except Exception as exc:
                self.message_user(request, f"{verification}: {exc}", level=messages.ERROR)
        if completed:
            self.message_user(
                request,
                f"Rejected {completed} verification{'s' if completed != 1 else ''}.",
                level=messages.SUCCESS,
            )

    @admin.display(description="State")
    def state_badge(self, obj):
        colours = {
            "verified": "#0B5D4E",
            "pending": "#8A6408",
            "expired": "#A93B23",
            "unverified": "#5C6B66",
        }
        state = obj.display_state
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            colours.get(state, "#5C6B66"),
            state,
        )

    def has_delete_permission(self, request, obj=None):
        # Verifications are superseded or revoked, never deleted: the history of
        # what was believed and when is the point.
        return False


@admin.register(ReviewQueueEntry)
class ReviewQueueAdmin(admin.ModelAdmin):
    list_display = (
        "verification",
        "priority",
        "claimed_by",
        "waiting",
        "created_at",
        "resolved_at",
    )
    list_filter = ("priority", "resolved_at")

    @admin.display(description="Waiting")
    def waiting(self, obj):
        hours = obj.waiting_hours
        if hours < 1:
            return f"{int(hours * 60)} min"
        if hours < 48:
            return f"{hours:.1f} h"
        return f"{hours / 24:.1f} days"
