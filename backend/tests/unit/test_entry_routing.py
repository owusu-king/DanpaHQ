"""Where the backend sends each account, and why.

Entry routing used to be read off a role name, which meant an account that had
granted itself the landlord role was sent to the provider workspace. These tests
pin the replacement: the route follows the capability payload, and provider
capability follows an approved verification and nothing else.
"""

import pytest
from django.utils import timezone

from apps.identity.models import Role, User, UserRole
from apps.identity.serializers import MeSerializer

pytestmark = pytest.mark.django_db


def test_an_unfinished_account_is_sent_back_to_finish_registering():
    """A proved number is not yet an account, and it is not routed like one."""
    user = User.objects.create_user(phone="0200000010")

    data = MeSerializer(user).data

    assert data["registration_state"] == "phone_required"
    assert data["entry_routes"] == {"mobile": "/(auth)/register", "web": "/register"}


def test_a_registered_tenant_lands_in_discovery(registered):
    user = registered("0200000011", account_type="tenant")

    data = MeSerializer(user).data

    assert data["entry_routes"] == {"mobile": "/(app)/(tabs)", "web": "/home"}
    assert data["capabilities"]["tenant"]["workspace_access"] is True
    assert data["capabilities"]["provider"]["exists"] is False


def test_a_provider_who_has_submitted_nothing_gets_provider_onboarding(registered):
    """Declared, but nothing sent. Onboarding is the destination."""
    user = registered("0200000012", account_type="provider")

    data = MeSerializer(user).data
    provider = data["capabilities"]["provider"]

    assert provider["exists"] is True
    assert provider["verification_status"] == "not_started"
    assert provider["onboarding_complete"] is False
    assert provider["workspace_access"] is False
    assert provider["can_create_property"] is False
    assert data["entry_routes"] == {"mobile": "/(app)/provider", "web": "/provider"}


def test_an_approved_provider_reaches_the_workspace(registered, provider_standing):
    user = registered("0200000013", account_type="provider")
    provider_standing(user)

    data = MeSerializer(user).data

    assert data["capabilities"]["provider"]["verification_status"] == "approved"
    assert data["capabilities"]["provider"]["workspace_access"] is True
    assert data["entry_routes"] == {
        "mobile": "/(app)/(provider-tabs)",
        "web": "/home",
    }


def test_a_self_granted_provider_role_does_not_reach_the_workspace(registered):
    """The exact hole this release closes.

    Holding the role is no longer evidence of anything. Nothing but an approved
    verification opens the workspace, so a role granted by any other route
    leaves the account exactly where it was.
    """
    user = registered("0200000014", account_type="tenant")
    UserRole.objects.create(user=user, role=Role.LANDLORD, is_primary=False)

    data = MeSerializer(user).data

    assert data["capabilities"]["provider"]["workspace_access"] is False
    assert data["entry_routes"]["web"] != "/properties"


def test_a_revoked_provider_loses_the_workspace(registered, provider_standing):
    from apps.trust import services as trust_services

    user = registered("0200000015", account_type="provider")
    verification = provider_standing(user)
    trust_services.revoke(verification=verification, reason="Authority documents were withdrawn.")

    data = MeSerializer(User.objects.get(pk=user.pk)).data

    assert data["capabilities"]["provider"]["verification_status"] == "revoked"
    assert data["capabilities"]["provider"]["workspace_access"] is False
    assert data["entry_routes"] == {"mobile": "/(app)/provider", "web": "/provider"}


def test_restricted_route_wins_over_everything(registered):
    user = registered("0200000016", account_type="provider")
    user.is_active = False
    user.save(update_fields=["is_active"])

    assert MeSerializer(user).data["entry_routes"] == {
        "mobile": "/(app)/restricted",
        "web": "/restricted",
    }


def test_operations_roles_never_become_consumer_contexts_or_capabilities(registered):
    user = registered("0200000017", account_type="provider")
    user.onboarding_completed_at = timezone.now()
    user.is_staff = True
    user.save(update_fields=["onboarding_completed_at", "is_staff"])
    UserRole.objects.create(user=user, role=Role.SUPPORT, is_primary=True)

    data = MeSerializer(user).data

    assert data["available_contexts"] == []
    assert data["default_context"] is None
    assert "review_verifications" not in data["permissions"]


@pytest.mark.parametrize(
    ("intent", "mobile_route", "web_route"),
    [
        ("current_tenant", "/(app)/(tabs)", "/home"),
        ("find_property", "/(app)/(tabs)", "/home"),
    ],
)
def test_a_tenant_intent_enters_home_without_requiring_a_relationship(
    registered, intent, mobile_route, web_route
):
    from apps.identity.services import select_onboarding_intent

    user = registered(f"020000002{len(intent) % 10}", account_type="tenant")
    select_onboarding_intent(user=user, intent=intent)

    data = MeSerializer(user).data

    assert data["entry_routes"] == {"mobile": mobile_route, "web": web_route}
    assert data["default_context_id"] == "discovery"


def test_a_tenant_cannot_walk_into_the_provider_journey(registered):
    """Becoming a provider starts at registration, not at the welcome screen.

    A tenant asking for the provider experience used to be entered into it,
    which made a button press the whole of declaring yourself a provider. They
    are told they are not one, and left exactly as they were.
    """
    from apps.identity.services import NotAProvider, choose_workspace

    user = registered("0200000031", account_type="tenant")

    with pytest.raises(NotAProvider) as refusal:
        choose_workspace(user=user, workspace="provider")

    assert refusal.value.code == "NOT_A_PROVIDER"
    assert refusal.value.status_code == 403

    data = MeSerializer(user).data
    assert data["capabilities"]["active_workspace"] == "tenant"
    assert data["capabilities"]["provider"]["exists"] is False
    assert data["capabilities"]["available_workspaces"] == ["discovery", "tenant"]
    assert data["entry_routes"] == {"mobile": "/(app)/(tabs)", "web": "/home"}


def test_switching_back_to_tenant_changes_nothing_but_the_route(registered):
    """A context switch is navigation.

    It does not cancel a review in progress, drop a capability, or start a
    second account. The only thing that changes is where they land.
    """
    from apps.identity.services import choose_workspace

    user = registered("0200000032", account_type="provider")
    # Take the tenant side once so both capabilities are settled, then compare
    # a switch between two experiences the account already holds.
    choose_workspace(user=user, workspace="tenant")
    choose_workspace(user=user, workspace="provider")
    before = MeSerializer(user).data["capabilities"]

    choose_workspace(user=user, workspace="tenant")
    after = MeSerializer(user).data

    assert after["capabilities"]["active_workspace"] == "tenant"
    assert after["entry_routes"] == {"mobile": "/(app)/(tabs)", "web": "/home"}
    # Everything except the active workspace is identical.
    assert after["capabilities"]["provider"] == before["provider"]
    assert after["capabilities"]["tenant"] == before["tenant"]
    assert after["capabilities"]["available_workspaces"] == before["available_workspaces"]


def test_choosing_the_provider_workspace_grants_no_provider_role(registered):
    """Even for a provider account, asking for the workspace grants nothing."""
    from apps.identity.services import choose_workspace

    user = registered("0200000033", account_type="provider")
    choose_workspace(user=user, workspace="provider")
    user.refresh_from_db()

    assert "landlord" not in user.roles
    assert MeSerializer(user).data["capabilities"]["provider"]["workspace_access"] is False
