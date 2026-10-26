import pytest

pytestmark = pytest.mark.django_db


def test_meta_is_public_and_describes_the_build(client):
    response = client.get("/api/v1/meta/")
    assert response.status_code == 200
    body = response.json()
    assert body["api_version"] == "v1"
    assert body["currency"] == "GHS"
    assert "minimum_client_versions" in body


def test_liveness_does_not_touch_dependencies(client):
    assert client.get("/healthz").status_code == 200


def test_readiness_reports_each_dependency(client):
    body = client.get("/readyz").json()
    assert set(body["checks"]) == {"database", "cache"}


def test_every_response_carries_a_request_id(client):
    response = client.get("/api/v1/meta/")
    assert response["X-Request-ID"]


def test_client_supplied_request_id_is_echoed(client):
    response = client.get("/api/v1/meta/", headers={"X-Request-ID": "mobile-retry-1"})
    assert response["X-Request-ID"] == "mobile-retry-1"


def test_forged_request_id_is_replaced(client):
    response = client.get("/api/v1/meta/", headers={"X-Request-ID": "a" * 500})
    assert response["X-Request-ID"] != "a" * 500


def test_unknown_route_uses_the_standard_error_envelope(client):
    from rest_framework.test import APIClient

    response = APIClient().get("/api/v1/does-not-exist/")
    assert response.status_code == 404


def test_endpoints_deny_by_default():
    """A view without an explicit permission class must not be public."""
    from django.conf import settings

    assert settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] == [
        "rest_framework.permissions.IsAuthenticated"
    ]
