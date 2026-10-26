import pytest
from django.db import IntegrityError

from apps.identity.models import Role, User, UserRole

pytestmark = pytest.mark.django_db


def test_phone_is_normalised_on_save():
    user = User.objects.create_user(phone="024 123 4567")
    assert user.phone == "+233241234567"


def test_the_same_human_cannot_register_twice_with_different_formatting():
    """The number is normalised first, so the unique index sees one number.

    Named rather than `Exception`: a bare catch also passes when normalisation
    itself throws, which is the opposite of what this is checking.
    """
    from django.db.utils import IntegrityError

    User.objects.create_user(phone="0241234567")
    with pytest.raises(IntegrityError):
        User.objects.create_user(phone="+233 24 123 4567")


def test_otp_users_have_no_usable_password():
    user = User.objects.create_user(phone="0241234568")
    assert not user.has_usable_password()


def test_display_name_falls_back_to_the_masked_number():
    user = User.objects.create_user(phone="0241234569")
    assert user.display_name == "024 123 4569"


def test_preferred_name_wins_over_first_and_last():
    user = User.objects.create_user(
        phone="0241234570", first_name="Kwabena", last_name="Mensah", preferred_name="Kobby"
    )
    assert user.display_name == "Kobby"


def test_a_person_can_be_both_tenant_and_landlord():
    user = User.objects.create_user(phone="0241234571")
    UserRole.objects.create(user=user, role=Role.TENANT, is_primary=True)
    UserRole.objects.create(user=user, role=Role.LANDLORD)
    assert user.roles == {Role.TENANT, Role.LANDLORD}
    assert user.primary_role == Role.TENANT


def test_only_one_primary_role_at_a_time():
    user = User.objects.create_user(phone="0241234572")
    UserRole.objects.create(user=user, role=Role.TENANT, is_primary=True)
    with pytest.raises(IntegrityError):
        UserRole.objects.create(user=user, role=Role.LANDLORD, is_primary=True)


def test_revoked_role_frees_the_slot_for_regranting():
    user = User.objects.create_user(phone="0241234573")
    from django.utils import timezone

    UserRole.objects.create(user=user, role=Role.AGENT, revoked_at=timezone.now())
    UserRole.objects.create(user=user, role=Role.AGENT)  # must not raise
    assert user.role_assignments.count() == 2


def test_revoking_primary_selects_a_remaining_context():
    from apps.identity import services

    user = User.objects.create_user(phone="0241234574")
    UserRole.objects.create(user=user, role=Role.TENANT, is_primary=True)
    UserRole.objects.create(user=user, role=Role.LANDLORD)

    services.revoke_role(user=user, role=Role.TENANT, revoked_by=user)

    assert user.primary_role == Role.LANDLORD
