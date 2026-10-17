import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.operations.models import ConfigurationValue, ManagementRole, ManagementUser

pytestmark = pytest.mark.django_db

PASSWORD = "correct-horse-battery-staple"


def management_client(*, role=ManagementRole.OPERATIONS_ADMIN, email="ops-config@example.com"):
    actor = ManagementUser(
        email=email,
        first_name="Akua",
        last_name="Mensah",
        role=role,
        is_active=True,
        must_change_password=False,
    )
    actor.set_password(PASSWORD)
    actor.save()
    client = APIClient()
    login = client.post(
        "/api/v1/management/auth/login/",
        {"email": actor.email, "password": PASSWORD},
        format="json",
        HTTP_ORIGIN="http://localhost:3000",
    )
    client.credentials(HTTP_X_MANAGEMENT_CSRF=login.data["csrf_token"])
    return actor, client


@override_settings(RUNTIME_CONFIGURATION_ENABLED=True)
def test_operations_can_save_an_encrypted_secret_and_runtime_switch():
    from apps.operations.configuration import value

    actor, client = management_client()
    response = client.patch(
        "/api/v1/management/configuration/",
        {
            "updates": [
                {"key": "PAYSTACK_TEST_SECRET_KEY", "value": "sk_test_management_value"},
                {"key": "PAYSTACK_TEST_PUBLIC_KEY", "value": "pk_test_management_value"},
                {"key": "PAYSTACK_LIVE_SECRET_KEY", "value": "sk_live_management_value"},
                {"key": "PAYSTACK_LIVE_PUBLIC_KEY", "value": "pk_live_management_value"},
                {"key": "STOLEN_DEVICE_REPORTING_ENABLED", "value": False},
            ]
        },
        format="json",
    )

    assert response.status_code == 200, response.data
    secret = ConfigurationValue.objects.get(key="PAYSTACK_TEST_SECRET_KEY")
    assert secret.updated_by_id == actor.id
    assert secret.value.startswith("fernet:")
    assert "sk_test_management_value" not in secret.value
    assert value("PAYSTACK_TEST_SECRET_KEY") == "sk_test_management_value"
    assert value("PAYSTACK_LIVE_SECRET_KEY") == "sk_live_management_value"
    assert value("PAYSTACK_TEST_PUBLIC_KEY") == "pk_test_management_value"
    assert value("PAYSTACK_LIVE_PUBLIC_KEY") == "pk_live_management_value"
    assert value("STOLEN_DEVICE_REPORTING_ENABLED") is False
    secret_payload = next(
        field
        for section in response.data["sections"]
        for field in section["fields"]
        if field["key"] == "PAYSTACK_TEST_SECRET_KEY"
    )
    assert secret_payload["value"] == ""
    assert secret_payload["is_set"] is True
    visible_keys = {
        field["key"] for section in response.data["sections"] for field in section["fields"]
    }
    assert {
        "PAYSTACK_TEST_SECRET_KEY",
        "PAYSTACK_TEST_PUBLIC_KEY",
        "PAYSTACK_LIVE_SECRET_KEY",
        "PAYSTACK_LIVE_PUBLIC_KEY",
    } <= visible_keys
    assert "PAYSTACK_SECRET_KEY" not in visible_keys


def test_support_admin_cannot_read_or_change_runtime_configuration():
    _, client = management_client(
        role=ManagementRole.SUPPORT_ADMIN, email="support-config@example.com"
    )
    assert client.get("/api/v1/management/configuration/").status_code == 403
    assert (
        client.patch(
            "/api/v1/management/configuration/",
            {"updates": [{"key": "STOLEN_DEVICE_REPORTING_ENABLED", "value": False}]},
            format="json",
        ).status_code
        == 403
    )


@override_settings(
    RUNTIME_CONFIGURATION_ENABLED=True,
    PAYSTACK_SECRET_KEY="",
    PAYSTACK_TEST_SECRET_KEY="",
    PAYSTACK_LIVE_SECRET_KEY="",
)
def test_paystack_uses_the_secret_for_the_selected_mode():
    from apps.operations.configuration import apply_updates
    from apps.payments.paystack import PaystackPaymentProvider

    actor, _ = management_client(email="ops-paystack-mode@example.com")
    apply_updates(
        actor=actor,
        updates=[
            {"key": "PAYSTACK_TEST_SECRET_KEY", "value": "sk_test_selected"},
            {"key": "PAYSTACK_LIVE_SECRET_KEY", "value": "sk_live_selected"},
            {"key": "PAYSTACK_ALLOW_LIVE", "value": False},
        ],
    )
    assert PaystackPaymentProvider()._secret_key() == "sk_test_selected"

    apply_updates(
        actor=actor,
        updates=[{"key": "PAYSTACK_ALLOW_LIVE", "value": True}],
    )
    assert PaystackPaymentProvider()._secret_key() == "sk_live_selected"


@override_settings(RUNTIME_CONFIGURATION_ENABLED=True)
def test_paystack_keys_must_match_their_environment():
    _, client = management_client(email="ops-paystack-validation@example.com")
    response = client.patch(
        "/api/v1/management/configuration/",
        {"updates": [{"key": "PAYSTACK_TEST_PUBLIC_KEY", "value": "pk_live_wrong"}]},
        format="json",
    )

    assert response.status_code == 422
    assert "pk_test_" in str(response.data)


@override_settings(
    RUNTIME_CONFIGURATION_ENABLED=False,
    ARKESEL_API_KEY="arkesel-test-key",
    ARKESEL_SENDER_ID="Danpa HQ",
    ARKESEL_SANDBOX=True,
)
def test_arkesel_adapter_sends_the_expected_v2_request(monkeypatch):
    from apps.identity.providers import ArkeselSmsProvider

    captured = {}

    class Response:
        ok = True
        status_code = 200

        def json(self):
            return {"status": "success", "data": [{"id": "sms-123"}]}

    def post(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return Response()

    monkeypatch.setattr("apps.identity.providers.requests.post", post)
    result = ArkeselSmsProvider().send(
        to="+233201234567", body="Your Danpa HQ code is 123456", reference="otp-1"
    )

    assert result.accepted is True
    assert result.reference == "sms-123"
    assert captured["headers"]["api-key"] == "arkesel-test-key"
    assert captured["json"] == {
        "sender": "Danpa HQ",
        "message": "Your Danpa HQ code is 123456",
        "recipients": ["233201234567"],
        "sandbox": True,
    }


@override_settings(RUNTIME_CONFIGURATION_ENABLED=True)
def test_disabling_stolen_device_reporting_hides_the_capability_and_enforces_it(user, sign_in_as):
    from apps.identity.models import Device
    from apps.operations.models import ConfigurationValue

    api = APIClient()
    sign_in_as(api, user=user)
    other = Device.objects.create(user=user, fingerprint="other-phone", platform="android")
    ConfigurationValue.objects.create(
        key="STOLEN_DEVICE_REPORTING_ENABLED", value="false", is_secret=False
    )

    status = api.get("/api/v1/me/security/")
    refused = api.post(f"/api/v1/me/devices/{other.id}/block/")

    assert status.status_code == 200
    assert status.data["stolen_device_reporting_enabled"] is False
    assert refused.status_code == 403
    other.refresh_from_db()
    assert other.blocked_at is None


def test_support_ticket_is_a_two_way_management_conversation(user, sign_in_as):
    api = APIClient()
    sign_in_as(api, user=user)
    opened = api.post(
        "/api/v1/me/support-cases/",
        {
            "category": "payment",
            "summary": "Payment is still pending",
            "message": "The debit completed but my rent still shows unpaid.",
        },
        format="json",
    )
    assert opened.status_code == 201, opened.data
    case_id = opened.data["id"]
    assert opened.data["messages"][0]["mine"] is True

    _, management = management_client(email="support-replies@example.com")
    queue = management.get("/api/v1/management/support/")
    assert queue.status_code == 200
    assert queue.data["results"][0]["unread"] is True

    read = management.get(f"/api/v1/management/support/{case_id}/")
    assert read.data["messages"][0]["sender"] == "user"
    replied = management.post(
        f"/api/v1/management/support/{case_id}/messages/",
        {"message": "We found the payment and are reconciling it now."},
        format="json",
    )
    assert replied.status_code == 201, replied.data

    inbox = api.get("/api/v1/me/support-cases/")
    assert inbox.data[0]["unread"] is True
    thread = api.get(f"/api/v1/me/support-cases/{case_id}/")
    assert thread.status_code == 200
    assert [message["mine"] for message in thread.data["messages"]] == [True, False]
    assert "assigned_to" not in thread.data
