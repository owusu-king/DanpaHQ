from django.contrib import admin

from .models import Lease, LeaseAgreement, LeaseTemplate


@admin.register(Lease)
class LeaseAdmin(admin.ModelAdmin):
    list_display = ("__str__", "status", "advance_months", "starts_on", "activated_at")
    list_filter = ("status",)
    search_fields = ("tenant__phone", "landlord__phone")
    raw_id_fields = ("unit", "landlord", "tenant", "application", "listing", "supersedes")
    # Acceptance timestamps are the evidence in a dispute. Support reads them;
    # nobody edits them.
    readonly_fields = (
        "offered_at",
        "landlord_accepted_at",
        "tenant_accepted_at",
        "activated_at",
    )


@admin.register(LeaseTemplate)
class LeaseTemplateAdmin(admin.ModelAdmin):
    list_display = ("code", "version", "jurisdiction", "review_status", "released_at")
    list_filter = ("jurisdiction", "review_status")
    search_fields = ("code", "version", "title")
    readonly_fields = ("code", "version", "clauses", "source_manifest", "released_at")


@admin.register(LeaseAgreement)
class LeaseAgreementAdmin(admin.ModelAdmin):
    list_display = ("reference_number", "lease", "template_version", "executed_at")
    search_fields = ("reference_number", "lease__tenant__phone", "lease__landlord__phone")
    readonly_fields = (
        "lease",
        "terms",
        "content_hash",
        "schema_version",
        "hash_scope",
        "template_code",
        "template_version",
        "legal_review_status",
        "reference_number",
        "rendered_document",
        "rendered_text",
        "executed_at",
        "advance_stance",
        "advance_threshold_months",
        "advance_acknowledged",
        "final_pdf_hash",
        "final_pdf_generated_at",
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
