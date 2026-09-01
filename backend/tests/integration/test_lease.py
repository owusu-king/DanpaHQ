"""Leases.

The lease is the record the whole product exists to produce, so the tests are
about the properties a dispute would turn on: that terms cannot drift, that
neither side can bind the other alone, and that a live agreement takes the room
off the market.
"""

from datetime import date, timedelta

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed
from apps.lease import services
from apps.lease.models import LeaseStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def address(db):
    from apps.geo.models import Address, District, Locality, Region

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    return Address.objects.create(locality=locality, landmark="Near the beach")


@pytest.fixture
def unit(landlord, address, approve_provider):
    from apps.property.models import Property, Unit

    prop = Property.objects.create(
        owner=landlord, address=address, title="Osu block", property_type="apartment"
    )
    approve_provider(landlord, prop)
    return Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)


@pytest.fixture
def live_listing(landlord, unit, address):
    from apps.listing.models import Listing, ListingStatus

    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        status=ListingStatus.ACTIVE,
        rent_minor=150000,
        headline="Chamber and hall in Osu",
        description="Prepaid meter.",
        advance_months=12,
        locality_id_cache=address.locality_id,
        bedrooms_cache=1,
    )


TERMS = {
    "rent_minor": 150000,
    "advance_months": 6,
    "deposit_months": 1,
    "agency_fee_months": 1,
    "starts_on": date.today() + timedelta(days=14),
    "term_months": 12,
}


@pytest.fixture
def signed_in(sms, sign_in_as):
    """A real authenticated client, because the document tests are about access."""

    def _sign_in(person, label="d"):
        client = APIClient()
        sign_in_as(client, user=person, device_fingerprint=label)
        return client

    return _sign_in


class TestDrafting:
    def test_the_landlord_writes_down_what_was_agreed(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        assert lease.status == LeaseStatus.DRAFT
        assert lease.rent_minor == 150000
        assert lease.landlord_id == landlord.id
        assert lease.ends_on is not None

    def test_the_move_in_total_is_the_sum_of_what_is_due(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        # 6 advance + 1 deposit + 1 agency = 8 months at GHS 1,500
        assert lease.move_in_total_minor == 150000 * 8
        assert lease.advance_total_minor == 150000 * 6

    def test_a_stranger_cannot_draft_a_lease_for_someone_elses_property(self, agent, user, unit):
        with pytest.raises(PermissionDenied):
            services.draft_lease(user=agent, unit=unit, tenant=user, data=dict(TERMS))

    def test_a_landlord_cannot_lease_to_themselves(self, landlord, unit):
        with pytest.raises(ValidationFailed):
            services.draft_lease(user=landlord, unit=unit, tenant=landlord, data=dict(TERMS))

    def test_rent_is_required(self, landlord, user, unit):
        terms = dict(TERMS, rent_minor=0)
        with pytest.raises(ValidationFailed):
            services.draft_lease(user=landlord, unit=unit, tenant=user, data=terms)

    def test_one_live_agreement_per_unit(self, landlord, user, agent, unit):
        """Two active leases on one room is the double-letting this product
        exists to make impossible."""
        services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        with pytest.raises(Conflict):
            services.draft_lease(user=landlord, unit=unit, tenant=agent, data=dict(TERMS))


CANONICAL_TERMS = {
    **TERMS,
    "workflow_version": "canonical_v1",
    "structured_terms": {
        "payment_due": "on the first day of each rental period",
        "utilities": {"water": "included", "electricity": "tenant"},
        "occupants": [{"name": "Kojo Mensah", "relationship": "child"}],
        "provider_responsibilities": [
            "structural_repairs",
            "shared_areas",
            "property_rates",
        ],
        "tenant_responsibilities": [
            "routine_cleaning",
            "report_damage",
            "respect_neighbours",
            "residential_use",
        ],
        "notice_channels": ["Rooomly", "written notice"],
        "additional_terms": [{"title": "Courtyard", "body": "Keep the shared courtyard clear."}],
    },
}


class TestCanonicalAgreementBuilder:
    def test_guided_terms_become_a_frozen_executed_document(self, landlord, user, unit):
        from hashlib import sha256

        from apps.lease import execution
        from apps.lease.models import LeaseWorkflow, TemplateReviewStatus

        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=CANONICAL_TERMS)
        assert lease.workflow_version == LeaseWorkflow.CANONICAL
        assert lease.template.review_status == TemplateReviewStatus.REQUIRES_REVIEW

        lease = services.ready_lease(lease=lease, user=landlord)
        assert lease.status == LeaseStatus.READY
        lease = services.offer_lease(lease=lease, user=landlord)
        agreement = lease.agreement
        assert lease.status == LeaseStatus.OFFERED
        assert agreement.reference_number.startswith("RLY-GH-")
        assert agreement.template_version == lease.template.version
        assert agreement.rendered_text
        assert "Keep the shared courtyard clear" in agreement.rendered_text
        assert execution.verify(agreement)["hash_matches"] is True
        assert agreement.acceptances.count() == 0

        services.record_tenant_review(lease=lease, user=user)
        lease = services.accept_lease(lease=lease, user=user, acknowledged=True)
        assert lease.status == LeaseStatus.TENANT_ACCEPTED
        assert lease.landlord_accepted_at is None
        assert not hasattr(lease, "occupancy")

        lease = services.confirm_lease(lease=lease, user=landlord)
        assert lease.status == LeaseStatus.ACTIVE
        agreement.refresh_from_db()
        assert agreement.executed_at is not None
        assert bytes(agreement.final_pdf).startswith(b"%PDF")
        assert agreement.final_pdf_hash == sha256(bytes(agreement.final_pdf)).hexdigest()
        assert agreement.advance_acknowledged is True
        assert agreement.acceptances.count() == 2
        assert execution.verify(agreement)["fully_accepted"] is True

        agreement.rendered_text = "silently changed"
        with pytest.raises(RuntimeError, match="immutable"):
            agreement.save(update_fields=["rendered_text", "updated_at"])
        with pytest.raises(RuntimeError, match="cannot be deleted"):
            agreement.delete()

    @override_settings(LEASE_TEMPLATE_REQUIRE_APPROVAL=True)
    def test_unreviewed_template_cannot_be_sent_in_production_mode(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=CANONICAL_TERMS)
        lease = services.ready_lease(lease=lease, user=landlord)
        with pytest.raises(ValidationFailed, match="legal approval"):
            services.offer_lease(lease=lease, user=landlord)


def _accepted(landlord, user, unit):
    """A canonical agreement carried all the way to active, both sides bound."""
    lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=CANONICAL_TERMS)
    lease = services.ready_lease(lease=lease, user=landlord)
    lease = services.offer_lease(lease=lease, user=landlord)
    services.record_tenant_review(lease=lease, user=user)
    lease = services.accept_lease(lease=lease, user=user, acknowledged=True)
    return services.confirm_lease(lease=lease, user=landlord)


class TestTheAgreementOutlivesItsTemplate:
    """The promise that decides whether the rest of this was worth building.

    Rooomly's standard wording will change. An agreement accepted under the old
    wording must still reproduce the old wording — same sections, same hash,
    same PDF bytes — because that, and not whatever the template says today, is
    what the two parties actually agreed to.
    """

    def test_a_later_template_release_does_not_rewrite_an_accepted_agreement(
        self, landlord, user, unit
    ):
        from apps.lease import execution
        from apps.lease.models import LeaseTemplate
        from apps.lease.pdf import render_final_pdf

        lease = _accepted(landlord, user, unit)
        agreement = lease.agreement
        signed_text = agreement.rendered_text
        signed_hash = agreement.content_hash
        signed_pdf = bytes(agreement.final_pdf)
        signed_version = agreement.template_version
        assert "Rooomly preserves the rendered agreement" in signed_text

        # 2028 arrives and counsel rewrites the standard wording.
        LeaseTemplate.objects.filter(pk=lease.template_id).update(
            clauses=[
                {
                    "id": "parties_and_premises",
                    "title": "1. Parties",
                    "body": "Completely different wording agreed years later.",
                }
            ],
            version="2028.01-approved.1",
        )
        assert LeaseTemplate.objects.get(pk=lease.template_id).version == "2028.01-approved.1"

        # The accepted agreement is unmoved: not re-rendered, not re-hashed, and
        # still naming the version it was actually made under.
        agreement.refresh_from_db()
        assert agreement.rendered_text == signed_text
        assert agreement.content_hash == signed_hash
        assert bytes(agreement.final_pdf) == signed_pdf
        assert agreement.template_version == signed_version
        assert "Completely different wording" not in agreement.rendered_text
        assert execution.verify(agreement)["hash_matches"] is True

        # And re-rendering reads the stored snapshot rather than rebuilding
        # from the template, so the document cannot drift on a regeneration.
        # Byte-length against a sectionless copy, because "it starts with %PDF"
        # is equally true of a PDF containing none of the agreement.
        import copy

        reproduced = render_final_pdf(agreement)
        assert reproduced.startswith(b"%PDF")

        hollow = copy.copy(agreement)
        hollow.rendered_document = {**agreement.rendered_document, "sections": []}
        assert len(reproduced) > len(
            render_final_pdf(hollow)
        ), "the PDF does not depend on the stored clauses"

    def test_both_parties_can_fetch_the_document_afterwards(self, signed_in, landlord, user, unit):
        lease = _accepted(landlord, user, unit)
        url = f"/api/v1/leases/{lease.id}/document.pdf"

        for who, label in ((landlord, "h"), (user, "t")):
            response = signed_in(who, label).get(url)
            assert response.status_code == 200, who
            assert response["Content-Type"] == "application/pdf"
            assert response.content.startswith(b"%PDF")

    def test_a_stranger_cannot_fetch_the_document(self, signed_in, landlord, user, agent, unit):
        lease = _accepted(landlord, user, unit)
        response = signed_in(agent, "s").get(f"/api/v1/leases/{lease.id}/document.pdf")
        assert response.status_code in (403, 404)


class TestConfirmationChecksItsOwnEvidence:
    def test_the_provider_cannot_confirm_before_the_tenant_accepts(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=CANONICAL_TERMS)
        lease = services.ready_lease(lease=lease, user=landlord)
        lease = services.offer_lease(lease=lease, user=landlord)
        with pytest.raises(Conflict, match="has not accepted"):
            services.confirm_lease(lease=lease, user=landlord)

        services.record_tenant_review(lease=lease, user=user)
        # Reviewing is not accepting.
        with pytest.raises(Conflict, match="has not accepted"):
            services.confirm_lease(lease=lease, user=landlord)

    def test_a_tampered_snapshot_cannot_be_confirmed(self, landlord, user, unit):
        """The tenant accepted a specific document, identified by its hash.

        If the stored hash and the stored content have stopped agreeing, the
        acceptance on file is evidence about something else and confirmation
        must stop rather than bind somebody to it.
        """
        from apps.lease.models import LeaseAgreement

        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=CANONICAL_TERMS)
        lease = services.ready_lease(lease=lease, user=landlord)
        lease = services.offer_lease(lease=lease, user=landlord)
        services.record_tenant_review(lease=lease, user=user)
        lease = services.accept_lease(lease=lease, user=user, acknowledged=True)

        # Straight past the model's immutability guard, the way a bad migration
        # or a direct database edit would.
        LeaseAgreement.objects.filter(pk=lease.agreement.pk).update(content_hash="0" * 64)
        lease.refresh_from_db()
        with pytest.raises(Conflict, match="no longer matches"):
            services.confirm_lease(lease=lease, user=landlord)


class TestReferenceNumbers:
    def test_two_agreements_prepared_together_get_different_references(
        self, landlord, user, agent, unit
    ):
        """The ids are UUIDv7, so a slice off their front is a timestamp.

        An amendment is executed moments after the agreement it replaces, which
        is exactly the case that collided against the unique reference column.
        """
        from apps.lease.documents import reference_for
        from apps.lease.models import Lease

        first = services.draft_lease(user=landlord, unit=unit, tenant=user, data=CANONICAL_TERMS)
        # Written directly, back to back in the same instant: the point is the
        # reference, not the drafting rules the unit constraints enforce.
        second = Lease(
            workflow_version=first.workflow_version,
            template=first.template,
            unit=first.unit,
            landlord=first.landlord,
            tenant=first.tenant,
            supersedes=first,
            rent_minor=first.rent_minor,
            starts_on=first.starts_on,
            term_months=first.term_months,
        )
        second.save()
        assert reference_for(first) != reference_for(second)


class TestAmendment:
    """Changing an accepted agreement is a second agreement, not an edit."""

    def test_an_accepted_agreement_is_replaced_rather_than_edited(self, landlord, user, unit):
        original = _accepted(landlord, user, unit)
        original_hash = original.agreement.content_hash

        amendment = services.amend_lease(lease=original, user=landlord, data={"rent_minor": 250000})
        assert amendment.id != original.id
        assert amendment.supersedes_id == original.id
        assert amendment.status == LeaseStatus.DRAFT
        assert amendment.rent_minor == 250000
        # Everything not being changed comes along, so amending the rent does
        # not silently drop the utilities, the occupants or the custom terms.
        assert amendment.structured_terms == original.structured_terms

        # The original is untouched and still live while this is negotiated.
        original.refresh_from_db()
        assert original.status == LeaseStatus.ACTIVE
        assert original.agreement.content_hash == original_hash

    def test_the_tenant_must_accept_the_amendment_too(self, landlord, user, unit):
        original = _accepted(landlord, user, unit)
        amendment = services.amend_lease(lease=original, user=landlord, data={"rent_minor": 250000})
        amendment = services.ready_lease(lease=amendment, user=landlord)
        amendment = services.offer_lease(lease=amendment, user=landlord)

        # Sending it changes nothing on its own: the original is still the
        # agreement in force.
        original.refresh_from_db()
        assert original.status == LeaseStatus.ACTIVE
        assert amendment.status == LeaseStatus.OFFERED

        services.record_tenant_review(lease=amendment, user=user)
        amendment = services.accept_lease(lease=amendment, user=user, acknowledged=True)
        amendment = services.confirm_lease(lease=amendment, user=landlord)
        assert amendment.status == LeaseStatus.ACTIVE
        assert amendment.agreement.acceptances.count() == 2

        # Only now is the original retired, and it keeps its own frozen record.
        original.refresh_from_db()
        assert original.status == LeaseStatus.SUPERSEDED
        assert original.superseded_at is not None
        assert original.agreement.content_hash != amendment.agreement.content_hash

    def test_one_tenancy_survives_the_amendment(self, landlord, user, unit):
        original = _accepted(landlord, user, unit)
        original.refresh_from_db()
        tenancy_id = original.tenancy_id
        assert tenancy_id is not None

        amendment = services.amend_lease(lease=original, user=landlord, data={"rent_minor": 250000})
        amendment = services.ready_lease(lease=amendment, user=landlord)
        amendment = services.offer_lease(lease=amendment, user=landlord)
        services.record_tenant_review(lease=amendment, user=user)
        amendment = services.accept_lease(lease=amendment, user=user, acknowledged=True)
        amendment = services.confirm_lease(lease=amendment, user=landlord)

        # One home, one relationship, successive agreements over it.
        amendment.refresh_from_db()
        assert amendment.tenancy_id == tenancy_id

    def test_an_abandoned_amendment_leaves_the_original_alone(self, landlord, user, unit):
        original = _accepted(landlord, user, unit)
        amendment = services.amend_lease(lease=original, user=landlord, data={"rent_minor": 250000})
        amendment = services.ready_lease(lease=amendment, user=landlord)
        amendment = services.offer_lease(lease=amendment, user=landlord)
        services.decline_lease(lease=amendment, user=user, reason="Too much")

        original.refresh_from_db()
        assert original.status == LeaseStatus.ACTIVE
        assert original.superseded_at is None
        # And the provider may try again.
        services.amend_lease(lease=original, user=landlord, data={"rent_minor": 210000})

    def test_only_one_amendment_may_be_open_at_a_time(self, landlord, user, unit):
        original = _accepted(landlord, user, unit)
        services.amend_lease(lease=original, user=landlord, data={"rent_minor": 250000})
        with pytest.raises(Conflict, match="already open"):
            services.amend_lease(lease=original, user=landlord, data={"rent_minor": 260000})

    def test_a_draft_is_edited_not_amended(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=CANONICAL_TERMS)
        with pytest.raises(Conflict, match="Only an active agreement"):
            services.amend_lease(lease=lease, user=landlord, data={"rent_minor": 250000})

    def test_the_tenant_cannot_amend_their_own_agreement(self, landlord, user, unit):
        original = _accepted(landlord, user, unit)
        with pytest.raises(PermissionDenied):
            services.amend_lease(lease=original, user=user, data={"rent_minor": 1000})

    def test_amending_over_http_answers_with_the_new_agreement(
        self, signed_in, landlord, user, unit
    ):
        original = _accepted(landlord, user, unit)
        response = signed_in(landlord, "h").post(
            f"/api/v1/leases/{original.id}/amend/",
            {"rent_minor": 250000},
            format="json",
        )
        assert response.status_code == 201, response.json()
        assert response.json()["supersedes"] == str(original.id)
        assert response.json()["rent_minor"] == 250000


class TestTermsAreASnapshot:
    def test_editing_the_listing_afterwards_does_not_change_the_agreement(
        self, landlord, user, unit, live_listing
    ):
        """The listing can be edited or withdrawn tomorrow. What was agreed
        today must not move."""
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=user, data=dict(TERMS), listing=live_listing
        )

        live_listing.rent_minor = 999999
        live_listing.advance_months = 24
        live_listing.save(update_fields=["rent_minor", "advance_months"])

        lease.refresh_from_db()
        assert lease.rent_minor == 150000
        assert lease.advance_months == 6


class TestAcceptance:
    def test_neither_side_can_bind_the_other_alone(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))

        # Offering is the landlord's acceptance, and it is not enough.
        lease = services.offer_lease(lease=lease, user=landlord)
        assert lease.status == LeaseStatus.OFFERED
        assert lease.landlord_accepted_at is not None
        assert lease.tenant_accepted_at is None
        assert not lease.both_accepted

        lease = services.accept_lease(lease=lease, user=user)
        assert lease.both_accepted
        assert lease.status == LeaseStatus.ACTIVE
        assert lease.activated_at is not None

    def test_the_landlord_cannot_accept_on_the_tenants_behalf(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.offer_lease(lease=lease, user=landlord)
        with pytest.raises(PermissionDenied):
            services.accept_lease(lease=lease, user=landlord)

    def test_a_draft_cannot_be_accepted_before_it_is_sent(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        with pytest.raises(Conflict):
            services.accept_lease(lease=lease, user=user)

    def test_the_tenant_can_decline(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.offer_lease(lease=lease, user=landlord)
        lease = services.decline_lease(lease=lease, user=user, reason="Found somewhere else")
        assert lease.status == LeaseStatus.DECLINED
        assert lease.decline_reason == "Found somewhere else"

    def test_declining_frees_the_unit_for_another_agreement(self, landlord, user, agent, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.offer_lease(lease=lease, user=landlord)
        services.decline_lease(lease=lease, user=user)

        again = services.draft_lease(user=landlord, unit=unit, tenant=agent, data=dict(TERMS))
        assert again.id != lease.id


class TestStatutoryAdvance:
    def test_six_months_is_within_the_act(self, landlord, user, unit):
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=user, data=dict(TERMS, advance_months=6)
        )
        assert not lease.exceeds_statutory_advance

    def test_more_than_six_months_is_flagged_but_not_blocked(self, landlord, user, unit):
        """The Rent Act 1963 limits advance rent on a monthly tenancy to six
        months. Two-year advances are routine anyway, so the platform records
        what was actually agreed and says plainly that it exceeds the limit."""
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=user, data=dict(TERMS, advance_months=24)
        )
        assert lease.exceeds_statutory_advance
        assert lease.status == LeaseStatus.DRAFT  # not refused

    def test_the_flag_is_about_monthly_tenancies(self, landlord, user, unit):
        lease = services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=user,
            data=dict(TERMS, advance_months=24, rent_period="yearly"),
        )
        assert not lease.exceeds_statutory_advance


class TestGoingLiveClosesTheMarket:
    def test_the_listing_stops_being_advertised(self, landlord, user, unit, live_listing):
        from apps.listing.models import AvailabilityState, Listing, ListingStatus, PublicationState

        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=user, data=dict(TERMS), listing=live_listing
        )
        services.accept_lease(lease=services.offer_lease(lease=lease, user=landlord), user=user)

        listing = Listing.objects.get(id=live_listing.id)
        assert listing.status == ListingStatus.WITHDRAWN
        assert listing.publication_state == PublicationState.WITHDRAWN
        assert listing.availability_state == AvailabilityState.TAKEN

    def test_occupied_space_cannot_be_published_invited_or_joined(
        self, landlord, user, unit, live_listing, approve_space
    ):
        from apps.listing import services as listing_services
        from apps.property import access_codes

        approve_space(unit)
        unit, raw_code = access_codes.rotate(unit=unit, actor=landlord)
        lease = services.draft_lease(
            user=landlord, unit=unit, tenant=user, data=dict(TERMS), listing=live_listing
        )
        services.accept_lease(lease=services.offer_lease(lease=lease, user=landlord), user=user)

        unit.refresh_from_db()
        live_listing.refresh_from_db()
        assert unit.access_code_revoked_at is not None
        assert access_codes.state(unit) == "unavailable"
        with pytest.raises(NotFound):
            access_codes.resolve(raw_code)
        with pytest.raises(Conflict):
            access_codes.rotate(unit=unit, actor=landlord)
        with pytest.raises(Conflict):
            listing_services.publish_listing(listing=live_listing, user=landlord)
        provider_api = APIClient()
        provider_api.force_authenticate(user=landlord)
        detail = provider_api.get(f"/api/v1/units/{unit.id}/")
        assert detail.data["availability"]["state"] == "occupied"
        assert detail.data["publication"]["state"] == "withdrawn"
        assert detail.data["access_code"]["state"] == "unavailable"
        assert detail.data["permitted_actions"]["publish"]["allowed"] is False
        assert detail.data["permitted_actions"]["invite_tenant"]["allowed"] is False
        assert provider_api.post(f"/api/v1/listings/{live_listing.id}/publish/").status_code == 409

        public_api = APIClient()
        assert public_api.get(f"/api/v1/listings/{live_listing.id}/").status_code == 404
        public_ids = [row["id"] for row in public_api.get("/api/v1/listings/").data["results"]]
        assert str(live_listing.id) not in public_ids

    def test_the_other_applicants_are_told_the_room_is_gone(
        self, landlord, user, agent, unit, live_listing
    ):
        """The application slice deliberately left this alone: rejecting people
        on a landlord's behalf is only defensible once the unit is actually
        gone."""
        from apps.application import services as application_services
        from apps.application.models import ApplicationStatus

        winner = application_services.submit_application(
            listing=live_listing, tenant=user, data={"advance_months_offered": 6}
        )
        other = application_services.submit_application(
            listing=live_listing, tenant=agent, data={"advance_months_offered": 12}
        )

        lease = services.draft_lease(
            user=landlord,
            unit=unit,
            tenant=user,
            data=dict(TERMS),
            application=winner,
            listing=live_listing,
        )
        services.accept_lease(lease=services.offer_lease(lease=lease, user=landlord), user=user)

        other.refresh_from_db()
        assert other.status == ApplicationStatus.REJECTED
        assert "let to someone else" in other.decision_note

        winner.refresh_from_db()
        assert winner.status != ApplicationStatus.REJECTED


class TestEnding:
    def test_a_live_agreement_cannot_be_cancelled_only_ended(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.accept_lease(
            lease=services.offer_lease(lease=lease, user=landlord), user=user
        )
        with pytest.raises(Conflict):
            services.cancel_lease(lease=lease, user=landlord)

        lease = services.end_lease(
            lease=lease, user=landlord, reason="Tenancy completed", confirmed=True
        )
        assert lease.status == LeaseStatus.ENDED
        assert lease.ended_on is not None

    def test_either_party_can_end_it(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.accept_lease(
            lease=services.offer_lease(lease=lease, user=landlord), user=user
        )
        lease = services.end_lease(lease=lease, user=user, reason="Moving out", confirmed=True)
        assert lease.status == LeaseStatus.ENDED

    def test_ending_frees_the_unit(self, landlord, user, agent, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.accept_lease(
            lease=services.offer_lease(lease=lease, user=landlord), user=user
        )
        services.end_lease(lease=lease, user=landlord, confirmed=True)

        again = services.draft_lease(user=landlord, unit=unit, tenant=agent, data=dict(TERMS))
        assert again.status == LeaseStatus.DRAFT

    def test_ending_requires_explicit_confirmation(self, landlord, user, unit):
        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.accept_lease(
            lease=services.offer_lease(lease=lease, user=landlord), user=user
        )

        with pytest.raises(ValidationFailed):
            services.end_lease(lease=lease, user=landlord, reason="Tenant moved out")
        lease.refresh_from_db()
        assert lease.status == LeaseStatus.ACTIVE

        api = APIClient()
        api.force_authenticate(user=landlord)
        refused = api.post(
            f"/api/v1/leases/{lease.id}/end/",
            {"reason": "Tenant moved out"},
            format="json",
        )
        assert refused.status_code == 422
        lease.refresh_from_db()
        assert lease.status == LeaseStatus.ACTIVE

        ended = api.post(
            f"/api/v1/leases/{lease.id}/end/",
            {"reason": "Tenant moved out", "confirmed": True},
            format="json",
        )
        assert ended.status_code == 200
        lease.refresh_from_db()
        assert lease.status == LeaseStatus.ENDED


class TestAudit:
    def test_the_agreement_has_a_verifiable_history(self, landlord, user, unit):
        from apps.audit.models import AuditLog
        from apps.audit.services import verify_chain

        lease = services.draft_lease(user=landlord, unit=unit, tenant=user, data=dict(TERMS))
        lease = services.accept_lease(
            lease=services.offer_lease(lease=lease, user=landlord), user=user
        )

        entries = AuditLog.objects.filter(aggregate_type="lease", aggregate_id=str(lease.id))
        assert entries.count() == 4  # drafted, offered, accepted/awaiting, activated
        ok, broken = verify_chain("lease", str(lease.id))
        assert ok, broken


class TestApi:
    @pytest.fixture
    def signed_in(self, sms, sign_in_as):
        def _sign_in(person, label):
            client = APIClient()
            sign_in_as(client, user=person, device_fingerprint=label)
            return client

        return _sign_in

    def test_offer_and_accept_over_http(self, signed_in, landlord, user, unit):
        host = signed_in(landlord, "h")
        tenant = signed_in(user, "t")

        drafted = host.post(
            "/api/v1/me/leases/",
            {
                "unit_id": str(unit.id),
                "tenant_id": str(user.id),
                "rent_minor": 150000,
                "advance_months": 24,
                "deposit_months": 1,
                "starts_on": str(date.today() + timedelta(days=14)),
                "term_months": 12,
                "conditions": "Water and electricity are on prepaid meters, paid by the tenant.",
            },
            format="json",
        )
        assert drafted.status_code == 201, drafted.data
        assert drafted.data["exceeds_statutory_advance"] is True
        assert drafted.data["statutory_advance_limit_months"] == 6
        assert drafted.data["move_in_total_formatted"]

        lease_id = drafted.data["id"]
        offered = host.post(f"/api/v1/leases/{lease_id}/offer/", {}, format="json")
        assert offered.data["status"] == "offered"

        # The tenant sees it, with the terms as agreed.
        mine = tenant.get("/api/v1/me/leases/")
        assert mine.data[0]["advance_months"] == 24
        assert mine.data[0]["exceeds_statutory_advance"] is True

        accepted = tenant.post(f"/api/v1/leases/{lease_id}/accept/", {}, format="json")
        assert accepted.data["status"] == "active"
        assert accepted.data["both_accepted"] is True

    def test_a_tenant_cannot_see_a_provider_draft_before_it_is_offered(
        self, signed_in, landlord, user, unit
    ):
        host = signed_in(landlord, "draft-host")
        tenant = signed_in(user, "draft-tenant")
        drafted = host.post(
            "/api/v1/me/leases/",
            {
                "unit_id": str(unit.id),
                "tenant_id": str(user.id),
                "rent_minor": 150000,
                "starts_on": str(date.today() + timedelta(days=7)),
            },
            format="json",
        )
        assert drafted.status_code == 201, drafted.data

        assert tenant.get("/api/v1/me/leases/").data == []
        detail = tenant.get(f"/api/v1/leases/{drafted.data['id']}/")
        assert detail.status_code == 403

        offered = host.post(f"/api/v1/leases/{drafted.data['id']}/offer/", {}, format="json")
        assert offered.status_code == 200, offered.data
        assert tenant.get("/api/v1/me/leases/").data[0]["status"] == "offered"

    def test_only_the_named_tenant_can_decline_an_open_offer(
        self, signed_in, landlord, user, agent, unit
    ):
        host = signed_in(landlord, "decline-host")
        tenant = signed_in(user, "decline-tenant")
        stranger = signed_in(agent, "decline-stranger")
        drafted = host.post(
            "/api/v1/me/leases/",
            {
                "unit_id": str(unit.id),
                "tenant_id": str(user.id),
                "rent_minor": 150000,
                "starts_on": str(date.today() + timedelta(days=7)),
            },
            format="json",
        )
        lease_id = drafted.data["id"]
        assert host.post(f"/api/v1/leases/{lease_id}/offer/", {}, format="json").status_code == 200

        denied = stranger.post(
            f"/api/v1/leases/{lease_id}/decline/", {"reason": "Not mine"}, format="json"
        )
        assert denied.status_code == 403

        declined = tenant.post(
            f"/api/v1/leases/{lease_id}/decline/",
            {"reason": "The move-in date no longer works."},
            format="json",
        )
        assert declined.status_code == 200, declined.data
        assert declined.data["status"] == "declined"
        assert declined.data["decline_reason"] == "The move-in date no longer works."

        late_accept = tenant.post(f"/api/v1/leases/{lease_id}/accept/", {}, format="json")
        assert late_accept.status_code == 409

    def test_a_stranger_cannot_read_an_agreement(self, signed_in, landlord, user, agent, unit):
        host = signed_in(landlord, "h")
        drafted = host.post(
            "/api/v1/me/leases/",
            {
                "unit_id": str(unit.id),
                "tenant_id": str(user.id),
                "rent_minor": 150000,
                "starts_on": str(date.today() + timedelta(days=7)),
            },
            format="json",
        )

        stranger = signed_in(agent, "s")
        response = stranger.get(f"/api/v1/leases/{drafted.data['id']}/")
        assert response.status_code in (403, 404)

    def test_leases_require_signing_in(self):
        assert APIClient().get("/api/v1/me/leases/").status_code in (401, 403)
