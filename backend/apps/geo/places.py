"""Place search: from what somebody types to somewhere on a map.

A tenant types "East Leg", "Airport", "Adenta". The answer has to arrive while
they are still typing and has to be a *place* — a centre and an area the map
can fit — not a string the client then guesses the geography of.

Ranking is deliberately simple and explainable: the exact name first, then a
name that starts with what was typed, then one where a later word does, then a
looser match. Within a rank the closer spelling wins — "East Legon" before
"East Legon Hills" while "east leg" is typed — and places spelled about as
closely go to the more important one: a city before a village of the same
name. The trigram index answers the substring and the misspelling ("Adentan",
"Dzorwolu") from one GIN index.
"""

from __future__ import annotations

import re

from django.contrib.postgres.search import TrigramSimilarity
from django.db.models import Case, FloatField, IntegerField, Q, QuerySet, Value, When
from django.db.models.functions import Cast, Round

from .models import Place

_PUNCTUATION = re.compile(r"[^\w\s'-]", re.UNICODE)
_SPACES = re.compile(r"\s+")

#: Suggestions a location field can usefully show at once.
MAX_RESULTS = 12


def normalise(text: str) -> str:
    """Lowercase, punctuation-light and single-spaced: the form stored for search."""
    return _SPACES.sub(" ", _PUNCTUATION.sub(" ", text.lower())).strip()


def search_text_for(name: str, aliases: list[str]) -> str:
    """Name first, then aliases, each separated so a later alias still starts a word."""
    parts = [normalise(name), *(normalise(alias) for alias in aliases)]
    return " | ".join(dict.fromkeys(part for part in parts if part))[:800]


def search_places(query: str, *, limit: int = 8) -> QuerySet[Place]:
    typed = normalise(query)
    if len(typed) < 2:
        return Place.objects.none()

    return (
        Place.objects.filter(is_active=True)
        # Both lookups are served by the trigram index: `contains` is a LIKE
        # the GIN index accelerates, `trigram_similar` is the `%` operator.
        .filter(Q(search_text__contains=typed) | Q(search_text__trigram_similar=typed))
        .annotate(
            match_rank=Case(
                # The whole name, with or without aliases stored after it.
                When(
                    Q(search_text=typed) | Q(search_text__startswith=f"{typed} | "), then=Value(4)
                ),
                When(search_text__startswith=typed, then=Value(3)),
                # A later word of the name, or an alias after its separator.
                When(search_text__contains=f" {typed}", then=Value(2)),
                When(search_text__contains=typed, then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            ),
            similarity=TrigramSimilarity("search_text", typed),
            # Banded, so "spelled about as closely" can defer to importance.
            closeness=Round(Cast("similarity", FloatField()), 1),
        )
        .order_by("-match_rank", "-closeness", "-importance", "-similarity", "name")[
            : max(1, min(limit, MAX_RESULTS))
        ]
    )
