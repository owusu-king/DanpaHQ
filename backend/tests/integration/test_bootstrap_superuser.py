"""First-admin bootstrap cannot overwrite or promote existing identities."""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection

pytestmark = pytest.mark.django_db
PHONE = "+233241234567"
EMAIL = "bootstrap@example.com"
PASSWORD = "a-unique-bootstrap-credential-93!"


def configure(monkeypatch, **overrides):
    values = {"PHONE": PHONE, "EMAIL": EMAIL, "PASSWORD": PASSWORD} | overrides
    for key, value in values.items():
        monkeypatch.setenv(f"DJANGO_SUPERUSER_{key}", value)


def bootstrap():
    output = StringIO()
    call_command("bootstrap_superuser", stdout=output)
    return output.getvalue()


def test_bootstrap_creates_first_admin_without_logging_credentials(monkeypatch):
    configure(monkeypatch)
    output = bootstrap()
    user = get_user_model().objects.get(phone=PHONE)
    assert user.is_superuser and user.is_staff and user.is_active
    assert user.check_password(PASSWORD)
    assert all(secret not in output for secret in (PHONE, EMAIL, PASSWORD))


@pytest.mark.parametrize("active", [True, False])
def test_any_existing_admin_disables_bootstrap_even_with_partial_credentials(monkeypatch, active):
    user = get_user_model().objects.create_superuser(
        phone="+233201234567", email="existing@example.com", password=PASSWORD, is_active=active,
    )
    old_hash = user.password
    configure(monkeypatch, PASSWORD="", EMAIL="invalid")
    assert "skipped" in bootstrap()
    user.refresh_from_db()
    assert user.password == old_hash and user.is_active == active
    assert get_user_model().objects.count() == 1


@pytest.mark.parametrize("conflict", ["phone", "email"])
def test_existing_regular_account_is_never_promoted(monkeypatch, conflict):
    user = get_user_model().objects.create_user(
        phone=PHONE if conflict == "phone" else "+233201234567",
        email=EMAIL.upper() if conflict == "email" else "other@example.com", password=PASSWORD,
    )
    configure(monkeypatch)
    with pytest.raises(CommandError, match="existing account"):
        bootstrap()
    user.refresh_from_db()
    assert not user.is_superuser and not user.is_staff


@pytest.mark.parametrize("overrides", [
    {"PASSWORD": ""}, {"PASSWORD": "password"}, {"PHONE": "invalid"}, {"EMAIL": "invalid"},
])
def test_invalid_or_partial_bootstrap_fails_without_creating_account(monkeypatch, overrides):
    configure(monkeypatch, **overrides)
    with pytest.raises(CommandError):
        bootstrap()
    assert not get_user_model().objects.exists()


def test_bootstrap_without_credentials_is_optional(monkeypatch):
    configure(monkeypatch, PHONE="", EMAIL="", PASSWORD="")
    assert "skipped" in bootstrap()
    assert not get_user_model().objects.exists()


def test_bootstrap_refuses_runtime_role(settings, monkeypatch):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_user")
        settings.DATABASE_RUNTIME_ROLE = cursor.fetchone()[0]
    configure(monkeypatch)
    with pytest.raises(CommandError, match="owner release"):
        bootstrap()
    assert not get_user_model().objects.exists()
