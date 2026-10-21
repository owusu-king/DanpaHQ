"""The HTTP face of selling: public search and detail, the seller's controls, enquiries."""

from __future__ import annotations

from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFound
from apps.core.pagination import StandardCursorPagination
from apps.identity.permissions import IsPhoneVerified

from . import services
from .read_models import public_sales
from .serializers import (
    EnquiryDetailSerializer,
    EnquirySerializer,
    ReplySerializer,
    SaleCardSerializer,
    SaleDetailSerializer,
    SaleSearchSerializer,
    SellerSaleSerializer,
    StartEnquirySerializer,
    UpdateSaleSerializer,
)

_RELATED = ("property__address__locality__district__region",)


def _filtered(data: dict):
    qs = public_sales().select_related(*_RELATED)
    if data.get("q"):
        query = data["q"].strip()
        qs = qs.filter(
            Q(headline__icontains=query)
            | Q(description__icontains=query)
            | Q(property__address__locality__name__icontains=query)
            | Q(property__address__locality__district__name__icontains=query)
            | Q(property__address__place_name__icontains=query)
        )
    if "kind" in data:
        qs = qs.filter(property__property_type=data["kind"])
    if "locality_id" in data:
        qs = qs.filter(property__address__locality_id=data["locality_id"])
    if "price_min" in data:
        qs = qs.filter(price_minor__gte=data["price_min"])
    if "price_max" in data:
        qs = qs.filter(price_minor__lte=data["price_max"])
    if "bedrooms_min" in data:
        qs = qs.filter(bedrooms__gte=data["bedrooms_min"])
    if "tenure" in data:
        qs = qs.filter(tenure=data["tenure"])

    # A map window reads the stored coarse point, never the address — the same
    # rule rentals follow, so a sequence of windows cannot narrow onto a door.
    edges = ("west", "south", "east", "north")
    if all(edge in data for edge in edges):
        from apps.listing.search import Bounds

        box = Bounds(*(float(data[edge]) for edge in edges))
        qs = qs.filter(public_point__bboverlaps=box.polygon())
    return qs


class SaleSearchView(APIView):
    """GET /sales/ — properties for sale, public."""

    permission_classes = [AllowAny]

    def get(self, request):
        params = SaleSearchSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data

        # The cursor is the ordering, so every option ends in `-created_at` to
        # stay stable when two properties share a price.
        ordering = {
            "newest": ("-created_at",),
            "price_asc": ("price_minor", "-created_at"),
            "price_desc": ("-price_minor", "-created_at"),
        }[data.get("sort") or "newest"]
        qs = _filtered(data).order_by(*ordering)

        paginator = StandardCursorPagination()
        paginator.ordering = ordering
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(SaleCardSerializer(page, many=True).data)


class SaleDetailView(APIView):
    """GET /sales/<id>/ — one property for sale, while it is public."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        sale = public_sales().select_related(*_RELATED).filter(id=pk).first()
        if sale is None:
            raise NotFound("This property is not for sale right now.")
        return Response(SaleDetailSerializer(sale, context={"user": request.user}).data)


class PropertySaleView(APIView):
    """GET/PATCH /properties/<id>/sale/ — the seller's sale details."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def _prop(self, request, pk):
        from apps.property.services import assert_can_manage, get_property_or_404

        prop = get_property_or_404(pk, request.user)
        assert_can_manage(prop, request.user)
        return prop

    def get(self, request, pk):
        prop = self._prop(request, pk)
        return Response(SellerSaleSerializer(services.sale_for(prop)).data)

    def patch(self, request, pk):
        prop = self._prop(request, pk)
        payload = UpdateSaleSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        sale = services.update_sale(prop=prop, user=request.user, data=payload.validated_data)
        return Response(SellerSaleSerializer(sale).data)


class PropertySaleStatusView(APIView):
    """POST /properties/<id>/sale/<withdraw|relist|sold>/ — on and off the market."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]
    action = ""

    def post(self, request, pk):
        from apps.property.services import get_property_or_404

        prop = get_property_or_404(pk, request.user)
        act = {
            "withdraw": services.withdraw_sale,
            "relist": services.relist_sale,
            "sold": services.mark_sold,
        }[self.action]
        sale = act(prop=prop, user=request.user)
        return Response(SellerSaleSerializer(sale).data)


class SaleEnquiryStartView(APIView):
    """POST /sales/<id>/enquiries/ — a buyer asks the seller about a property."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request, pk):
        payload = StartEnquirySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        enquiry = services.start_enquiry(
            sale_id=pk, buyer=request.user, body=payload.validated_data["message"]
        )
        return Response(
            EnquiryDetailSerializer(enquiry, context={"user": request.user}).data,
            status=status.HTTP_201_CREATED,
        )


class MyEnquiriesView(APIView):
    """GET /me/sale-enquiries/?as=buyer|seller|all — the conversations a person is in.

    `all` is one inbox for somebody on both sides (owner, 2026-10-21): each
    row still says which side this person is on, newest conversation first.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        role = request.query_params.get("as", "buyer")
        if role == "all":
            rows = sorted(
                {
                    row.id: row
                    for row in [
                        *services.enquiries_for_seller(request.user)[:100],
                        *services.enquiries_for_buyer(request.user)[:100],
                    ]
                }.values(),
                key=lambda row: row.last_message_at or row.created_at,
                reverse=True,
            )
        else:
            rows = (
                services.enquiries_for_seller(request.user)
                if role == "seller"
                else services.enquiries_for_buyer(request.user)
            )
        return Response(
            EnquirySerializer(rows[:100], many=True, context={"user": request.user}).data
        )


class EnquiryDetailView(APIView):
    """GET /sale-enquiries/<id>/ — one conversation; reading it marks it read."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        enquiry = services.enquiry_for(enquiry_id=pk, user=request.user)
        services.mark_enquiry_read(enquiry=enquiry, user=request.user)
        enquiry.refresh_from_db()
        return Response(EnquiryDetailSerializer(enquiry, context={"user": request.user}).data)


class EnquiryReplyView(APIView):
    """POST /sale-enquiries/<id>/messages/ — either side answers."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request, pk):
        payload = ReplySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.reply(enquiry_id=pk, user=request.user, body=payload.validated_data["message"])
        enquiry = services.enquiry_for(enquiry_id=pk, user=request.user)
        return Response(
            EnquiryDetailSerializer(enquiry, context={"user": request.user}).data,
            status=status.HTTP_201_CREATED,
        )
