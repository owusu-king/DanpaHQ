from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.core.pagination import StandardCursorPagination
from apps.files.models import StoredFile
from apps.geo.serializers import PlaceSerializer
from apps.identity.permissions import IsPhoneVerified
from apps.property.models import Amenity, Unit

from . import read_models, search, services
from .models import Listing, SavedListing
from .serializers import (
    AmenitySerializer,
    CreateListingSerializer,
    ListingDetailSerializer,
    ListingMapSerializer,
    ListingMediaSerializer,
    ListingSearchSerializer,
    ListingSerializer,
    SavedListingSerializer,
    SaveListingSerializer,
    UpdateListingSerializer,
)


class ListingSearchView(APIView):
    """GET /listings/ — public discovery."""

    permission_classes = [AllowAny]

    def get(self, request):
        params = ListingSearchSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data

        # One definition of the search for the list and the map: see `search`.
        area = search.resolve_area(data)
        qs = (
            search.filtered_listings(data, area)
            .select_related("unit__property__address__locality__district", "created_by")
            .prefetch_related("media__file", "unit__media__file", "highlighted_amenities")
        )

        # The cursor *is* the ordering, so a sort choice has to move the
        # paginator with it. Every option ends in `-created_at` so the cursor
        # stays stable when two listings share a rent.
        ordering = {
            "newest": ("-created_at",),
            "rent_asc": ("rent_minor", "-created_at"),
            "rent_desc": ("-rent_minor", "-created_at"),
        }[data.get("sort") or "newest"]
        qs = qs.order_by(*ordering)

        paginator = StandardCursorPagination()
        paginator.ordering = ordering
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(ListingSerializer(page, many=True).data)


class ListingMapView(APIView):
    """GET /listings/map/ — the same search as /listings/, as price markers.

    Same parameters, same eligibility, same area — `search.filtered_listings`
    serves both — so the markers and the cards cannot describe different
    rentals. Markers are grouped on the server for the window and zoom on
    screen, which keeps a response small however many listings match.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        params = ListingMapSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data

        area = search.resolve_area(data)
        qs = search.filtered_listings(data, area)
        features, truncated = search.map_features(
            qs, window=search.map_window(data, area), zoom=data["zoom"]
        )
        body = {"zoom": data["zoom"], "features": features, "truncated": truncated}
        if data.get("summary") is not False:
            body.update(search.map_summary(qs))
            if area is not None and area.place is not None:
                body["place"] = PlaceSerializer(area.place).data
        return Response(body)


class ListingDetailView(APIView):
    """GET /listings/<pk>/ — public listing detail.

    The space first, then the property it sits in. Search results stay on the
    lighter shape; only this page pays for the extra blocks.
    """

    permission_classes = [AllowAny]

    def get(self, request, pk):
        listing = services.get_listing_or_404(pk)
        from apps.occupancy.services import unit_is_occupied

        managed = request.user.is_authenticated and listing.unit.property.is_managed_by(
            request.user
        )

        if (not listing.is_live or unit_is_occupied(listing.unit)) and not managed:
            raise NotFound("We could not find that listing.")
        return Response(ListingDetailSerializer(listing).data)


class RelatedListingsView(APIView):
    """GET /listings/<pk>/related/ — a curated public set, never a feed."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        listing = services.get_listing_or_404(pk)
        from apps.occupancy.services import unit_is_occupied

        if not listing.is_live or unit_is_occupied(listing.unit):
            raise NotFound("We could not find that listing.")

        related = read_models.related_listings(listing)
        return Response(ListingSerializer(related, many=True).data)


class MyListingsView(APIView):
    """GET/POST /me/listings/ — landlord's own listings."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def get(self, request):
        listings = (
            Listing.objects.filter(created_by=request.user)
            .select_related("unit__property")
            .prefetch_related("media__file", "unit__media__file")
            .order_by("-created_at")
        )
        response = Response(ListingSerializer(listings, many=True).data)
        response["Cache-Control"] = "private, no-store"
        return response

    def post(self, request):
        payload = CreateListingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        unit = (
            Unit.objects.filter(id=data["unit_id"], is_active=True)
            .select_related("property__address")
            .first()
        )
        if unit is None:
            raise NotFound("We could not find that unit.")

        listing = services.create_listing(user=request.user, unit=unit, data=data)
        return Response(ListingSerializer(listing).data, status=status.HTTP_201_CREATED)


class MyListingDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def patch(self, request, pk):
        listing = services.get_listing_or_404(pk)
        payload = UpdateListingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        listing = services.update_listing(
            listing=listing,
            user=request.user,
            data=payload.validated_data,
        )
        return Response(ListingSerializer(listing).data)


class ListingManageView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request, pk, action):
        listing = services.get_listing_or_404(pk)
        if action == "publish":
            listing = services.publish_listing(listing=listing, user=request.user)
        elif action == "withdraw":
            listing = services.withdraw_listing(
                listing=listing, user=request.user, reason=request.data.get("reason", "")
            )
        else:
            raise NotFound("Unknown action.")
        return Response(ListingSerializer(listing).data)


class ListingMediaView(APIView):
    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request, pk):
        listing = services.get_listing_or_404(pk)
        file_id = request.data.get("file_id")
        file = StoredFile.objects.filter(id=file_id).first()
        if file is None:
            raise NotFound("We could not find that file.")
        media = services.attach_listing_media(
            listing=listing,
            user=request.user,
            file=file,
            is_cover=request.data.get("is_cover", False),
            caption=request.data.get("caption", ""),
            sort_order=int(request.data.get("sort_order", 0)),
        )
        return Response(ListingMediaSerializer(media).data, status=status.HTTP_201_CREATED)


class AmenityListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(AmenitySerializer(Amenity.objects.all(), many=True).data)


class SavedListingsView(APIView):
    """GET/POST/DELETE /me/saved-listings/ — the tenant's shortlist.

    No phone verification required: shortlisting is a private, reversible act
    with no counterparty, and gating it would push people to screenshot
    listings instead.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        saved = (
            SavedListing.objects.filter(user=request.user)
            .select_related("listing__unit__property")
            .prefetch_related(
                "listing__media__file",
                "listing__unit__media__file",
                "listing__highlighted_amenities",
            )
        )
        return Response(SavedListingSerializer(saved, many=True).data)

    def post(self, request):
        payload = SaveListingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        listing = services.get_listing_or_404(payload.validated_data["listing_id"])
        saved, created = SavedListing.objects.get_or_create(
            user=request.user,
            listing=listing,
            defaults={"note": payload.validated_data.get("note", "")},
        )
        return Response(
            SavedListingSerializer(saved).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request):
        payload = SaveListingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        removed, _ = SavedListing.objects.filter(
            user=request.user, listing_id=payload.validated_data["listing_id"]
        ).delete()
        if not removed:
            raise NotFound("That listing is not in your shortlist.")
        return Response(status=status.HTTP_204_NO_CONTENT)
