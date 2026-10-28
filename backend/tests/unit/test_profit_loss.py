"""Complete P&L totals use integer minor units and never mix currencies."""
from apps.organization.finance import build_profit_loss


def test_profit_and_loss_includes_refunds_fees_and_expenses():
    report = build_profit_loss([
        ("GHS", "2026-10", "revenue_minor", 125001),
        ("GHS", "2026-10", "refunds_minor", 10000),
        ("GHS", "2026-10", "expenses_minor", 20000),
        ("GHS", "2026-10", "fees_minor", 1500),
    ])["ledgers"][0]
    assert report["profit_minor"] == 93501
    assert report["monthly"][0]["profit_minor"] == 93501


def test_currencies_and_periods_stay_separate():
    report = build_profit_loss([
        ("GHS", "2026-10", "revenue_minor", 100),
        ("USD", "2026-10", "revenue_minor", 999),
        ("GHS", "2026-09", "expenses_minor", 150),
    ])["ledgers"]
    assert report[0]["currency"] == "GHS"
    assert report[0]["profit_minor"] == -50
    assert report[1]["currency"] == "USD"
    assert report[1]["profit_minor"] == 999
    assert [row["period"] for row in report[0]["monthly"]] == ["2026-10", "2026-09"]


def test_all_history_is_counted_without_recent_window_caps():
    ledger = build_profit_loss([
        ("GHS", f"{year}-01", "revenue_minor", 101) for year in range(1990, 2027)
    ])["ledgers"][0]
    assert ledger["revenue_minor"] == 37 * 101
    assert len(ledger["monthly"]) == 37


def test_empty_ledger_is_zero_not_an_error():
    ledger = build_profit_loss([])["ledgers"][0]
    assert ledger["profit_minor"] == 0
    assert ledger["monthly"] == []
