"""Money value object.

Rules this module exists to enforce:

1. Money is never a ``float``. Every amount is an integer count of minor units
   (pesewas for GHS), so arithmetic is exact and storage is unambiguous.
2. Money carries its currency. Adding GHS to USD raises rather than silently
   producing a wrong number.
3. Splitting money loses nothing. ``allocate`` distributes remainder pesewas
   deterministically so a split rent never fails to reconcile by 1p.

The database mirror of this type is a pair of columns (``*_minor BIGINT`` plus
``*_currency CHAR(3)``) written by ``core.fields.MoneyField``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

__all__ = ["GHS", "Currency", "CurrencyMismatch", "Money", "MoneyError"]


class MoneyError(Exception):
    """Base class for money errors."""


class CurrencyMismatch(MoneyError):
    """Raised when two amounts in different currencies are combined."""


@dataclass(frozen=True, slots=True)
class Currency:
    code: str
    exponent: int  # number of decimal places, e.g. 2 for GHS
    symbol: str

    @property
    def minor_per_major(self) -> int:
        return 10**self.exponent


GHS = Currency(code="GHS", exponent=2, symbol="GH\u20b5")
USD = Currency(code="USD", exponent=2, symbol="$")

REGISTRY: dict[str, Currency] = {c.code: c for c in (GHS, USD)}


def currency(code: str) -> Currency:
    try:
        return REGISTRY[code.upper()]
    except KeyError as exc:  # pragma: no cover - defensive
        raise MoneyError(f"unknown currency {code!r}") from exc


@dataclass(frozen=True, slots=True, order=False)
class Money:
    minor: int
    currency_code: str = GHS.code

    def __post_init__(self) -> None:
        if not isinstance(self.minor, int) or isinstance(self.minor, bool):
            raise MoneyError("minor units must be an int")
        currency(self.currency_code)  # validates

    # --- constructors -------------------------------------------------
    @classmethod
    def from_major(cls, amount: Decimal | str | int, code: str = GHS.code) -> Money:
        cur = currency(code)
        value = Decimal(str(amount))
        scaled = (value * cur.minor_per_major).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return cls(int(scaled), cur.code)

    @classmethod
    def zero(cls, code: str = GHS.code) -> Money:
        return cls(0, code)

    # --- accessors ----------------------------------------------------
    @property
    def currency(self) -> Currency:
        return currency(self.currency_code)

    @property
    def major(self) -> Decimal:
        cur = self.currency
        return (Decimal(self.minor) / cur.minor_per_major).quantize(
            Decimal(1).scaleb(-cur.exponent)
        )

    def is_zero(self) -> bool:
        return self.minor == 0

    # --- arithmetic ---------------------------------------------------
    def _check(self, other: Money) -> None:
        if self.currency_code != other.currency_code:
            raise CurrencyMismatch(f"{self.currency_code} vs {other.currency_code}")

    def __add__(self, other: Money) -> Money:
        self._check(other)
        return Money(self.minor + other.minor, self.currency_code)

    def __sub__(self, other: Money) -> Money:
        self._check(other)
        return Money(self.minor - other.minor, self.currency_code)

    def __neg__(self) -> Money:
        return Money(-self.minor, self.currency_code)

    def __mul__(self, factor: int) -> Money:
        if not isinstance(factor, int) or isinstance(factor, bool):
            raise MoneyError("multiply money by whole units only; use allocate() to split")
        return Money(self.minor * factor, self.currency_code)

    def __lt__(self, other: Money) -> bool:
        self._check(other)
        return self.minor < other.minor

    def __le__(self, other: Money) -> bool:
        self._check(other)
        return self.minor <= other.minor

    def allocate(self, ratios: Iterable[int]) -> list[Money]:
        """Split without losing a pesewa.

        Used for pro-rated first-month rent, commission splits and instalment
        plans. Remainder units are handed out one at a time from the largest
        ratio downwards, so the parts always sum back to the whole.
        """
        weights = list(ratios)
        if not weights or any(w < 0 for w in weights) or sum(weights) == 0:
            raise MoneyError("ratios must be non-negative and sum to more than zero")

        total = sum(weights)
        shares = [self.minor * w // total for w in weights]
        remainder = self.minor - sum(shares)
        order = sorted(range(len(weights)), key=lambda i: weights[i], reverse=True)
        step = 1 if remainder >= 0 else -1
        for i in range(abs(remainder)):
            shares[order[i % len(order)]] += step
        return [Money(s, self.currency_code) for s in shares]

    # --- presentation -------------------------------------------------
    def format(self, *, symbol: bool = True, group: bool = True) -> str:
        cur = self.currency
        sign = "-" if self.minor < 0 else ""
        units, sub = divmod(abs(self.minor), cur.minor_per_major)
        whole = f"{units:,}" if group else str(units)
        text = f"{whole}.{sub:0{cur.exponent}d}"
        return f"{sign}{cur.symbol}{text}" if symbol else f"{sign}{text}"

    def __str__(self) -> str:
        return self.format()

    def __repr__(self) -> str:
        return f"Money({self.minor}, {self.currency_code!r})"
