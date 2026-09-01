"""Publication, moderation and availability are separate axes.

While they shared one `status` field, withdrawing an approved listing erased
the approval — so re-publishing unchanged work sent it back through the review
queue. These pin the split, and the compatibility of the derived status the
rest of the system still reads.
"""

import pytest

from apps.listing.models import (
    AvailabilityState,
    ListingStatus,
    ModerationState,
    PublicationState,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def operations_admin(db):
    from apps.operations.models import ManagementRole, ManagementUser

    admin, _ = ManagementUser.objects.get_or_create(
        email="axes-reviewer@example.com",
        defaults={
            "first_name": "Axes",
            "last_name": "Reviewer",
            "role": ManagementRole.OPERATIONS_ADMIN,
            "password": "unused",
        },
    )
    return admin


@pytest.fixture
def listing(landlord, approve_provider, db):
    """A draft listing on a property the landlord genuinely holds.

    `approve_provider` establishes the reviewed preconditions publishing needs
    — phone, identity, provider standing and authority over the address. Doing
    that by hand here would describe a state the product cannot reach.
    """
    from apps.geo.models import Address, District, Locality, Region
    from apps.listing.models import Listing
    from apps.property.models import (
        Property,
        PropertyRelationship,
        PropertyRelationshipType,
        PropertyType,
        Unit,
    )

    region = Region.objects.first() or Region.objects.create(name="Greater Accra")
    district = District.objects.filter(region=region).first() or District.objects.create(
        region=region, name="Adentan Municipal"
    )
    locality = Locality.objects.filter(district=district).first() or Locality.objects.create(
        district=district, name="Adenta"
    )
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Axes Test",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality, street="1 Axis Road"),
    )
    PropertyRelationship.objects.create(
        property=prop,
        user=landlord,
        relationship_type=PropertyRelationshipType.OWNER,
        granted_by=landlord,
    )
    approve_provider(landlord, prop)
    unit = Unit.objects.create(
        property=prop,
        label="Main",
        bedrooms=2,
        bathrooms=1,
        space_type="apartment",
    )
    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        headline="A place to live",
        description="Somewhere to sleep and cook.",
        rent_minor=150000,
        rent_currency="GHS",
    )


class TestDerivation:
    """`status` is the collapsed view. It must stay exactly what it was."""

    @pytest.mark.parametrize(
        "moderation,publication,availability,expected",
        [
            (
                ModerationState.NOT_REVIEWED,
                PublicationState.DRAFT,
                AvailabilityState.AVAILABLE,
                ListingStatus.DRAFT,
            ),
            (
                ModerationState.PENDING,
                PublicationState.PUBLISHED,
                AvailabilityState.AVAILABLE,
                ListingStatus.PENDING_REVIEW,
            ),
            (
                ModerationState.APPROVED,
                PublicationState.PUBLISHED,
                AvailabilityState.AVAILABLE,
                ListingStatus.ACTIVE,
            ),
            (
                ModerationState.APPROVED,
                PublicationState.PUBLISHED,
                AvailabilityState.TAKEN,
                ListingStatus.RENTED,
            ),
            (
                ModerationState.APPROVED,
                PublicationState.PUBLISHED,
                AvailabilityState.EXPIRED,
                ListingStatus.EXPIRED,
            ),
            (
                ModerationState.APPROVED,
                PublicationState.WITHDRAWN,
                AvailabilityState.AVAILABLE,
                ListingStatus.WITHDRAWN,
            ),
            (
                ModerationState.REJECTED,
                PublicationState.DRAFT,
                AvailabilityState.AVAILABLE,
                ListingStatus.REJECTED,
            ),
            (
                ModerationState.FLAGGED,
                PublicationState.PUBLISHED,
                AvailabilityState.AVAILABLE,
                ListingStatus.FLAGGED,
            ),
            (
                ModerationState.SUSPENDED,
                PublicationState.PUBLISHED,
                AvailabilityState.AVAILABLE,
                ListingStatus.SUSPENDED,
            ),
        ],
    )
    def test_every_combination_collapses_to_the_old_vocabulary(
        self, moderation, publication, availability, expected
    ):
        from apps.listing.models import Listing

        listing = Listing(
            moderation_state=moderation,
            publication_state=publication,
            availability_state=availability,
        )

        assert listing.derived_status() == expected

    def test_a_moderation_verdict_outranks_what_the_provider_asked_for(self):
        """A suspended listing is not a draft the provider may re-publish."""
        from apps.listing.models import Listing

        listing = Listing(
            moderation_state=ModerationState.SUSPENDED,
            publication_state=PublicationState.DRAFT,
        )

        assert listing.derived_status() == ListingStatus.SUSPENDED

    def test_saving_keeps_status_in_step_with_the_axes(self, listing):
        listing.publication_state = PublicationState.WITHDRAWN
        listing.save(update_fields=["publication_state", "updated_at"])
        listing.refresh_from_db()

        # `status` was not in update_fields; the model adds it, or the two drift.
        assert listing.status == ListingStatus.WITHDRAWN


class TestApprovalSurvivesBeingTakenDown:
    """The defect this phase exists to fix."""

    def test_republishing_an_approved_listing_skips_the_queue(
        self, listing, landlord, approve_space
    ):
        from apps.listing import services

        approve_space(listing.unit)
        services.publish_listing(listing=listing, user=landlord)
        assert listing.status == ListingStatus.ACTIVE

        services.withdraw_listing(listing=listing, user=landlord, reason="Family visiting.")
        listing.refresh_from_db()
        assert listing.status == ListingStatus.WITHDRAWN
        # The verdict is a fact about what review decided, and survives.
        assert listing.moderation_state == ModerationState.APPROVED

        services.publish_listing(listing=listing, user=landlord)
        listing.refresh_from_db()

        assert listing.status == ListingStatus.ACTIVE, "unchanged work was re-queued"

    def test_an_unchecked_space_cannot_be_published_at_all(self, listing, landlord):
        """The gate, at the axis level.

        Publishing an unchecked space used to be permitted and merely queued for
        moderation. It is now refused: the architecture says space verification
        blocks publishing that space, and a room reaching strangers on the
        strength of nobody having looked at it yet is the thing that rule exists
        to stop.
        """
        from apps.core.exceptions import Conflict
        from apps.listing import services

        with pytest.raises(Conflict):
            services.publish_listing(listing=listing, user=landlord)

        listing.refresh_from_db()
        assert listing.status == ListingStatus.DRAFT

    def test_an_approved_listing_cannot_be_edited_at_all(self, listing, landlord, approve_space):
        """What makes the re-publish shortcut safe.

        Skipping review on the way back up is only sound if the terms cannot
        have changed in between. Editing is permitted from draft, rejected and
        flagged — in each of which the moderation verdict is *not* approved —
        so an approved listing is unreachable by an edit, whether it is live or
        withdrawn. If that allowed-set ever widens, `update_listing` clears the
        approval, and this test is where the reasoning lives.
        """
        from apps.core.exceptions import Conflict
        from apps.listing import services

        approve_space(listing.unit)
        services.publish_listing(listing=listing, user=landlord)

        with pytest.raises(Conflict):
            services.update_listing(listing=listing, user=landlord, data={"rent_minor": 999999})

        services.withdraw_listing(listing=listing, user=landlord, reason="Rethinking.")
        listing.refresh_from_db()
        with pytest.raises(Conflict):
            services.update_listing(listing=listing, user=landlord, data={"rent_minor": 999999})


class TestPublicSearchIsUnaffected:
    def test_only_active_listings_are_public(self, listing, landlord, approve_space):
        """The compatibility surface.

        Public search filters on `status`, which is now derived. If the
        derivation were wrong, withdrawn or unchecked listings would be visible
        to strangers — so this checks the query the view actually runs.
        """
        from apps.core.exceptions import Conflict
        from apps.listing import services
        from apps.listing.models import Listing

        def public():
            return list(Listing.objects.filter(status=ListingStatus.ACTIVE))

        with pytest.raises(Conflict):
            services.publish_listing(listing=listing, user=landlord)
        assert listing not in public(), "an unchecked listing was public"

        approve_space(listing.unit)
        services.publish_listing(listing=listing, user=landlord)
        listing.refresh_from_db()
        assert listing in public()

        services.withdraw_listing(listing=listing, user=landlord, reason="Off the market.")
        listing.refresh_from_db()
        assert listing not in public(), "a withdrawn listing stayed public"


class TestPublishingACheckedSpace:
    """Publication is gated on the check, and is a toggle once it has passed.

    Two rules, and they are the same rule from either side. An unchecked space
    cannot be advertised at all. A checked one needs no third review: the
    property's authority was reviewed, and the space's condition was reviewed
    against a photograph of the room being let, so a queue asking somebody to
    look at that same room once more adds a wait without adding a judgement.
    """

    def test_a_checked_space_goes_live_without_queueing(self, listing, landlord, approve_space):
        from apps.listing import services

        approve_space(listing.unit)

        services.publish_listing(listing=listing, user=landlord)
        listing.refresh_from_db()

        assert listing.status == ListingStatus.ACTIVE
        assert listing.moderation_state == ModerationState.APPROVED

    def test_an_unchecked_space_is_refused_with_something_to_act_on(self, listing, landlord):
        """What keeps an unverified room from reaching strangers.

        The refusal names the space rather than reporting a state machine: a
        provider who is told "this cannot be published" and not why has no way
        to get to the thing that would fix it.
        """
        from apps.core.exceptions import Conflict
        from apps.listing import services

        with pytest.raises(Conflict) as raised:
            services.publish_listing(listing=listing, user=landlord)

        assert "space" in str(raised.value).lower()

    def test_taking_it_down_and_putting_it_back_is_just_a_toggle(
        self, listing, landlord, approve_space
    ):
        from apps.listing import services

        approve_space(listing.unit)
        services.publish_listing(listing=listing, user=landlord)

        services.withdraw_listing(listing=listing, user=landlord, reason="Family visiting.")
        listing.refresh_from_db()
        assert listing.status == ListingStatus.WITHDRAWN

        services.publish_listing(listing=listing, user=landlord)
        listing.refresh_from_db()

        assert listing.status == ListingStatus.ACTIVE

    def test_a_suspended_listing_is_not_rescued_by_a_checked_space(
        self, listing, landlord, operations_admin, approve_space
    ):
        """A moderation verdict outranks what the provider asks for.

        Otherwise getting the space checked would be a way to undo a suspension,
        which is exactly the decision suspension exists to hold.
        """
        from apps.core.exceptions import Conflict
        from apps.listing import services

        approve_space(listing.unit)
        services.publish_listing(listing=listing, user=landlord)
        services.moderate_listing(
            listing=listing,
            management_actor=operations_admin,
            action="suspend",
            note="Photographs do not match the address.",
        )
        listing.refresh_from_db()

        with pytest.raises(Conflict):
            services.publish_listing(listing=listing, user=landlord)
