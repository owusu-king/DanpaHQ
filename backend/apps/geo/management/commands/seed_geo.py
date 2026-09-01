"""Seed Ghana's administrative geography.

Idempotent: safe to run on every deploy. Reference data belongs in code rather
than a one-off SQL script so that a new engineer's first run produces the
same database as production, and so changes to it are reviewed like code.

Ghana reorganised into 16 regions in 2019. Districts here are a starter set for
the launch corridors (Greater Accra, Ashanti); operations extend the table
through the admin as coverage grows.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.geo.models import District, Locality, Region

REGIONS = [
    ("Greater Accra", "GA", "Accra"),
    ("Ashanti", "AS", "Kumasi"),
    ("Western", "WR", "Sekondi-Takoradi"),
    ("Western North", "WN", "Sefwi Wiawso"),
    ("Central", "CR", "Cape Coast"),
    ("Eastern", "ER", "Koforidua"),
    ("Volta", "VR", "Ho"),
    ("Oti", "OR", "Dambai"),
    ("Northern", "NR", "Tamale"),
    ("Savannah", "SR", "Damongo"),
    ("North East", "NE", "Nalerigu"),
    ("Upper East", "UE", "Bolgatanga"),
    ("Upper West", "UW", "Wa"),
    ("Bono", "BO", "Sunyani"),
    ("Bono East", "BE", "Techiman"),
    ("Ahafo", "AF", "Goaso"),
]

# (region, district, [(locality, [aliases])])
DISTRICTS = [
    (
        "Greater Accra",
        "Accra Metropolitan",
        [
            ("Osu", ["Oxford Street"]),
            ("Labone", []),
            ("Cantonments", []),
            ("Airport Residential Area", ["Airport Res"]),
            ("Dansoman", []),
            ("Nima", ["Kanda"]),
            ("Adabraka", []),
        ],
    ),
    (
        "Greater Accra",
        "Ayawaso West",
        [
            ("East Legon", ["American House"]),
            ("Dzorwulu", []),
            ("Roman Ridge", []),
        ],
    ),
    ("Greater Accra", "Ledzokuku", [("Teshie", []), ("Nungua", [])]),
    (
        "Greater Accra",
        "Tema Metropolitan",
        [
            ("Community 25", ["Comm 25"]),
            ("Sakumono", ["Spintex"]),
        ],
    ),
    ("Greater Accra", "Adentan Municipal", [("Adenta", ["Adentan"]), ("Ashaley Botwe", [])]),
    ("Greater Accra", "Ga East", [("Haatso", []), ("Madina", []), ("Dome", [])]),
    (
        "Ashanti",
        "Kumasi Metropolitan",
        [
            ("Ahodwo", []),
            ("Nhyiaeso", []),
            ("Asokwa", []),
            ("Bantama", []),
        ],
    ),
    ("Ashanti", "Oforikrom", [("Ayeduase", ["KNUST"]), ("Bomso", [])]),
]


class Command(BaseCommand):
    help = "Seed Ghanaian regions, districts and starter localities."

    @transaction.atomic
    def handle(self, *args, **options):
        created_regions = 0
        for name, code, capital in REGIONS:
            _, created = Region.objects.update_or_create(
                code=code, defaults={"name": name, "capital": capital}
            )
            created_regions += int(created)

        created_districts = created_localities = 0
        for region_name, district_name, localities in DISTRICTS:
            region = Region.objects.get(name=region_name)
            district, created = District.objects.get_or_create(region=region, name=district_name)
            created_districts += int(created)

            for locality_name, aliases in localities:
                _, created = Locality.objects.update_or_create(
                    district=district,
                    name=locality_name,
                    defaults={"aliases": aliases},
                )
                created_localities += int(created)

        self.stdout.write(
            self.style.SUCCESS(
                f"Geography seeded. New: {created_regions} regions, "
                f"{created_districts} districts, {created_localities} localities. "
                f"Totals: {Region.objects.count()}/{District.objects.count()}/"
                f"{Locality.objects.count()}."
            )
        )
