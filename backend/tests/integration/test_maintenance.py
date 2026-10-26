"""Maintenance requests: a tenant reports, the provider fixes, the tenant decides.

What is pinned here is who may do what, and in which order — the whole point of
the lifecycle is that "fixed" is the tenant's word, not the provider's.
"""

from datetime import date

import pytest
from rest_framework.test import APIClient

from apps.files.models import FilePurpose, ScanStatus, StoredFile, UploadStatus
from apps.lease import services as lease_services
from apps.maintenance.models import MaintenanceRequest, MaintenanceStatus
from apps.notifications.models import Notification
from apps.outbox.tasks import dispatch_pending

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
def tenancy(landlord, user, unit):
    lease = lease_services.draft_lease(
        user=landlord,
        unit=unit,
        tenant=user,
        data={
            "rent_minor": 150000,
            "advance_months": 6,
            "starts_on": date.today(),
            "term_months": 12,
        },
    )
    lease = lease_services.offer_lease(lease=lease, user=landlord)
    lease = lease_services.accept_lease(lease=lease, user=user)
    lease.refresh_from_db()
    assert lease.tenancy is not None and lease.tenancy.status == "active"
    return lease.tenancy


def _file(owner, purpose=FilePurpose.MAINTENANCE_PHOTO, *, ready=True, content_type="image/jpeg"):
    return StoredFile.objects.create(
        storage_key=f"{purpose}/2026/10/{owner.id}/{StoredFile.objects.count()}.bin",
        bucket="test",
        storage_backend="local",
        original_filename="leak.jpg",
        declared_content_type=content_type,
        content_type=content_type,
        size_bytes=2048,
        checksum_sha256="b" * 64,
        purpose=purpose,
        upload_status=UploadStatus.READY if ready else UploadStatus.UPLOADED,
        scan_status=ScanStatus.CLEAN if ready else ScanStatus.PENDING,
        uploaded_by=owner,
        owner_id_snapshot=str(owner.id),
    )


def _client(sign_in_as, person):
    api = APIClient()
    sign_in_as(api, user=person)
    return api


def _report(api, tenancy, photo, **extra):
    return api.post(
        "/api/v1/me/maintenance/",
        {
            "tenancy_id": str(tenancy.id),
            "category": "plumbing",
            "description": "The kitchen tap drips all night and the sink is flooding.",
            "photo_file_id": str(photo.id),
            **extra,
        },
        format="json",
    )


class TestReporting:
    def test_a_tenant_reports_with_one_photo_and_the_landlord_is_told(
        self, sign_in_as, landlord, user, tenancy
    ):
        response = _report(_client(sign_in_as, user), tenancy, _file(user))

        assert response.status_code == 201, response.data
        assert response.data["status"] == "submitted"
        assert response.data["photo"]["url"]
        assert response.data["video"] is None
        assert [event["kind"] for event in response.data["events"]] == ["submitted"]
        request = MaintenanceRequest.objects.get(id=response.data["id"])
        assert request.unit_id == tenancy.unit_id and request.property_id == tenancy.property_id

        dispatch_pending()
        notice = Notification.objects.get(user=landlord, kind="maintenance.submitted")
        assert notice.target_type == "maintenance_request"
        assert notice.target_id == str(request.id)

    def test_the_photo_is_required(self, sign_in_as, user, tenancy):
        api = _client(sign_in_as, user)
        response = api.post(
            "/api/v1/me/maintenance/",
            {"tenancy_id": str(tenancy.id), "category": "plumbing", "description": "Leaking tap."},
            format="json",
        )
        assert response.status_code == 422

    def test_somebody_elses_photo_cannot_be_attached(self, sign_in_as, landlord, user, tenancy):
        response = _report(_client(sign_in_as, user), tenancy, _file(landlord))
        assert response.status_code == 404

    def test_the_photo_must_be_a_checked_maintenance_photo(self, sign_in_as, user, tenancy):
        api = _client(sign_in_as, user)
        assert _report(api, tenancy, _file(user, FilePurpose.PROPERTY_PHOTO)).status_code == 422
        assert _report(api, tenancy, _file(user, ready=False)).status_code == 422

    def test_one_photo_belongs_to_one_request(self, sign_in_as, user, tenancy):
        api = _client(sign_in_as, user)
        photo = _file(user)
        assert _report(api, tenancy, photo).status_code == 201
        assert _report(api, tenancy, photo).status_code == 422

    def test_only_an_active_tenancy_takes_requests(self, sign_in_as, user, tenancy):
        tenancy.status = "ended"
        tenancy.save(update_fields=["status"])
        assert _report(_client(sign_in_as, user), tenancy, _file(user)).status_code == 409

    def test_nobody_reports_against_a_tenancy_that_is_not_theirs(self, sign_in_as, agent, tenancy):
        assert _report(_client(sign_in_as, agent), tenancy, _file(agent)).status_code == 404


class TestTheVideo:
    def _video(self, user):
        return _file(user, FilePurpose.MAINTENANCE_VIDEO, content_type="video/mp4")

    def test_a_clip_cut_on_the_device_needs_no_window(self, sign_in_as, user, tenancy):
        response = _report(
            _client(sign_in_as, user),
            tenancy,
            _file(user),
            video_file_id=str(self._video(user).id),
            video_duration_ms=4800,
        )
        assert response.status_code == 201, response.data
        assert response.data["video"]["content_type"] == "video/mp4"
        assert response.data["video_clip_start_ms"] is None

    def test_a_longer_video_must_say_which_five_seconds(self, sign_in_as, user, tenancy):
        api = _client(sign_in_as, user)
        video = self._video(user)
        missing = _report(
            api, tenancy, _file(user), video_file_id=str(video.id), video_duration_ms=12000
        )
        assert missing.status_code == 422

        too_long = _report(
            api,
            tenancy,
            _file(user),
            video_file_id=str(video.id),
            video_duration_ms=12000,
            video_clip_start_ms=1000,
            video_clip_end_ms=6500,
        )
        assert too_long.status_code == 422

        chosen = _report(
            api,
            tenancy,
            _file(user),
            video_file_id=str(video.id),
            video_duration_ms=12000,
            video_clip_start_ms=2000,
            video_clip_end_ms=7000,
        )
        assert chosen.status_code == 201, chosen.data
        assert (chosen.data["video_clip_start_ms"], chosen.data["video_clip_end_ms"]) == (
            2000,
            7000,
        )

    def test_a_photo_is_not_a_video(self, sign_in_as, user, tenancy):
        response = _report(
            _client(sign_in_as, user), tenancy, _file(user), video_file_id=str(_file(user).id)
        )
        assert response.status_code == 422


class TestTheLifecycle:
    def _reported(self, sign_in_as, user, tenancy):
        response = _report(_client(sign_in_as, user), tenancy, _file(user))
        assert response.status_code == 201
        return response.data["id"]

    def test_fixed_is_the_tenants_word(self, sign_in_as, landlord, user, tenancy):
        request_id = self._reported(sign_in_as, user, tenancy)
        provider = _client(sign_in_as, landlord)
        tenant = _client(sign_in_as, user)
        base = f"/api/v1/maintenance/{request_id}"

        # The tenant cannot move their own report forward.
        assert tenant.post(f"{base}/start/", {}, format="json").status_code == 403
        # Nor can it be called fixed before anyone has started.
        assert provider.post(f"{base}/fixed/", {}, format="json").status_code == 409

        started = provider.post(f"{base}/start/", {}, format="json")
        assert started.status_code == 200
        assert started.data["status"] == "in_progress"

        fixed = provider.post(f"{base}/fixed/", {"note": "Replaced the washer."}, format="json")
        assert fixed.data["status"] == "awaiting_tenant_confirmation"
        assert fixed.data["events"][-1]["note"] == "Replaced the washer."

        # Only the tenant answers, and a reopen must say what is still wrong.
        assert provider.post(f"{base}/confirm/", {}, format="json").status_code == 403
        assert tenant.post(f"{base}/reopen/", {"reason": ""}, format="json").status_code == 422

        detail = tenant.get(f"{base}/")
        assert detail.data["permissions"] == {
            "start": False,
            "report_fixed": False,
            "confirm": True,
            "reopen": True,
        }

        reopened = tenant.post(f"{base}/reopen/", {"reason": "Still dripping."}, format="json")
        assert reopened.data["status"] == "reopened"
        assert reopened.data["reopen_count"] == 1

        provider.post(f"{base}/start/", {}, format="json")
        provider.post(f"{base}/fixed/", {}, format="json")
        done = tenant.post(f"{base}/confirm/", {}, format="json")
        assert done.data["status"] == "completed"
        assert done.data["completed_at"]
        assert [event["kind"] for event in done.data["events"]] == [
            "submitted",
            "started",
            "fixed_reported",
            "reopened",
            "started",
            "fixed_reported",
            "confirmed",
        ]
        # Finished is finished.
        assert tenant.post(f"{base}/reopen/", {"reason": "x"}, format="json").status_code == 409

    def test_each_side_hears_what_it_must_act_on(self, sign_in_as, landlord, user, tenancy):
        request_id = self._reported(sign_in_as, user, tenancy)
        request = MaintenanceRequest.objects.get(id=request_id)
        from apps.maintenance import services

        services.start_work(request=request, user=landlord)
        services.report_fixed(request=request, user=landlord, note="New washer fitted.")
        dispatch_pending()

        kinds = set(Notification.objects.filter(user=user).values_list("kind", flat=True))
        assert {"maintenance.in_progress", "maintenance.awaiting_confirmation"} <= kinds
        asked = Notification.objects.get(user=user, kind="maintenance.awaiting_confirmation")
        assert "New washer fitted." in asked.body

        services.reopen(request=request, user=user, reason="Still leaking under the sink.")
        dispatch_pending()
        told = Notification.objects.get(user=landlord, kind="maintenance.reopened")
        assert "Still leaking" in told.body
        assert MaintenanceRequest.objects.get(id=request_id).status == MaintenanceStatus.REOPENED


class TestWhoSeesIt:
    def test_a_stranger_sees_nothing_and_cannot_read_the_photo(
        self, sign_in_as, landlord, agent, user, tenancy
    ):
        from apps.files.services import can_read

        photo = _file(user)
        response = _report(_client(sign_in_as, user), tenancy, photo)
        request_id = response.data["id"]

        assert (
            _client(sign_in_as, agent).get(f"/api/v1/maintenance/{request_id}/").status_code == 404
        )
        assert (
            _client(sign_in_as, landlord).get(f"/api/v1/maintenance/{request_id}/").status_code
            == 200
        )
        assert can_read(user=landlord, stored=photo)
        assert not can_read(user=agent, stored=photo)

    def test_the_tenant_lists_their_own_and_can_filter_open(self, sign_in_as, user, tenancy):
        api = _client(sign_in_as, user)
        _report(api, tenancy, _file(user))
        assert len(api.get("/api/v1/me/maintenance/").data) == 1
        assert len(api.get("/api/v1/me/maintenance/?status=open").data) == 1
        assert len(api.get("/api/v1/me/maintenance/?status=completed").data) == 0


class TestThePortfolioList:
    @pytest.fixture
    def portfolio(self, landlord, address, approve_provider):
        from apps.organization import services as organization_services
        from apps.property import services as property_services
        from tests.conftest import approve_provider_standing

        organization = organization_services.create_organization(
            user=landlord,
            data={
                "name": "Osu Properties",
                "organization_type": "individual_owner",
                "activities": ["residential"],
            },
        )
        approve_provider_standing(landlord)
        prop = property_services.create_private_property(
            user=landlord,
            organization=organization,
            data={"title": "Osu block", "property_type": "residential", "address_id": address.id},
        )
        approve_provider(landlord, prop)
        space = property_services.add_unit(
            prop=prop,
            user=landlord,
            data={"label": "Flat A", "space_type": "apartment", "bedrooms": 1},
        )
        return organization, space

    def test_members_see_their_properties_requests(
        self, sign_in_as, landlord, user, agent, portfolio, tenancy
    ):
        from apps.maintenance import services

        organization, space = portfolio
        lease = lease_services.draft_lease(
            user=landlord,
            unit=space,
            tenant=agent,
            data={
                "rent_minor": 90000,
                "advance_months": 6,
                "starts_on": date.today(),
                "term_months": 12,
            },
        )
        lease = lease_services.accept_lease(
            lease=lease_services.offer_lease(lease=lease, user=landlord), user=agent
        )
        lease.refresh_from_db()
        services.submit_request(
            user=agent,
            tenancy_id=lease.tenancy_id,
            category="electrical",
            description="The socket by the bed sparks when used.",
            photo_file_id=_file(agent).id,
        )
        # A request on a property outside this Portfolio stays out of its list.
        _report(_client(sign_in_as, user), tenancy, _file(user))

        rows = _client(sign_in_as, landlord).get(
            f"/api/v1/organizations/{organization.id}/maintenance/"
        )
        assert rows.status_code == 200
        assert [row["category"] for row in rows.data] == ["electrical"]
        assert (
            _client(sign_in_as, user)
            .get(f"/api/v1/organizations/{organization.id}/maintenance/")
            .status_code
            == 404
        )


class TestVideoFiles:
    def test_phone_and_browser_video_is_recognised(self):
        from apps.files.validation import sniff_content_type

        assert sniff_content_type(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 8) == "video/mp4"
        assert sniff_content_type(b"\x00\x00\x00\x14ftypqt  " + b"\x00" * 8) == "video/quicktime"
        assert sniff_content_type(b"\x1a\x45\xdf\xa3" + b"\x00" * 12) == "video/webm"
        # HEIC still reads as a photograph, not a video.
        assert sniff_content_type(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8) == "image/heic"

    def test_a_video_is_not_accepted_as_a_photo(self):
        from apps.files.validation import FileValidationError, validate_declared_upload

        validate_declared_upload(
            purpose="maintenance_video", content_type="video/mp4", size_bytes=4_000_000
        )
        with pytest.raises(FileValidationError):
            validate_declared_upload(
                purpose="maintenance_photo", content_type="video/mp4", size_bytes=4_000_000
            )
        with pytest.raises(FileValidationError):
            validate_declared_upload(
                purpose="maintenance_video", content_type="video/mp4", size_bytes=40 * 1024 * 1024
            )
