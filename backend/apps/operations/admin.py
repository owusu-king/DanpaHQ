from typing import ClassVar

from django import forms
from django.contrib import admin
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import ManagementReport, ManagementSession, ManagementUser, SupportCase


class ManagementUserCreationForm(forms.ModelForm):
    password1 = forms.CharField(widget=forms.PasswordInput, label="Temporary password")
    password2 = forms.CharField(widget=forms.PasswordInput, label="Confirm password")

    class Meta:
        model = ManagementUser
        fields = ("email", "first_name", "last_name", "role", "is_active")

    def clean_password2(self):
        first = self.cleaned_data.get("password1")
        second = self.cleaned_data.get("password2")
        if first != second:
            raise forms.ValidationError("The passwords do not match.")
        validate_password(second, user=self.instance)
        return second

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_password(self.cleaned_data["password1"])
        user.must_change_password = True
        if commit:
            user.save()
        return user


class ManagementUserChangeForm(forms.ModelForm):
    new_password = forms.CharField(
        label="New password",
        widget=forms.PasswordInput,
        required=False,
        help_text=(
            "Leave blank to keep the current password. "
            "If a new password is set, the user will be required "
            "to change it on their next login."
        ),
    )

    confirm_password = forms.CharField(
        label="Confirm new password",
        widget=forms.PasswordInput,
        required=False,
    )

    class Meta:
        model = ManagementUser
        fields = (
            "email",
            "first_name",
            "last_name",
            "role",
            "is_active",
            "must_change_password",
            "new_password",
            "confirm_password",
        )

    def clean(self):
        cleaned_data = super().clean()

        new_password = cleaned_data.get("new_password")
        confirm_password = cleaned_data.get("confirm_password")

        # No password change requested.
        if not new_password and not confirm_password:
            return cleaned_data

        if not new_password:
            self.add_error(
                "new_password",
                "Enter a new password.",
            )
            return cleaned_data

        if not confirm_password:
            self.add_error(
                "confirm_password",
                "Confirm the new password.",
            )
            return cleaned_data

        if new_password != confirm_password:
            self.add_error(
                "confirm_password",
                "The passwords do not match.",
            )
            return cleaned_data

        validate_password(new_password, user=self.instance)

        return cleaned_data

    def save(self, commit=True):
        user = super().save(commit=False)

        new_password = self.cleaned_data.get("new_password")

        if new_password:
            user.set_password(new_password)
            user.must_change_password = True

        if commit:
            user.save()

        return user

    @property
    def password_changed(self):
        return bool(self.cleaned_data.get("new_password"))


@admin.register(ManagementUser)
class ManagementUserAdmin(admin.ModelAdmin):
    add_form = ManagementUserCreationForm
    form = ManagementUserChangeForm

    list_display = (
        "email",
        "display_name",
        "role",
        "is_active",
        "last_login",
    )

    list_filter = (
        "role",
        "is_active",
        "must_change_password",
    )

    search_fields = (
        "email",
        "first_name",
        "last_name",
    )

    readonly_fields = (
        "password",
        "last_login",
        "last_login_ip",
        "failed_login_count",
        "locked_until",
        "deactivated_at",
        "created_at",
        "updated_at",
    )

    def get_form(self, request, obj=None, **kwargs):
        if obj is None:
            kwargs["form"] = self.add_form
        else:
            kwargs["form"] = self.form

        return super().get_form(request, obj, **kwargs)

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return (
                (
                    None,
                    {
                        "fields": (
                            "email",
                            "first_name",
                            "last_name",
                            "role",
                            "is_active",
                            "password1",
                            "password2",
                        )
                    },
                ),
            )

        return (
            (
                None,
                {
                    "fields": (
                        "email",
                        "first_name",
                        "last_name",
                        "role",
                        "is_active",
                        "must_change_password",
                    )
                },
            ),
            (
                "Set password",
                {
                    "fields": (
                        "new_password",
                        "confirm_password",
                    ),
                    "description": ("Leave these fields blank to keep the existing password."),
                },
            ),
            (
                "Authentication",
                {
                    "fields": (
                        "password",
                        "last_login",
                        "last_login_ip",
                        "failed_login_count",
                        "locked_until",
                    )
                },
            ),
            (
                "Account status",
                {
                    "fields": (
                        "deactivated_at",
                        "created_at",
                        "updated_at",
                    )
                },
            ),
        )

    def save_model(self, request, obj, form, change):
        previous = None

        if change:
            previous = ManagementUser.objects.filter(id=obj.id).first()

        if not obj.is_active:
            obj.deactivated_at = obj.deactivated_at or timezone.now()
        else:
            obj.deactivated_at = None

        super().save_model(request, obj, form, change)

        if not obj.is_active:
            now = timezone.now()

            ManagementSession.objects.filter(
                user=obj,
                revoked_at__isnull=True,
            ).update(
                revoked_at=now,
                revoked_reason="superadmin_deactivated",
                updated_at=now,
            )

        password_changed = (
            change and isinstance(form, ManagementUserChangeForm) and form.password_changed
        )

        changes = {
            "role": [
                previous.role if previous else "",
                obj.role,
            ],
            "is_active": [
                previous.is_active if previous else False,
                obj.is_active,
            ],
        }

        record(
            action=AuditAction.PERMISSION_CHANGE,
            aggregate_type="management_user",
            aggregate_id=obj.id,
            actor=request.user,
            actor_role="super_admin",
            changes=changes,
            metadata={
                "created": not change,
                "password_changed": password_changed,
                "surface": "django_super_admin",
            },
        )

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ManagementSession)
class ManagementSessionAdmin(admin.ModelAdmin):
    list_display = ("user", "issued_at", "expires_at", "revoked_at", "ip_address")
    readonly_fields: ClassVar[list[str]] = [field.name for field in ManagementSession._meta.fields]
    exclude = ("token_hash", "csrf_hash")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ManagementReport)
class ManagementReportAdmin(admin.ModelAdmin):
    list_display = ("summary", "subject_type", "status", "priority", "assigned_to", "created_at")
    list_filter = ("subject_type", "status", "priority")
    search_fields = ("summary", "details", "subject_id")


@admin.register(SupportCase)
class SupportCaseAdmin(admin.ModelAdmin):
    list_display = ("summary", "user", "status", "priority", "assigned_to", "created_at")
    list_filter = ("category", "status", "priority")
    search_fields = ("summary", "details", "user__phone")
