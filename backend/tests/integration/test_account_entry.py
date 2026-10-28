"""Login chooses an existing special account without creating tenant standing."""
import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied
from apps.identity import services
from apps.identity.models import Intent, Role
from apps.identity.serializers import MeSerializer
from apps.trust.models import Verification
from tests.conftest import make_account, sign_in

pytestmark = pytest.mark.django_db


def review(user, kind):
    return Verification.objects.create(
        subject_type="user", subject_id=str(user.id), kind=kind,
        status="pending", method="management_approval", submitted_by=user,
    )


def test_login_prioritizes_pending_provider_over_previous_discovery():
    user = make_account("0207778001", account_type="provider")
    review(user, "provider")
    services.select_onboarding_intent(user=user, intent=Intent.FIND_PROPERTY)
    sign_in(user=user)
    me = MeSerializer(user).data
    assert me["capabilities"]["active_workspace"] == "provider"
    assert me["entry_routes"] == {"mobile": "/(app)/(provider-tabs)", "web": "/home"}
    assert me["capabilities"]["provider"]["workspace_access"] is False
    assert not user.has_role(Role.TENANT)


def test_pending_artisan_login_opens_status_without_operational_access():
    user = make_account("0207778002", tenant_role=False)
    review(user, "artisan")
    sign_in(user=user)
    me = MeSerializer(user).data
    assert me["capabilities"]["active_workspace"] == "artisan"
    assert "artisan" in me["capabilities"]["available_workspaces"]
    assert me["capabilities"]["artisan"]["workspace_access"] is False
    assert me["capabilities"]["artisan"]["can_quote"] is False
    assert me["entry_routes"]["mobile"] == "/(app)/(artisan-tabs)"
    assert not user.has_role(Role.TENANT)


def test_artisan_applicant_returns_to_application_without_tenant_or_work_access():
    user = make_account("0207778099", account_type="artisan")
    services.select_onboarding_intent(user=user, intent=Intent.FIND_PROPERTY)
    sign_in(user=user)
    me = MeSerializer(user).data
    assert me["capabilities"]["active_workspace"] == "artisan"
    assert me["capabilities"]["tenant"]["workspace_access"] is False
    assert me["capabilities"]["provider"]["workspace_access"] is False
    assert me["capabilities"]["artisan"]["status"] == "not_started"
    assert me["capabilities"]["artisan"]["can_quote"] is False
    assert me["capabilities"]["artisan"]["workspace_access"] is False
    assert me["entry_routes"] == {"mobile": "/(app)/(artisan-tabs)", "web": "/artisan"}
    assert not user.has_role(Role.TENANT)


def test_provider_tenant_capability_requires_explicit_creation():
    user = make_account("0207778003", account_type="provider")
    with pytest.raises(PermissionDenied):
        services.ensure_tenant_capability(user)
    services.select_onboarding_intent(user=user, intent=Intent.FIND_PROPERTY)
    assert not user.has_role(Role.TENANT)
    services.choose_workspace(user=user, workspace="tenant", tenant_confirmation="Rent account")
    assert user.has_role(Role.TENANT)
    sign_in(user=user)
    assert services.active_workspace(user) == "provider"


def test_anonymous_users_cannot_read_private_features():
    api = APIClient()
    for path in ("/api/v1/me/", "/api/v1/me/viewings/", "/api/v1/me/artisan/"):
        assert api.get(path).status_code in (401, 403)


def test_google_login_needs_no_account_type_and_never_grants_tenant():
    from apps.identity.google_identity import GoogleClaims
    from apps.identity.models import ExternalIdentity

    user = make_account("0207778004", account_type="provider")
    claims = GoogleClaims(
        subject="provider-subject", email="provider@example.com",
        first_name="Ama", last_name="Mensah",
    )
    ExternalIdentity.objects.create(user=user, provider="google", subject=claims.subject)
    result = services.authenticate_with_google(claims=claims)
    assert result["user"].id == user.id
    assert services.active_workspace(user) == "provider"
    assert not user.has_role(Role.TENANT)


def test_unknown_google_identity_waits_for_explicit_account_selection():
    from apps.identity.google_identity import GoogleClaims
    from apps.identity.models import User

    before = User.objects.count()
    result = services.authenticate_with_google(claims=GoogleClaims(
        subject="unregistered-subject", email="new@example.com",
        first_name="Ama", last_name="Mensah",
    ))
    assert result["registration_required"] is True
    assert result["google_registration_ticket"] is None
    assert User.objects.count() == before

@pytest.mark.parametrize("path,payload", [
    ("/api/v1/me/workspace/", {"workspace": "tenant"}),
    ("/api/v1/me/roles/", {"role": "tenant"}),
])
@pytest.mark.parametrize("account_type", ["provider", "artisan"])
@pytest.mark.parametrize(
    "confirmation", [None, "", "rent account", "Rent Account", " Rent account", "Rent account "]
)
def test_new_tenant_standing_requires_exact_confirmation(path, payload, confirmation, account_type):
    user = make_account("0207778011", account_type=account_type)
    api = APIClient()
    api.force_authenticate(user)
    data = dict(payload)
    if confirmation is not None:
        data["tenant_confirmation"] = confirmation
    response = api.post(path, data, format="json")
    assert response.status_code == 422
    assert not user.has_role(Role.TENANT)
    user.refresh_from_db()
    assert services.active_workspace(user) == account_type


@pytest.mark.parametrize("path,payload", [
    ("/api/v1/me/workspace/", {"workspace": "tenant"}),
    ("/api/v1/me/roles/", {"role": "tenant"}),
])
def test_confirmed_tenant_creation_keeps_provider_account(path, payload):
    user = make_account("0207778012", account_type="provider")
    api = APIClient()
    api.force_authenticate(user)
    response = api.post(path, {**payload, "tenant_confirmation": "Rent account"}, format="json")
    assert response.status_code in (200, 201)
    assert user.has_role(Role.TENANT)
    user.refresh_from_db()
    assert user.account_type == "provider"
    assert (
        api.post("/api/v1/me/workspace/", {"workspace": "provider"}, format="json").status_code
        == 200
    )
    assert (
        api.post("/api/v1/me/workspace/", {"workspace": "tenant"}, format="json").status_code
        == 200
    )
