import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.identity.models import User
from apps.operations import mfa
from apps.operations.models import ManagementRole, ManagementSession, MFAChallenge
from tests.conftest import make_account
from tests.integration.test_management_portal import management_user, signed_in_client

pytestmark = pytest.mark.django_db
URL = "/api/v1/management/configuration/mfa/"


def change(client, user, policy="required", kind="consumer", **extra):
    return client.patch(
        URL,
        {
            "account_kind": kind,
            "account_id": str(user.pk),
            "mfa_policy": policy,
            "reason": "Apply agreed security policy",
            **extra,
        },
        format="json",
    )


@pytest.mark.parametrize("account_type", ["tenant", "provider"])
def test_operations_admin_can_configure_consumer_mfa(account_type):
    actor = management_user()
    client = signed_in_client(actor)
    user = make_account("0500000088", account_type=account_type)
    response = change(client, user)
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.mfa_policy == "required" and mfa.required(user)
    event = AuditLog.objects.filter(aggregate_id=str(user.pk)).order_by("-created_at").first()
    assert event.management_actor_id == actor.pk
    assert event.metadata["reason"] == "Apply agreed security policy"


@pytest.mark.parametrize("policy", ["default", "disabled", "optional", "required"])
def test_operations_admin_can_configure_management_accounts(policy):
    client = signed_in_client(management_user())
    target = management_user(ManagementRole.SUPPORT_ADMIN, "support@example.com")
    response = change(client, target, policy, "management")
    assert response.status_code == 200
    target.refresh_from_db()
    assert target.mfa_policy == policy


def test_support_cannot_read_or_change_mfa_configuration():
    client = signed_in_client(management_user(ManagementRole.SUPPORT_ADMIN))
    target = make_account("0500000088")
    assert client.get(URL).status_code == 403
    assert change(client, target).status_code == 403
    target.refresh_from_db()
    assert target.mfa_policy == "default"


def test_cookie_csrf_and_operations_role_are_required():
    target = make_account("0500000088")
    assert APIClient().get(URL).status_code == 401
    client = signed_in_client(management_user())
    client.credentials()
    assert change(client, target).status_code == 403


@pytest.mark.parametrize("kind", ["consumer", "management"])
def test_super_admin_cannot_be_targeted_through_management(kind):
    target = User.objects.create_superuser(
        phone="0500000099",
        email="root@example.com",
        password="test-only-root-password",
    )
    client = signed_in_client(management_user())
    assert change(client, target, "disabled", kind).status_code == 404
    target.refresh_from_db()
    assert target.mfa_policy == "default"


@pytest.mark.parametrize(
    "extra",
    [
        {"mfa_policy": "unknown"},
        {"reason": ""},
        {"reason": " a "},
        {"account_kind": "django"},
        {"account_id": "invalid"},
    ],
)
def test_invalid_updates_do_not_change_policy(extra):
    client = signed_in_client(management_user())
    target = make_account("0500000088")
    assert change(client, target, **extra).status_code == 422
    target.refresh_from_db()
    assert target.mfa_policy == "default"


def test_self_change_revokes_session_and_requires_new_login():
    actor = management_user()
    client = signed_in_client(actor)
    response = change(client, actor, "required", "management")
    assert response.status_code == 200 and response.data["reauth_required"]
    assert ManagementSession.objects.get(user=actor).revoked_reason == "mfa_policy_changed"
    assert client.get("/api/v1/management/auth/session/").status_code == 401


def test_consumer_change_revokes_sessions_invalidates_challenges_and_keeps_authenticator():
    from apps.identity.services import sign_in_with_password
    from apps.operations.login_mfa import begin
    from tests.conftest import TEST_PASSWORD

    target = make_account("0500000088", mfa_policy="optional")
    pending = begin(user=target, surface="consumer")
    secret = pending["secret"]
    mfa.enroll(user=target, secret=secret, code=mfa.totp(secret), allow_consumer=True)
    credential = mfa.device_id(target)
    # A session without MFA created before it was enabled is still revoked explicitly.
    target.mfa_policy = "disabled"
    target.save()
    tokens = sign_in_with_password(raw_phone=target.phone, password=TEST_PASSWORD)
    target.mfa_policy = "optional"
    target.save()
    client = signed_in_client(management_user())
    response = change(client, target)
    assert response.status_code == 200
    assert target.sessions.get(pk=tokens["session"].pk).revoked_reason == "mfa_policy_changed"
    assert not MFAChallenge.objects.filter(django_user=target).exists()
    assert mfa.device_id(target) == credential


def test_search_pagination_and_safe_enrollment_metadata():
    client = signed_in_client(management_user())
    target = make_account("0500000088", email="tenant@example.com")
    secret = mfa.new_secret()
    mfa.enroll(user=target, secret=secret, code=mfa.totp(secret), allow_consumer=True)
    result = client.get(URL, {"q": "tenant@", "limit": 1})
    assert result.status_code == 200 and result.data["count"] == 1
    row = result.data["results"][0]
    assert row["id"] == str(target.pk) and row["mfa_enrolled"]
    assert set(row) == {
        "id",
        "account_kind",
        "display_name",
        "email",
        "phone",
        "is_active",
        "account_label",
        "mfa_policy",
        "effective_policy",
        "mfa_enrolled",
    }
    assert secret.encode() not in result.content
    assert client.get(URL, {"offset": 1}).data["results"] == []
    assert client.get(URL, {"account_kind": "management"}).data["count"] == 1


def test_unchanged_policy_keeps_live_sessions():
    actor = management_user()
    client = signed_in_client(actor)
    response = change(client, actor, "default", "management")
    assert response.status_code == 200 and not response.data["changed"]
    assert not response.data["reauth_required"]
    assert client.get("/api/v1/management/auth/session/").status_code == 200
