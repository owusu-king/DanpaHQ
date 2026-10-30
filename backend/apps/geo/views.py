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

import json
import logging
import uuid
from dataclasses import asdict

from django.conf import settings
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound, ProviderUnavailable

from .models import Address, District, GeoDataset, Locality, LocationSourceRecord, Region
from .providers import LocalityProvider, LocationProviderError, location_provider, provider_named
from .search import search_localities
from .serializers import (
    AddressSerializer,
    CreateAddressSerializer,
    DistrictSerializer,
    LocalitySerializer,
    LocationLookupQuerySerializer,
    LocationReferenceSerializer,
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
        return Response(
            RegionSerializer(
                Region.objects.prefetch_related("source_records__dataset"), many=True
            ).data
        )


class DistrictListView(APIView):
    """GET /geo/districts/?region=<uuid>"""

    permission_classes = [AllowAny]

    def get(self, request):
        districts = (
            District.objects.select_related("region")
            .defer("boundary")
            .prefetch_related("source_records__dataset")
        )
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
        params = LocationLookupQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        rows = search_localities(
            data["q"], district=data.get("district"), region=data.get("region")
        )
        return Response(LocalitySerializer(rows[: data["limit"]], many=True).data)


class LocationSearchView(APIView):
    """GET /geo/locations/: ranked, paginated public gazetteer, never external geocoding."""

    permission_classes = [AllowAny]
    throttle_classes = [PlaceLookupThrottle]

    def get(self, request):
        params = LocationLookupQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        rows = search_localities(
            data["q"], district=data.get("district"), region=data.get("region")
        )
        if len(data["q"].strip()) < 2:
            rows = rows.none()
        rows = rows.prefetch_related("source_records__dataset")
        pagination = PageNumberPagination()
        pagination.page_size = data["limit"]
        page = pagination.paginate_queryset(rows, request, view=self)
        result = pagination.get_paginated_response(
            LocationReferenceSerializer(page, many=True).data
        )
        result.data["attribution"] = list(
            GeoDataset.objects.values("id", "url", "license", "attribution")
        )
        return result


class LocationDatasetView(APIView):
    """Public ODbL/attribution offer: reference source facts only, never private addresses."""

    permission_classes = [AllowAny]
    throttle_classes = [PlaceLookupThrottle]

    def get(self, request):
        def records():
            yield (
                json.dumps(
                    {
                        "type": "licences",
                        "database_license": "ODbL 1.0",
                        "database_license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
                        "sources": list(GeoDataset.objects.values()),
                    },
                    default=str,
                )
                + "\n"
            )
            for row in LocationSourceRecord.objects.order_by("dataset_id", "source_id").iterator(
                chunk_size=500
            ):
                yield (
                    json.dumps(
                        {
                            "dataset": row.dataset_id,
                            "source_id": row.source_id,
                            "region_id": str(row.region_id) if row.region_id else None,
                            "district_id": str(row.district_id) if row.district_id else None,
                            "locality_id": str(row.locality_id) if row.locality_id else None,
                            "data": row.data,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )

        response = StreamingHttpResponse(records(), content_type="application/x-ndjson")
        response["Content-Disposition"] = 'attachment; filename="ghana-reference.ndjson"'
        return response


class AddressListCreateView(APIView):
    """POST /geo/addresses/ — record where something is."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = CreateAddressSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        locality_id = data.get("locality_id")
        place_name = data.get("place_name", "")
        place_context = data.get("place_context", "")
        place_provider = place_reference = ""
        place_latitude = place_longitude = None
        if place := data.get("place"):
            provider = provider_named(place["provider"])
            if provider is None:
                raise ProviderUnavailable(PLACES_UNAVAILABLE)

            # A Danpa HQ fallback result already names a controlled Locality and
            # needs no geometry in order to become an Address.
            if provider.name == "danpahq":
                try:
                    reference_id = uuid.UUID(place["reference"])
                except ValueError:
                    raise NotFound("We could not find that town or neighbourhood.") from None
                locality = Locality.objects.filter(id=reference_id, is_active=True).first()
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
                    west <= resolved.center.lng <= east and south <= resolved.center.lat <= north
                ):
                    raise NotFound("That location is outside Danpa HQ's coverage area.")

                place_name = resolved.display_name
                place_context = place.get("context", "")
                place_provider = resolved.provider
                place_reference = resolved.reference
                place_latitude = round(resolved.center.lat, 6)
                place_longitude = round(resolved.center.lng, 6)

        address = Address.objects.create(
            locality_id=locality_id,
            place_name=place_name,
            place_context=place_context,
            place_provider=place_provider,
            place_reference=place_reference,
            place_latitude=place_latitude,
            place_longitude=place_longitude,
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
    mid-search is replaced by Danpa HQ's localities for that request, and the
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
    """GET /geo/places/resolve/?provider=danpahq&reference=…&session=<uuid>&name=…

    The chosen suggestion, located: a centre, and a box for the map to fit and
    the search to search. Resolved by the provider that suggested it and with the
    same optional session token for backwards compatibility. No external requests.
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
    client's own build configuration (ADR 0034); the part of the world Danpa HQ
    covers is decided once, here.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        from apps.operations.configuration import value

        return Response(
            {
                "enabled": value("MAP_ENABLED", True),
                "tiles": {
                    "url": value("MAP_TILE_URL", ""),
                    "attribution": value("MAP_TILE_ATTRIBUTION", ""),
                    "attributionUrl": value("MAP_TILE_ATTRIBUTION_URL", ""),
                },
                "bounds": list(settings.MAP_BOUNDS),
                "default_view": settings.MAP_DEFAULT_VIEW,
                "min_zoom": 6,
                "max_zoom": 20,
            }
        )
