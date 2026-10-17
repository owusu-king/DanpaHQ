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
from django.core.validators import validate_email

ADMIN_EMAIL_MAX_LENGTH = 254


def _normalise_admin_email(value: str | None) -> str | None:
    """Apply the same lower-case policy as the account email-verification flow."""
    email = (value or "").strip().lower()
    if not email or len(email) > ADMIN_EMAIL_MAX_LENGTH:
        return None
    try:
        validate_email(email)
    except ValidationError:
        return None
    return email


class AdminEmailBackend(BaseBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        email = _normalise_admin_email(kwargs.get("email") or username)
        if email is None or password is None:
            return None

        user_model = get_user_model()
        try:
            user = user_model.objects.get(email__iexact=email, is_superuser=True)
        except (user_model.DoesNotExist, user_model.MultipleObjectsReturned):
            # Match Django's ModelBackend timing protection: an unknown or
            # non-superuser email must still pay the cost of one password hash.
            # Case-insensitive duplicates fail closed instead of selecting an
            # arbitrary privileged account.
            user_model().set_password(password)
            return None

        if user.has_usable_password():
            password_is_valid = user.check_password(password)
        else:
            user_model().set_password(password)
            password_is_valid = False
        if not password_is_valid or not self.user_can_authenticate(user):
            return None
        return user

    def get_user(self, user_id):
        user_model = get_user_model()
        user = user_model.objects.filter(pk=user_id).first()
        return user if user is not None and self.user_can_authenticate(user) else None

    @staticmethod
    def user_can_authenticate(user) -> bool:
        return bool(
            user.is_active
            and user.is_staff
            and user.is_superuser
            and user.is_email_verified
            and _normalise_admin_email(user.email) is not None
            and user.has_usable_password()
        )


class AdminEmailAuthenticationForm(AuthenticationForm):
    username = forms.EmailField(
        label="Admin email",
        max_length=ADMIN_EMAIL_MAX_LENGTH,
        widget=forms.EmailInput(
            attrs={
                "autofocus": True,
                "autocomplete": "username",
                "autocapitalize": "none",
                "spellcheck": "false",
            }
        ),
    )

    def __init__(self, request=None, *args, **kwargs):
        super().__init__(request, *args, **kwargs)
        # AuthenticationForm always copies max_length from USERNAME_FIELD.
        # Danpa HQ intentionally uses a 16-character phone field globally, but
        # this separate admin boundary accepts an RFC-sized email address.
        self.fields["username"].max_length = ADMIN_EMAIL_MAX_LENGTH
        self.fields["username"].widget.attrs["maxlength"] = ADMIN_EMAIL_MAX_LENGTH

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_staff or not user.is_superuser or not user.is_email_verified:
            raise ValidationError(
                "This account is not authorized for Super Admin.", code="invalid_login"
            )
