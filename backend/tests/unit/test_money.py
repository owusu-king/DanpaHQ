"""Money is the highest-consequence primitive in the system, so it gets the
most adversarial tests: rounding, splitting, sign handling and currency mixing.
"""

import pytest

from apps.core.money import CurrencyMismatch, Money, MoneyError


class TestConstruction:
    def test_from_major_string(self):
        assert Money.from_major("1500.00").minor == 150_000

    def test_from_major_rounds_half_up(self):
        assert Money.from_major("0.005").minor == 1
        assert Money.from_major("0.004").minor == 0

    def test_rejects_float_minor_units(self):
        with pytest.raises(MoneyError):
            Money(150.5)

    def test_rejects_bool_minor_units(self):
        with pytest.raises(MoneyError):
            Money(True)

    def test_major_round_trips(self):
        assert str(Money.from_major("2400.50").major) == "2400.50"


class TestArithmetic:
    def test_addition(self):
        assert (Money(1000) + Money(500)).minor == 1500

    def test_subtraction_can_go_negative(self):
        assert (Money(500) - Money(1000)).minor == -500

    def test_currency_mismatch_is_loud(self):
        with pytest.raises(CurrencyMismatch):
            Money(100, "GHS") + Money(100, "USD")

    def test_multiplication_by_fraction_is_refused(self):
        # Splitting is allocate()'s job; float multiplication loses pesewas.
        with pytest.raises(MoneyError):
            Money(1000) * 0.5


class TestAllocate:
    def test_conserves_every_pesewa(self):
        parts = Money(1000).allocate([1, 1, 1])
        assert sum(p.minor for p in parts) == 1000
        assert [p.minor for p in parts] == [334, 333, 333]

    def test_weighted_split(self):
        parts = Money(100_000).allocate([70, 30])
        assert [p.minor for p in parts] == [70_000, 30_000]

    def test_negative_amount_conserves(self):
        parts = Money(-1000).allocate([1, 1, 1])
        assert sum(p.minor for p in parts) == -1000

    def test_rejects_empty_ratios(self):
        with pytest.raises(MoneyError):
            Money(100).allocate([])

    def test_rejects_zero_total(self):
        with pytest.raises(MoneyError):
            Money(100).allocate([0, 0])


class TestFormatting:
    def test_formats_with_cedi_symbol_and_grouping(self):
        assert Money.from_major("12345.60").format() == "GH\u20b512,345.60"

    def test_negative_sign_precedes_symbol(self):
        assert Money(-5000).format().startswith("-GH")

    def test_bare_format_for_inputs(self):
        assert Money(5000).format(symbol=False, group=False) == "50.00"
