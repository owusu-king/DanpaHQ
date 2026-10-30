"""Indexed, bounded reference search. No network service is called while typing."""

import re
import unicodedata

from django.contrib.postgres.search import TrigramSimilarity
from django.db.models import BooleanField, Case, IntegerField, Q, Value, When
from django.db.models.expressions import RawSQL


def normalize_name(value):
    value = unicodedata.normalize("NFKD", value).casefold()
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).strip()


def search_localities(query="", *, district=None, region=None):
    from .models import Locality

    rows = Locality.objects.filter(is_active=True).select_related("district__region", "region")
    if district:
        rows = rows.filter(district_id=district)
    if region:
        rows = rows.filter(Q(region_id=region) | Q(district__region_id=region))
    key = normalize_name(query)
    if key:
        rows = rows.filter(Q(search_text__contains=key) | Q(normalized_name__trigram_similar=key))
        rows = rows.annotate(
            alias_exact=RawSQL(
                "EXISTS (SELECT 1 FROM jsonb_array_elements_text(geo_locality.aliases) "
                "AS a(value) WHERE lower(a.value) = %s)",
                [query.strip().casefold()],
                output_field=BooleanField(),
            ),
            relevance=Case(
                When(Q(normalized_name=key) | Q(alias_exact=True), then=Value(0)),
                When(normalized_name__startswith=key, then=Value(1)),
                When(search_text__contains=key, then=Value(2)),
                default=Value(3),
                output_field=IntegerField(),
            ),
            similarity=TrigramSimilarity("normalized_name", key),
            place_priority=Case(
                When(kind__in=["PPLC", "PPLA", "city"], then=Value(0)),
                When(kind__in=["PPLA2", "town"], then=Value(1)),
                default=Value(2),
                output_field=IntegerField(),
            ),
        ).order_by("relevance", "place_priority", "-similarity", "name", "id")
    else:
        rows = rows.order_by("name", "id")
    return rows
