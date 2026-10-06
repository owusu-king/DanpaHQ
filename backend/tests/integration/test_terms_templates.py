"""A Portfolio's reusable additional-terms wording."""

import pytest
from rest_framework.test import APIClient

from apps.core.exceptions import PermissionDenied, ValidationFailed
from apps.lease import terms_templates
from apps.lease.models import TermsTemplate
from tests.conftest import sign_in
from tests.integration.test_organization_and_occupancy import make_workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def owner(db):
    from tests.conftest import make_account

    return make_account("0202100001", first_name="Ama", account_type="provider")


@pytest.fixture
def portfolio(owner):
    return make_workspace(owner)


class TestPlaceholders:
    def test_known_placeholders_are_filled_and_nothing_else_is_touched(self):
        text = "Rent of ${rent} is due. Keep $$50 aside. ${nonsense} stays. $rent too."
        filled = terms_templates.fill_placeholders(text, {"rent": "GHS 1,500.00"})
        assert (
            filled == "Rent of GHS 1,500.00 is due. Keep $$50 aside. ${nonsense} stays. $rent too."
        )

    def test_unknown_placeholders_are_named_once_each(self):
        text = "${tenant_name} ${gate_code} ${gate_code} ${rent}"
        assert terms_templates.unknown_placeholders(text) == ["gate_code"]

    def test_every_placeholder_is_a_fact_the_agreement_renders(self):
        """The catalogue must not offer a name the renderer cannot fill."""
        import inspect

        from apps.lease.documents import render_agreement

        source = inspect.getsource(render_agreement)
        for name in terms_templates.PLACEHOLDER_NAMES:
            assert f'"{name}":' in source, name


class TestTemplates:
    def test_owner_saves_and_a_new_default_replaces_the_old_one(self, owner, portfolio):
        first = terms_templates.create_template(
            organization=portfolio,
            user=owner,
            data={"name": "Compound rules", "body": "The gate locks at 11pm.", "is_default": True},
        )
        second = terms_templates.create_template(
            organization=portfolio,
            user=owner,
            data={
                "name": "Borehole",
                "body": "${tenant_name} keeps the pump serviced.",
                "is_default": True,
            },
        )
        first.refresh_from_db()
        assert not first.is_default
        assert second.is_default
        assert TermsTemplate.objects.filter(organization=portfolio, is_default=True).count() == 1

    def test_an_unknown_placeholder_is_refused_when_saved(self, owner, portfolio):
        with pytest.raises(ValidationFailed, match=r"\$\{gate_code\}"):
            terms_templates.create_template(
                organization=portfolio,
                user=owner,
                data={"name": "Gate", "body": "Your code is ${gate_code}."},
            )

    def test_name_and_wording_are_required(self, owner, portfolio):
        with pytest.raises(ValidationFailed):
            terms_templates.create_template(
                organization=portfolio, user=owner, data={"name": "", "body": "x"}
            )
        with pytest.raises(ValidationFailed):
            terms_templates.create_template(
                organization=portfolio, user=owner, data={"name": "x", "body": "  "}
            )

    def test_someone_outside_the_portfolio_cannot_manage_its_templates(self, portfolio):
        from tests.conftest import make_account

        stranger = make_account("0202100009", first_name="Kojo", account_type="provider")
        with pytest.raises(PermissionDenied):
            terms_templates.create_template(
                organization=portfolio, user=stranger, data={"name": "x", "body": "y"}
            )

    def test_an_accountant_reads_money_not_agreement_wording(self, owner, portfolio):
        from apps.organization import services
        from apps.organization.models import MembershipRole
        from tests.conftest import make_account

        accountant = make_account("0202100010", first_name="Esi", account_type="provider")
        services.add_membership(
            organization=portfolio, actor=owner, user=accountant, role=MembershipRole.ACCOUNTANT
        )
        with pytest.raises(PermissionDenied):
            terms_templates.list_templates(organization=portfolio, user=accountant)


class TestApi:
    def test_contracts_lists_the_controlled_agreement_placeholders_and_templates(
        self, owner, portfolio
    ):
        api = APIClient()
        sign_in(api, user=owner)
        created = api.post(
            f"/api/v1/organizations/{portfolio.id}/terms-templates/",
            {
                "name": "Compound rules",
                "body": "${tenant_name} keeps the gate locked.",
                "is_default": True,
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="terms-template-create-0001",
        )
        assert created.status_code == 201, created.content
        template_id = created.json()["id"]

        response = api.get(f"/api/v1/organizations/{portfolio.id}/contracts/")
        assert response.status_code == 200
        body = response.json()
        assert body["agreement"]["clauses"], "the controlled clauses are shown, read-only"
        assert {"name": "tenant_name", "label": "Tenant's name", "example": "Nana Ofori"} in body[
            "placeholders"
        ]
        assert [row["name"] for row in body["templates"]] == ["Compound rules"]

        renamed = api.patch(
            f"/api/v1/organizations/{portfolio.id}/terms-templates/{template_id}/",
            {"name": "House rules"},
            format="json",
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "House rules"
        assert renamed.json()["is_default"] is True

        removed = api.delete(f"/api/v1/organizations/{portfolio.id}/terms-templates/{template_id}/")
        assert removed.status_code == 204
        assert not TermsTemplate.objects.filter(id=template_id).exists()

    def test_another_portfolios_template_is_not_found(self, owner, portfolio):
        from tests.conftest import make_account

        other_owner = make_account("0202100020", first_name="Yaa", account_type="provider")
        other = make_workspace(other_owner)
        theirs = terms_templates.create_template(
            organization=other, user=other_owner, data={"name": "Theirs", "body": "Private."}
        )
        api = APIClient()
        sign_in(api, user=owner)
        response = api.patch(
            f"/api/v1/organizations/{portfolio.id}/terms-templates/{theirs.id}/",
            {"name": "Mine now"},
            format="json",
        )
        assert response.status_code == 404
