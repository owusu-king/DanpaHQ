"""Authentication boundary for the separate operations application.

Consumer sessions use phone OTP and bearer tokens. Django admin uses this
backend instead: a provisioned, email-verified staff principal with a usable
password. MFA remains an explicit production gate rather than being faked in
the consumer application.
"""

from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import BaseBackend
from django.contrib.auth.forms import AuthenticationForm
from django.core.exceptions import ValidationError


class AdminEmailBackend(BaseBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        email = (kwargs.get("email") or username or "").strip()
        if not email or not password:
            return None

        user_model = get_user_model()
        user = user_model.objects.filter(email__iexact=email, is_superuser=True).first()
        if (
            user is None
            or not user.is_active
            or not user.is_email_verified
            or not user.has_usable_password()
            or not user.check_password(password)
        ):
            return None
        return user

    def get_user(self, user_id):
        user_model = get_user_model()
        return user_model.objects.filter(pk=user_id, is_superuser=True, is_active=True).first()


class AdminEmailAuthenticationForm(AuthenticationForm):
    username = forms.EmailField(
        label="Admin email",
        widget=forms.EmailInput(attrs={"autofocus": True, "autocomplete": "username"}),
    )

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_superuser or not user.is_email_verified:
            raise ValidationError(
                "This account is not authorized for Super Admin.", code="invalid_login"
            )
