"""Every photograph the product shows must be loadable by an ``<img>``.

The bug this pins is systemic rather than cosmetic. ``GET
/api/v1/files/<id>/download/`` does not serve bytes — it returns
``{"url": ..., "expires_in": ...}`` and requires a bearer token, so an
``<img src>`` pointed at it gets 401 unauthenticated and JSON authenticated.
Three serializers handed that path out as ``download_url`` for every read that
was not the public one, which is every provider-side read there is: the Unit
page, the Units list, the Property page, the photo manager, and the listing card
for anything not currently advertised.

The gate stays strict in the other direction: a document or a piece of evidence
is still reached through the audited endpoint, because reading those is
something the audit log should record.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

pytestmark = pytest.mark.django_db


def _file(owner, name, *, purpose="property_photo", sensitive=False):
    from apps.files.models import ScanStatus, StoredFile, UploadStatus

    return StoredFile.objects.create(
        storage_key=f"image-url/{uuid4()}-{name}",
        bucket="test",
        original_filename=name,
        declared_content_type="image/jpeg",
        content_type="image/jpeg",
        size_bytes=70_000,
        purpose=purpose,
        is_sensitive=sensitive,
        upload_status=UploadStatus.READY,
        scan_status=ScanStatus.CLEAN,
        uploaded_by=owner,
        owner_id_snapshot=str(owner.id),
    )


def _renderable(url: str) -> bool:
    """A URL a browser can paint, rather than one it has to be taught to fetch."""
    return bool(url) and not url.startswith("/api/v1/files/")


@pytest.fixture
def live_listing(landlord):
    """An advertised listing, the way discovery sees one."""
    from apps.geo.models import Address, District, Locality, Region
    from apps.listing.models import Listing, ListingStatus
    from apps.property.models import Property, PropertyType, Unit

    region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
    district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
    locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
    prop = Property.objects.create(
        owner=landlord,
        managed_by=landlord,
        created_by=landlord,
        title="Osu block",
        property_type=PropertyType.RESIDENTIAL,
        address=Address.objects.create(locality=locality),
    )
    unit = Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)
    return Listing.objects.create(
        unit=unit,
        created_by=landlord,
        status=ListingStatus.ACTIVE,
        rent_minor=150000,
        headline="Chamber and hall in Osu",
        description="Prepaid meter.",
        advance_months=12,
        locality_id_cache=locality.id,
        bedrooms_cache=1,
    )


class TestPhotographsRender:
    def test_a_photograph_is_handed_out_as_something_an_img_can_load(self, landlord):
        from apps.files.photos import inline_image_url

        url = inline_image_url(_file(landlord, "front.jpg"))
        assert _renderable(url)
        # `inline`, not the default `attachment`: with an attachment
        # disposition the request succeeds and the frame stays empty.
        assert "inline" in url

    def test_the_provider_side_unit_read_is_not_a_json_endpoint(self, landlord):
        """This is the read behind the Unit page, the Units list and the
        photo manager, and it used to point every one of them at JSON."""
        from apps.geo.models import Address, District, Locality, Region
        from apps.property.models import Property, PropertyType, Unit, UnitMedia
        from apps.property.serializers import UnitDetailSerializer

        region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
        district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
        locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
        prop = Property.objects.create(
            owner=landlord,
            managed_by=landlord,
            created_by=landlord,
            title="Osu block",
            property_type=PropertyType.RESIDENTIAL,
            address=Address.objects.create(locality=locality),
        )
        unit = Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)
        UnitMedia.objects.create(unit=unit, file=_file(landlord, "room.jpg"), is_primary=True)

        data = UnitDetailSerializer(unit, context={"user": landlord}).data

        assert _renderable(data["primary_photo"]["download_url"])
        assert _renderable(data["media"][0]["download_url"])

    def test_a_listing_that_is_not_advertised_still_shows_its_own_photographs(self, landlord, user):
        """A withdrawn or paused listing is read by the provider editing it.

        Its gallery was a column of broken frames, because only the ACTIVE
        branch produced a loadable URL.
        """
        from apps.listing.serializers import _listing_photo_url

        photo = _file(landlord, "campaign.jpg")
        assert _renderable(_listing_photo_url(photo, public=True))
        assert _renderable(_listing_photo_url(photo, public=False))


class TestEvidenceStaysAudited:
    def test_a_sensitive_file_is_never_handed_out_as_a_direct_link(self, landlord):
        from apps.files.photos import inline_image_url, viewable_url

        secret = _file(landlord, "id-card.jpg", purpose="identity_document", sensitive=True)
        assert inline_image_url(secret) is None
        # It is still reachable — through the endpoint that records the read.
        assert viewable_url(secret).startswith("/api/v1/files/")

    def test_a_document_keeps_the_audited_endpoint(self, landlord):
        from apps.files.photos import inline_image_url, viewable_url

        document = _file(landlord, "lease.pdf", purpose="property_document")
        assert inline_image_url(document) is None
        assert viewable_url(document).startswith("/api/v1/files/")

    def test_an_unusable_file_offers_nothing(self, landlord):
        from apps.files.models import ScanStatus
        from apps.files.photos import viewable_url

        infected = _file(landlord, "bad.jpg")
        infected.scan_status = ScanStatus.INFECTED
        infected.save(update_fields=["scan_status"])

        assert viewable_url(infected) is None


class TestTheCardFindsThePhotograph:
    """Explore said "Photo pending" for every rental in the database.

    `Listing.media` is *campaign* media — an optional set a provider may attach
    to an advertisement. Nothing in the normal flow creates any: photographs are
    uploaded to the **Unit**, because that is what the condition check is
    decided on. On a freshly built database there are zero `ListingMedia` rows
    and twelve `UnitMedia`, so a card reading `media[0]` found nothing.
    """

    def test_the_cover_comes_from_the_unit_when_the_campaign_has_no_photographs(
        self, landlord, live_listing
    ):
        from apps.listing.serializers import ListingSerializer
        from apps.property.models import UnitMedia

        assert live_listing.media.count() == 0
        UnitMedia.objects.create(
            unit=live_listing.unit, file=_file(landlord, "room.jpg"), is_primary=True
        )

        data = ListingSerializer(live_listing).data
        assert data["media"] == []
        assert _renderable(data["cover_url"])

    def test_the_units_own_primary_photograph_leads(self, landlord, live_listing):
        """The card follows the same order the detail gallery does."""
        from apps.listing.models import ListingMedia
        from apps.listing.serializers import ListingSerializer
        from apps.property.models import UnitMedia

        UnitMedia.objects.create(
            unit=live_listing.unit, file=_file(landlord, "the-room.jpg"), is_primary=True
        )
        ListingMedia.objects.create(
            listing=live_listing, file=_file(landlord, "campaign.jpg"), is_cover=True
        )

        data = ListingSerializer(live_listing).data
        assert "the-room.jpg" in data["cover_url"]
        assert [row["file_id"] for row in data["card_media"]] == [
            str(live_listing.unit.media.get().file_id),
            str(live_listing.media.get().file_id),
        ]

    def test_card_media_is_small_ordered_and_deduplicated(self, landlord, live_listing):
        from apps.listing.models import ListingMedia
        from apps.listing.serializers import ListingSerializer
        from apps.property.models import UnitMedia

        files = [_file(landlord, f"room-{index}.jpg") for index in range(6)]
        for index, stored in enumerate(files):
            UnitMedia.objects.create(
                unit=live_listing.unit,
                file=stored,
                is_primary=index == 2,
                sort_order=index,
            )
        # Reusing a Unit file for campaign marketing must not create a repeated
        # swipe page on the card.
        ListingMedia.objects.create(listing=live_listing, file=files[2], is_cover=True)

        data = ListingSerializer(live_listing).data
        assert len(data["card_media"]) == 5
        assert data["card_media"][0]["file_id"] == str(files[2].id)
        assert len({row["file_id"] for row in data["card_media"]}) == 5
        assert data["cover_url"] == data["card_media"][0]["download_url"]

    def test_a_listing_with_no_photographs_anywhere_says_so_honestly(self, live_listing):
        from apps.listing.serializers import ListingSerializer

        data = ListingSerializer(live_listing).data
        assert data["cover_url"] is None
        assert data["card_media"] == []


class TestThePropertyRowFindsAPhotograph:
    """The Properties list showed a name and an address and no picture at all.

    The picture of a building has to *be* the building. A Unit's photograph is
    not an answer: a room is not the block containing it, and a property of
    twelve flats would wear whichever flat happened to be photographed first.

    `PropertyMedia` is where a Property's photographs belong, and it is empty —
    `PropertyMediaView` is routed and `attach_media` works, and neither client
    calls either. But photographs of the building do exist, because every
    Property is asked for its front, a side and its surroundings before it can
    be verified. Those are pictures of the place, taken for that purpose.
    """

    @pytest.fixture
    def prop(self, landlord):
        from apps.geo.models import Address, District, Locality, Region
        from apps.property.models import Property, PropertyType

        region, _ = Region.objects.get_or_create(name="Greater Accra", defaults={"code": "GA"})
        district, _ = District.objects.get_or_create(region=region, name="Accra Metropolitan")
        locality, _ = Locality.objects.get_or_create(district=district, name="Osu")
        return Property.objects.create(
            owner=landlord,
            managed_by=landlord,
            created_by=landlord,
            title="Osu block",
            property_type=PropertyType.RESIDENTIAL,
            address=Address.objects.create(locality=locality),
        )

    def _cover(self, prop, landlord):
        from apps.property.serializers import PropertySerializer

        return PropertySerializer(prop, context={"user": landlord}).data["cover_url"]

    def _evidence(self, prop, landlord, slot, file, *, status=None, collected_at=None):
        from apps.trust.models import (
            SubjectType,
            Verification,
            VerificationEvidence,
            VerificationKind,
            VerificationMethod,
            VerificationStatus,
        )

        # One live review per Property is a database constraint, so several
        # photographs share the review they were collected for — which is what
        # actually happens: a provider fills the slots in one sitting.
        review, _ = Verification.objects.get_or_create(
            subject_type=SubjectType.PROPERTY,
            subject_id=str(prop.id),
            kind=VerificationKind.PROPERTY_CONDITION,
            status=status or VerificationStatus.PENDING,
            defaults={"method": VerificationMethod.DOCUMENT_REVIEW},
        )
        row = VerificationEvidence.objects.create(
            verification=review, evidence_type=slot, file=file, collected_by=landlord
        )
        if collected_at is not None:
            VerificationEvidence.objects.filter(pk=row.pk).update(collected_at=collected_at)
            row.refresh_from_db()
        return row

    def test_the_front_of_the_building_is_its_face(self, landlord, prop):
        from apps.trust.models import EvidenceType

        self._evidence(prop, landlord, EvidenceType.PROPERTY_FRONT, _file(landlord, "front.jpg"))

        assert _renderable(self._cover(prop, landlord))

    def test_a_units_photograph_is_never_the_buildings_face(self, landlord, prop):
        """A room is not the block containing it."""
        from apps.property.models import Unit, UnitMedia

        unit = Unit.objects.create(property=prop, label="Flat A", bedrooms=1, bathrooms=1)
        UnitMedia.objects.create(unit=unit, file=_file(landlord, "room.jpg"), is_primary=True)

        assert self._cover(prop, landlord) is None

    def test_the_propertys_own_media_leads(self, landlord, prop):
        """So the fallback stops the day an upload flow exists, with no change
        to the serializer: its own media is simply read first."""
        from apps.property.models import PropertyMedia
        from apps.trust.models import EvidenceType

        self._evidence(prop, landlord, EvidenceType.PROPERTY_FRONT, _file(landlord, "front.jpg"))
        outside = _file(landlord, "outside.jpg")
        PropertyMedia.objects.create(property=prop, file=outside, kind="exterior")

        assert outside.storage_key in self._cover(prop, landlord)

    def test_the_named_slots_are_ranked_rather_than_taken_in_any_order(self, landlord, prop):
        """The slots are named so a reviewer knows which side they are looking
        at, and that naming is what lets a cover pick the front over a side.

        The front is deliberately the *older* photograph here. Taking whichever
        arrived last would pass this test by accident and would put a side wall
        on the card the moment a provider re-uploaded one.
        """
        from datetime import timedelta

        from django.utils import timezone

        from apps.trust.models import EvidenceType

        now = timezone.now()
        side = _file(landlord, "side.jpg")
        front = _file(landlord, "front.jpg")
        self._evidence(
            prop,
            landlord,
            EvidenceType.PROPERTY_FRONT,
            front,
            collected_at=now - timedelta(days=2),
        )
        self._evidence(prop, landlord, EvidenceType.PROPERTY_SIDE, side, collected_at=now)

        cover = self._cover(prop, landlord)
        assert front.storage_key in cover
        assert side.storage_key not in cover

    def test_a_utility_close_up_is_not_a_portrait_of_the_place(self, landlord, prop):
        """The water source and the meter are photographs of a *fact*. They are
        collected under `property_photo` like the rest, so only the slot list
        keeps them out."""
        from apps.trust.models import EvidenceType

        self._evidence(prop, landlord, EvidenceType.WATER_SOURCE_VIEW, _file(landlord, "tank.jpg"))
        self._evidence(prop, landlord, EvidenceType.POWER_METER_VIEW, _file(landlord, "meter.jpg"))

        assert self._cover(prop, landlord) is None

    def test_a_replaced_photograph_does_not_resurface(self, landlord, prop):
        """A correction is a new verification. What it replaced stays readable
        as evidence and must not come back as the building's face."""
        from apps.trust.models import EvidenceType, VerificationStatus

        self._evidence(
            prop,
            landlord,
            EvidenceType.PROPERTY_FRONT,
            _file(landlord, "old.jpg"),
            status=VerificationStatus.SUPERSEDED,
        )

        assert self._cover(prop, landlord) is None

    def test_a_title_deed_never_becomes_a_thumbnail(self, landlord, prop):
        """Two independent guards: the slot is not a photographic slot, and the
        file's purpose is not `property_photo`. Either alone would refuse it."""
        from apps.property.models import PropertyMedia

        PropertyMedia.objects.create(
            property=prop,
            file=_file(landlord, "deed.pdf", purpose="property_document"),
            kind="document",
        )

        assert self._cover(prop, landlord) is None

    def test_a_floor_plan_is_not_the_face_of_the_building(self, landlord, prop):
        from apps.property.models import PropertyMedia

        PropertyMedia.objects.create(
            property=prop, file=_file(landlord, "plan.jpg"), kind="floor_plan"
        )

        assert self._cover(prop, landlord) is None

    def test_a_property_with_no_photographs_anywhere_says_so_honestly(self, prop, landlord):
        assert self._cover(prop, landlord) is None

    def test_the_list_costs_one_query_however_many_buildings(self, landlord, prop):
        """`subject_id` is a CharField, not a foreign key, so this cannot be
        prefetched — which is why the serializer batches it."""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from apps.geo.models import Address
        from apps.property.models import Property, PropertyType
        from apps.property.serializers import PropertySerializer
        from apps.trust.condition import cover_photographs
        from apps.trust.models import EvidenceType

        self._evidence(prop, landlord, EvidenceType.PROPERTY_FRONT, _file(landlord, "a.jpg"))
        for index in range(4):
            other = Property.objects.create(
                owner=landlord,
                managed_by=landlord,
                created_by=landlord,
                title=f"Block {index}",
                property_type=PropertyType.RESIDENTIAL,
                address=Address.objects.create(locality=prop.address.locality),
            )
            self._evidence(
                other, landlord, EvidenceType.PROPERTY_FRONT, _file(landlord, f"b{index}.jpg")
            )

        rows = list(Property.objects.all())
        with CaptureQueriesContext(connection) as captured:
            cover_photographs([row.id for row in rows])
        assert len(captured) == 1

        serializer = PropertySerializer(rows, many=True, context={"user": landlord})
        for name in list(serializer.child.fields):
            if name != "cover_url":
                serializer.child.fields.pop(name)
        assert all(row["cover_url"] for row in serializer.data)
