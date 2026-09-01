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

from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Address, District, Locality, Region
from .serializers import (
    AddressSerializer,
    CreateAddressSerializer,
    DistrictSerializer,
    LocalitySerializer,
    RegionSerializer,
)


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

        address = Address.objects.create(
            locality_id=data["locality_id"],
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
