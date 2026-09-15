"""Geography API.

Reference data (regions, districts, localities) is readable without signing in:
a tenant filtering a search has not necessarily got an account yet, and the list
of Ghana's regions is not a secret. Creating an address requires a session,
because it is a fact someone is asserting and the property that hangs off it is
audited.

This module imports only from rest_framework and apps.core. geo is part of the
platform layer, so it must not reach up into identity, trust or property - see
ADR 0002 and tests/unit/test_module_boundaries.py.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import asdict

from django.conf import settings
from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound, ProviderUnavailable

from .models import Address, District, Locality, Region
from .providers import LocalityProvider, LocationProviderError, location_provider, provider_named
from .serializers import (
    AddressSerializer,
    CreateAddressSerializer,
    DistrictSerializer,
    LocalitySerializer,
    PlaceResolveQuerySerializer,
    PlaceSuggestQuerySerializer,
    RegionSerializer,
    ResolvedPlaceSerializer,
)
from .throttling import PlaceLookupThrottle

logger = logging.getLogger(__name__)

PLACES_UNAVAILABLE = "Place search is not available right now. You can still search by name."


class RegionListView(APIView):
    """GET /geo/regions/ — Ghana's 16 regions."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(RegionSerializer(Region.objects.all(), many=True).data)


class DistrictListView(APIView):
    """GET /geo/districts/?region=<uuid>"""

    permission_classes = [AllowAny]

    def get(self, request):
        districts = District.objects.select_related("region")
        region = request.query_params.get("region")
        if region:
            districts = districts.filter(region_id=region)
        return Response(DistrictSerializer(districts, many=True).data)


class LocalityListView(APIView):
    """GET /geo/localities/?q=osu&district=<uuid>

    ``q`` matches the name or any of the alternative names people actually
    search with - Nima/Kanda, Spintex/Sakumono - so someone typing the name they
    know finds the listing an agent filed under a different one.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        localities = Locality.objects.filter(is_active=True).select_related("district__region")

        district = request.query_params.get("district")
        if district:
            localities = localities.filter(district_id=district)

        query = (request.query_params.get("q") or "").strip()
        if query:
            # Name is a substring match; aliases are matched as whole entries,
            # which is what JSONB containment gives us without a GIN index.
            localities = localities.filter(Q(name__icontains=query) | Q(aliases__contains=[query]))

        return Response(LocalitySerializer(localities[:50], many=True).data)


class AddressListCreateView(APIView):
    """POST /geo/addresses/ — record where something is."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = CreateAddressSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        locality_id = data.get("locality_id")
        place_name = place_context = place_provider = place_reference = ""
        if place := data.get("place"):
            provider = provider_named(place["provider"])
            if provider is None:
                raise ProviderUnavailable(PLACES_UNAVAILABLE)

            # A Rooomly fallback result already names a controlled Locality and
            # needs no geometry in order to become an Address.
            if provider.name == "rooomly":
                try:
                    reference_id = uuid.UUID(place["reference"])
                except ValueError:
                    raise NotFound("We could not find that town or neighbourhood.") from None
                locality = Locality.objects.filter(
                    id=reference_id, is_active=True
                ).first()
                if locality is None:
                    raise NotFound("We could not find that town or neighbourhood.") from None
                locality_id = locality.id
            else:
                try:
                    resolved = provider.resolve(
                        place["reference"],
                        session=str(place["session"]) if place.get("session") else None,
                        name_hint=place["name"],
                    )
                except LocationProviderError as exc:
                    raise ProviderUnavailable(PLACES_UNAVAILABLE) from exc
                if resolved is None or resolved.kind != "area":
                    raise NotFound("Choose a town or neighbourhood from the location results.")

                # A caller cannot smuggle a foreign Place ID past Ghana-only
                # autocomplete: resolving must still land inside product bounds.
                west, south, east, north = settings.MAP_BOUNDS
                if not (
                    west <= resolved.center.lng <= east
                    and south <= resolved.center.lat <= north
                ):
                    raise NotFound("That location is outside Rooomly's coverage area.")

                place_name = resolved.display_name
                place_context = place.get("context", "")
                place_provider = resolved.provider
                place_reference = resolved.reference

        address = Address.objects.create(
            locality_id=locality_id,
            place_name=place_name,
            place_context=place_context,
            place_provider=place_provider,
            place_reference=place_reference,
            digital_address=data.get("digital_address", ""),
            street=data.get("street", ""),
            house_number=data.get("house_number", ""),
            landmark=data.get("landmark", ""),
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
            # Coordinates typed by a user are not surveyed coordinates. The
            # source stays blank until something authoritative sets it.
        )
        address = Address.objects.select_related("locality__district__region").get(id=address.id)
        return Response(AddressSerializer(address).data, status=status.HTTP_201_CREATED)


class AddressDetailView(APIView):
    """GET /geo/addresses/<uuid:pk>/"""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        address = Address.objects.select_related("locality__district__region").filter(id=pk).first()
        if address is None:
            from apps.core.exceptions import NotFound

            raise NotFound("We could not find that address.")
        return Response(AddressSerializer(address).data)


class PlaceSuggestView(APIView):
    """GET /geo/places/suggest/?q=east leg&session=<uuid> — suggestions while somebody types.

    Readable signed out, like the rest of the reference data. The API asks the
    location provider on the client's behalf (ADR 0034): no client carries a
    Places-enabled key, every client is restricted to Ghana the same way, and one
    throttle stands between the open internet and the bill. A provider that fails
    mid-search is replaced by Rooomly's localities for that request, and the
    response names who answered so the client shows the right attribution.
    """

    permission_classes = [AllowAny]
    throttle_classes = [PlaceLookupThrottle]

    def get(self, request):
        params = PlaceSuggestQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        text = data.get("q", "")
        session = str(data["session"]) if data.get("session") else None

        provider = location_provider()
        suggestions = []
        # One letter matches half the country and costs the same as a real query.
        if len(text) >= 2:
            try:
                suggestions = provider.suggest(
                    text,
                    session=session,
                    limit=data["limit"],
                    areas_only=data["scope"] == "areas",
                )
            except LocationProviderError:
                logger.warning("place_suggestions_fell_back", extra={"provider": provider.name})
                provider = LocalityProvider()
                suggestions = provider.suggest(
                    text,
                    session=None,
                    limit=data["limit"],
                    areas_only=data["scope"] == "areas",
                )

        response = Response(
            {
                "provider": provider.name,
                "attribution": provider.attribution,
                "suggestions": [asdict(suggestion) for suggestion in suggestions],
            }
        )
        # A provider's content is not ours to cache, and a session's answers are its own.
        response["Cache-Control"] = "no-store"
        return response


class PlaceResolveView(APIView):
    """GET /geo/places/resolve/?provider=google&reference=…&session=<uuid>&name=…

    The chosen suggestion, located: a centre, and a box for the map to fit and
    the search to search. Resolved by the provider that suggested it and with the
    same session token, which is what closes the provider's billing session.
    Nothing is stored — the client keeps the result in the address bar.
    """

    permission_classes = [AllowAny]
    throttle_classes = [PlaceLookupThrottle]

    def get(self, request):
        params = PlaceResolveQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data

        provider = provider_named(data["provider"])
        if provider is None:
            raise ProviderUnavailable(PLACES_UNAVAILABLE)
        try:
            place = provider.resolve(
                data["reference"],
                session=str(data["session"]) if data.get("session") else None,
                name_hint=data.get("name", ""),
            )
        except LocationProviderError as exc:
            raise ProviderUnavailable(PLACES_UNAVAILABLE) from exc
        if place is None:
            raise NotFound(
                "We could not find that place.", details={"reference": data["reference"]}
            )

        response = Response(ResolvedPlaceSerializer(place).data)
        response["Cache-Control"] = "no-store"
        return response


class MapConfigView(APIView):
    """GET /map/config/ — what every map shares: where it may go and where it opens.

    Provider-neutral. Which library draws the map, and with which key, is each
    client's own build configuration (ADR 0034); the part of the world Rooomly
    covers is decided once, here.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "bounds": list(settings.MAP_BOUNDS),
                "default_view": settings.MAP_DEFAULT_VIEW,
                "min_zoom": 6,
                "max_zoom": 20,
            }
        )
