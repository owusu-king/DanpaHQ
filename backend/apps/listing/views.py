from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.core.pagination import StandardCursorPagination
from apps.files.models import StoredFile
from apps.identity.permissions import IsPhoneVerified
from apps.property.models import Amenity, Unit

from . import read_models, services
from .models import Listing, SavedListing
from .serializers import (
    AmenitySerializer,
    CreateListingSerializer,
    ListingDetailSerializer,
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

        qs = (
            read_models.public_listings()
            .select_related("unit__property__address__locality__district", "created_by")
            .prefetch_related("media__file", "unit__media__file", "highlighted_amenities")
            .order_by("-created_at")
        )

        if data.get("q"):
            query = data["q"].strip()
            qs = qs.filter(
                Q(headline__icontains=query)
                | Q(description__icontains=query)
                | Q(unit__property__address__locality__name__icontains=query)
                | Q(unit__property__address__locality__aliases__icontains=query)
                | Q(unit__property__address__locality__district__name__icontains=query)
            )
        if "locality_id" in data:
            qs = qs.filter(locality_id_cache=data["locality_id"])
        if "property_type" in data:
            qs = qs.filter(unit__property__property_type=data["property_type"])
        if "space_type" in data:
            qs = qs.filter(unit__space_type=data["space_type"])
        if "bedrooms_min" in data:
            qs = qs.filter(bedrooms_cache__gte=data["bedrooms_min"])
        if "bedrooms_max" in data:
            qs = qs.filter(bedrooms_cache__lte=data["bedrooms_max"])
        if "rent_min" in data:
            qs = qs.filter(rent_minor__gte=data["rent_min"])
        if "rent_max" in data:
            qs = qs.filter(rent_minor__lte=data["rent_max"])
        if "advance_max" in data:
            qs = qs.filter(advance_months__lte=data["advance_max"])
        if data.get("furnished") is not None:
            qs = qs.filter(unit__is_furnished=data["furnished"])
        if data.get("amenity_ids"):
            qs = qs.filter(
                unit__unit_amenities__amenity_id__in=data["amenity_ids"],
                unit__unit_amenities__removed_at__isnull=True,
            ).distinct()

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
