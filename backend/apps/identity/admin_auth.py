"""Authentication boundary for the separate operations application.

Consumer sessions use password/Google sign-in and bearer tokens. Django admin uses this
backend instead: a provisioned, email-verified staff principal with a usable
password and a fresh authenticator or recovery code. These credentials remain
separate from consumer authentication.
"""

from typing import ClassVar

from django import forms
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.backends import BaseBackend
from django.contrib.auth.forms import AuthenticationForm
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

from apps.core.context import get_context
from apps.core.exceptions import ProviderUnavailable
from apps.core.throttling import count_attempt

ADMIN_EMAIL_MAX_LENGTH = 254
ADMIN_LOGIN_WINDOW_SECONDS = 15 * 60
ADMIN_LOGIN_MAX_PER_ADDRESS = 20
ADMIN_LOGIN_MAX_PER_EMAIL = 10


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
        user = self.check_primary(kwargs.get("email") or username, password)
        if user is None:
            return None
        from apps.operations.mfa import verify

        proof = verify(user, kwargs.get("otp_code", ""))
        if not proof.accepted:
            return None
        user._admin_mfa_device_id = proof.credential_id
        return user

    @staticmethod
    def check_primary(username, password):
        """First factor only; callers must never open a session from this result."""
        email = _normalise_admin_email(username)
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
        if not password_is_valid or not AdminEmailBackend.user_can_authenticate(user):
            return None
        return user

    def get_user(self, user_id):
        user_model = get_user_model()
        user = user_model.objects.filter(pk=user_id).first()
        if user is None or not self.user_can_authenticate(user):
            return None
        from apps.operations.mfa import active_device_id, required

        return user if not required(user) or active_device_id(user) else None

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
    error_messages: ClassVar[dict[str, str]] = {
        **AuthenticationForm.error_messages,
        "invalid_login": (
            "Please enter a correct admin email and password. Passwords are case-sensitive."
        ),
    }
    challenge_token = forms.CharField(required=False, max_length=128, widget=forms.HiddenInput)
    mfa_action = forms.ChoiceField(
        choices=[("verify", "Verify"), ("skip", "Skip"), ("complete", "Continue")],
        required=False,
        widget=forms.HiddenInput,
    )
    otp_code = forms.CharField(
        label="Authenticator / recovery code",
        max_length=32,
        required=False,
        widget=forms.TextInput(attrs={"autocomplete": "one-time-code", "autocapitalize": "none"}),
    )
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
        self.fields["otp_code"].required = False
        self.mfa_challenge = None
        self.mfa_prompt = False
        if self.data.get("challenge_token"):
            self.fields["username"].required = False
            self.fields["password"].required = False

    def clean(self):
        # Django admin is a public password form for the most privileged
        # accounts, so it gets the same cap as Management sign-in: counted per
        # address and per email before any password is checked, so a cap that
        # has closed costs an attacker the guess. An uncountable cache refuses.
        address = get_context().ip_address or "unknown"
        email = _normalise_admin_email(self.data.get("username")) or "invalid"
        window = ADMIN_LOGIN_WINDOW_SECONDS
        try:
            by_address = count_attempt(
                f"admin-login:ip:{address}", window=window, scope="admin_login"
            )
            by_email = count_attempt(
                f"admin-login:email:{email}", window=window, scope="admin_login"
            )
        except ProviderUnavailable as exc:
            raise ValidationError(
                "Sign-in is unavailable right now. Try again shortly.", code="unavailable"
            ) from exc
        if by_address > ADMIN_LOGIN_MAX_PER_ADDRESS or by_email > ADMIN_LOGIN_MAX_PER_EMAIL:
            raise ValidationError(
                "Too many sign-in attempts. Try again later.", code="rate_limited"
            )
        from apps.core.exceptions import DomainError
        from apps.operations import login_mfa

        token = self.cleaned_data.get("challenge_token")
        if token:
            try:
                result = login_mfa.finish(
                    token=token,
                    surface="django",
                    code=self.cleaned_data.get("otp_code", ""),
                    action=self.cleaned_data.get("mfa_action") or "verify",
                )
            except DomainError as exc:
                self.mfa_challenge = login_mfa.resume(token=token, surface="django")
                raise ValidationError(exc.message) from exc
            if isinstance(result, dict):
                self.mfa_challenge = result
                self.mfa_prompt = True
                raise ValidationError("Save your recovery codes before continuing.")
            self.user_cache = result
            self.confirm_login_allowed(result)
            return self.cleaned_data
        username = self.cleaned_data.get("username")
        password = self.cleaned_data.get("password")
        if username and password:
            if not self.cleaned_data.get("otp_code"):
                # Only a valid password may disclose enrollment material or MFA state.
                candidate = AdminEmailBackend.check_primary(username, password)
                if candidate is None:
                    raise self.get_invalid_login_error()
                try:
                    self.mfa_challenge = login_mfa.begin(user=candidate, surface="django")
                except DomainError as exc:
                    raise ValidationError(exc.message) from exc
                if self.mfa_challenge:
                    self.mfa_prompt = True
                    raise ValidationError("Complete two-factor authentication to continue.")
                candidate._admin_mfa_device_id = None
                self.user_cache = candidate
                self.confirm_login_allowed(candidate)
                return self.cleaned_data
            try:
                self.user_cache = authenticate(
                    self.request,
                    username=username,
                    password=password,
                    otp_code=self.cleaned_data.get("otp_code", ""),
                )
            except ProviderUnavailable as exc:
                raise ValidationError(
                    "Sign-in is unavailable right now.", code="unavailable"
                ) from exc
            if self.user_cache is None:
                raise self.get_invalid_login_error()
            self.confirm_login_allowed(self.user_cache)
        return self.cleaned_data

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_staff or not user.is_superuser or not user.is_email_verified:
            raise ValidationError(
                "This account is not authorized for Super Admin.", code="invalid_login"
            )
