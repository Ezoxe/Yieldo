"""`engines/portfolio.py`: valuation from lots, and the totals/weights built
over only what could actually be priced.

Every fixture below is built to kill one specific plausible-but-wrong
implementation, named in its own docstring or comment, per the phase 3
plan's own warning: "a portfolio of one position cannot tell a weighted
return from an arithmetic one, and cannot tell 'valued what it could' from
'valued everything'."
"""

from datetime import UTC, date, datetime

import pytest

from app.engines import quantity
from app.engines.portfolio import (
    LotHolding,
    PositionInput,
    PriceQuote,
    convert_cents,
    value_portfolio,
)

NOW = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
TODAY = date(2026, 9, 2)


def _lot(qty: str, cost: int) -> LotHolding:
    return LotHolding(quantity=quantity.parse(qty), unit_cost_cents=cost)


def _quote(price_cents: int, *, is_stale: bool = False, as_of: date = TODAY) -> PriceQuote:
    return PriceQuote(
        price_cents=price_cents, as_of=as_of, fetched_at=NOW, source="finnhub",
        is_stale=is_stale,
    )


def _position(
    position_id: int = 1, account_id: int = 1, symbol: str = "AAPL", name: str = "Apple Inc.",
    asset_class: str = "equity", currency: str = "EUR", is_fractionable: bool = False,
    lots: list[LotHolding] | None = None, price: PriceQuote | None = None,
    price_unavailable_reason: str | None = None, fx_rate_to_reporting: str | None = None,
    fx_unavailable_reason: str | None = None,
) -> PositionInput:
    return PositionInput(
        position_id=position_id, account_id=account_id, symbol=symbol, name=name,
        asset_class=asset_class, currency=currency, is_fractionable=is_fractionable,
        lots=[] if lots is None else lots, price=price,
        price_unavailable_reason=price_unavailable_reason,
        fx_rate_to_reporting=fx_rate_to_reporting, fx_unavailable_reason=fx_unavailable_reason,
    )


class TestEmptyPortfolio:
    def test_the_operators_own_state_today_reads_as_a_definite_zero_not_none(self):
        """Zero positions is a real, known state -- the total must not read
        as 'unknown', unlike a portfolio that HAS positions none of which
        could be valued (see TestAllMissingIsStillDefiniteButZero)."""
        report = value_portfolio([])
        assert report.total.market_value_cents == 0
        assert report.total.positions_total == 0
        assert report.total.positions_valued == 0
        assert report.total.positions_missing_price == 0
        assert report.total.positions_missing_fx == 0
        assert report.positions == []
        assert report.weight_by_instrument == []
        assert report.weight_by_asset_class == []
        assert report.weight_by_currency == []


class TestSinglePositionValued:
    def test_market_value_and_gain_are_computed_from_the_current_price(self):
        position = _position(
            lots=[_lot("10", 12_000)],  # cost basis: 10 * 120,00 = 1 200,00
            price=_quote(15_000),  # 10 * 150,00 = 1 500,00
        )
        report = value_portfolio([position])
        [pv] = report.positions
        assert pv.cost_basis_cents == 120_000
        assert pv.market_value_cents == 150_000
        assert pv.unrealised_gain_cents == 30_000
        assert pv.market_value_reporting_cents == 150_000
        assert report.total.market_value_cents == 150_000
        assert report.total.positions_valued == 1
        assert report.weight_by_instrument == [
            report.weight_by_instrument[0]
        ]  # exactly one group
        assert report.weight_by_instrument[0].weight == pytest.approx(1.0)


class TestMissingPriceIsNeverCostOrZero:
    def test_a_position_with_no_price_is_valued_at_none(self):
        position = _position(
            lots=[_lot("10", 12_000)], price=None,
            price_unavailable_reason="Aucune clé n'est enregistrée pour Finnhub.",
        )
        report = value_portfolio([position])
        [pv] = report.positions
        assert pv.market_value_cents is None
        assert pv.unrealised_gain_cents is None
        assert pv.market_value_reporting_cents is None
        assert pv.price_unavailable_reason == "Aucune clé n'est enregistrée pour Finnhub."
        # Cost basis is still known -- it needs no price at all.
        assert pv.cost_basis_cents == 120_000

    def test_the_total_excludes_it_rather_than_falling_back_to_its_cost(self):
        """Kills the implementation `value_cents(quantity, price) or
        cost_basis` -- a plausible-looking fallback that would silently
        report 500 EUR of value that was never actually observed. Position B
        has a real, non-zero cost basis (500,00 EUR) specifically so a
        cost-fallback bug and the correct exclusion produce DIFFERENT
        totals; if B had no cost basis at all, both would coincidentally
        total 1 000,00 EUR and this test would pass for the wrong reason."""
        valued = _position(
            position_id=1, symbol="AAPL", lots=[_lot("10", 10_000)], price=_quote(10_000),
        )  # 1 000,00 EUR
        missing = _position(
            position_id=2, symbol="TSLA", lots=[_lot("5", 10_000)], price=None,
            price_unavailable_reason="Le service Finnhub est injoignable pour le moment.",
        )  # cost basis 500,00 EUR, price unknown
        report = value_portfolio([valued, missing])

        assert report.total.market_value_cents == 100_000  # NOT 150_000
        assert report.total.positions_valued == 1
        assert report.total.positions_missing_price == 1
        assert report.total.positions_missing_fx == 0
        assert report.total.positions_total == 2


class TestStalePriceIsARealAnswerNotAMissingOne:
    def test_a_stale_price_still_values_the_position_and_counts_as_valued(self):
        """Kills an implementation that treats `is_stale` as equivalent to
        `price is None` and drops the position from every total -- a stale
        price is a DIFFERENT answer, not an absent one."""
        position = _position(
            lots=[_lot("10", 10_000)], price=_quote(11_000, is_stale=True),
        )
        report = value_portfolio([position])
        [pv] = report.positions
        assert pv.price.is_stale is True
        assert pv.market_value_cents == 110_000
        assert report.total.market_value_cents == 110_000  # NOT 0
        assert report.total.positions_valued == 1
        assert report.total.positions_missing_price == 0

    def test_the_fetched_at_timestamp_travels_with_a_stale_price(self):
        stale_fetch = datetime(2026, 8, 1, 9, 0, tzinfo=UTC)
        position = _position(
            lots=[_lot("1", 100)],
            price=PriceQuote(
                price_cents=150, as_of=date(2026, 8, 1), fetched_at=stale_fetch,
                source="finnhub", is_stale=True,
            ),
        )
        [pv] = value_portfolio([position]).positions
        assert pv.price.fetched_at == stale_fetch
        assert pv.price.is_stale is True


class TestWeightsAreOverWhatCouldBeValued:
    def test_weight_excludes_a_missing_position_from_both_numerator_and_denominator(self):
        """Kills an implementation whose denominator sums EVERY position's
        cost basis as a stand-in for an unknown market value. A has 1 000,00
        EUR of market value, B has 500,00 EUR, C is missing a price but
        carries a real 500,00 EUR cost basis. The correct weight of A is
        1000/1500 = 0.6667; a cost-fallback-in-the-denominator bug would
        report 1000/2000 = 0.5 instead -- the two disagree, which is why C's
        cost basis was chosen to exactly match B's market value rather than
        being zero or arbitrary."""
        a = _position(position_id=1, symbol="A", lots=[_lot("1", 100_000)], price=_quote(100_000))
        b = _position(position_id=2, symbol="B", lots=[_lot("1", 50_000)], price=_quote(50_000))
        c = _position(
            position_id=3, symbol="C", lots=[_lot("1", 50_000)], price=None,
            price_unavailable_reason="Le symbole « C » est inconnu de Finnhub.",
        )
        report = value_portfolio([a, b, c])

        assert report.total.market_value_cents == 150_000
        by_symbol = {g.key: g for g in report.weight_by_instrument}
        assert set(by_symbol) == {"A", "B"}  # C never appears at all
        assert by_symbol["A"].weight == pytest.approx(100_000 / 150_000)
        assert by_symbol["B"].weight == pytest.approx(50_000 / 150_000)

    def test_weight_by_asset_class_groups_across_instruments(self):
        equity1 = _position(
            position_id=1, symbol="AAPL", asset_class="equity",
            lots=[_lot("1", 100_00)], price=_quote(100_00),
        )
        equity2 = _position(
            position_id=2, symbol="MSFT", asset_class="equity",
            lots=[_lot("1", 200_00)], price=_quote(200_00),
        )
        crypto = _position(
            position_id=3, symbol="BTC", asset_class="crypto",
            lots=[_lot("1", 700_00)], price=_quote(700_00),
        )
        report = value_portfolio([equity1, equity2, crypto])
        by_class = {g.key: g for g in report.weight_by_asset_class}
        assert by_class["equity"].value_cents == 300_00
        assert by_class["crypto"].value_cents == 700_00
        assert by_class["equity"].weight == pytest.approx(300_00 / 1_000_00)

    def test_weight_is_zero_not_a_crash_when_nothing_could_be_valued(self):
        position = _position(
            lots=[_lot("1", 100)], price=None, price_unavailable_reason="x",
        )
        report = value_portfolio([position])
        assert report.total.market_value_cents == 0
        assert report.weight_by_instrument == []  # nothing valued, nothing to weigh


class TestZeroQuantityIsDefinitelyZeroNotMissing:
    def test_a_position_with_no_lots_yet_is_valued_at_zero_even_with_no_price(self):
        """Kills an implementation that checks `price is None` BEFORE
        checking whether there is anything to value at all, which would
        wrongly count an empty position among 'missing a price'."""
        position = _position(lots=[], price=None, price_unavailable_reason=None)
        report = value_portfolio([position])
        [pv] = report.positions
        assert pv.market_value_cents == 0
        assert pv.unrealised_gain_cents == 0
        assert pv.market_value_reporting_cents == 0
        assert report.total.positions_valued == 1
        assert report.total.positions_missing_price == 0

    def test_a_position_sold_down_to_nothing_via_a_zero_quantity_lot_is_also_zero(self):
        """Defensive: `LotIn` refuses a zero quantity at the API boundary,
        but the pure engine must not crash or misreport if handed one
        anyway -- the whole point of a fixed, validated `Quantity` type."""
        position = _position(lots=[_lot("0", 5_000)], price=_quote(9_999))
        [pv] = value_portfolio([position]).positions
        assert pv.quantity == quantity.parse("0").__str__()
        assert pv.market_value_cents == 0
        assert pv.cost_basis_cents == 0
        assert pv.unrealised_gain_cents == 0

    def test_it_does_not_appear_as_missing_even_when_a_reason_would_otherwise_be_set(self):
        position = _position(
            lots=[], price=None, price_unavailable_reason="Le quota est épuisé.",
        )
        report = value_portfolio([position])
        assert report.total.positions_missing_price == 0
        assert report.total.positions_valued == 1


class TestAllMissingIsStillDefiniteButZero:
    def test_a_portfolio_with_one_unpriceable_position_reports_zero_and_says_one_is_missing(self):
        """The total itself (0) looks identical to the empty-portfolio case
        above -- which is exactly why it must never be shown without the
        accompanying counts. This test proves the counts are what actually
        distinguishes the two states."""
        position = _position(
            lots=[_lot("1", 100)], price=None, price_unavailable_reason="x",
        )
        report = value_portfolio([position])
        assert report.total.market_value_cents == 0
        assert report.total.positions_total == 1
        assert report.total.positions_missing_price == 1
        assert report.total.positions_valued == 0


class TestCurrencyConversion:
    def test_a_position_already_in_the_reporting_currency_needs_no_rate(self):
        position = _position(
            currency="EUR", lots=[_lot("1", 10_000)], price=_quote(10_000),
            fx_rate_to_reporting=None,
        )
        [pv] = value_portfolio([position], reporting_currency="EUR").positions
        assert pv.market_value_reporting_cents == 10_000
        assert pv.fx_unavailable_reason is None

    def test_a_foreign_currency_position_is_converted_at_the_supplied_rate(self):
        # $1 200.00 at 0.90 EUR per USD = 1 080.00 EUR exactly.
        position = _position(
            currency="USD", lots=[_lot("1", 120_000)], price=_quote(120_000),
            fx_rate_to_reporting="0.90",
        )
        [pv] = value_portfolio([position], reporting_currency="EUR").positions
        assert pv.market_value_cents == 120_000  # native, unconverted
        assert pv.market_value_reporting_cents == 108_000

    def test_two_currencies_blend_into_one_reporting_total(self):
        eur = _position(
            position_id=1, symbol="CTO-EUR", currency="EUR",
            lots=[_lot("1", 100_000)], price=_quote(100_000),
        )
        usd = _position(
            position_id=2, symbol="CTO-USD", currency="USD",
            lots=[_lot("1", 100_000)], price=_quote(100_000), fx_rate_to_reporting="0.5",
        )
        report = value_portfolio([eur, usd], reporting_currency="EUR")
        assert report.total.market_value_cents == 100_000 + 50_000
        by_currency = {g.key: g for g in report.weight_by_currency}
        assert set(by_currency) == {"EUR", "USD"}
        assert by_currency["USD"].value_cents == 50_000

    def test_a_known_price_with_no_fx_rate_is_missing_fx_not_missing_price(self):
        """The FX cause is distinct from the price cause: this position's
        OWN market value (in USD) is fully known, only its conversion into
        the reporting currency is not."""
        position = _position(
            currency="USD", lots=[_lot("1", 50_000)], price=_quote(50_000),
            fx_rate_to_reporting=None,
            fx_unavailable_reason="Aucune clé n'est enregistrée pour Frankfurter.",
        )
        report = value_portfolio([position], reporting_currency="EUR")
        [pv] = report.positions
        assert pv.market_value_cents == 50_000  # native value still known
        assert pv.market_value_reporting_cents is None
        assert pv.fx_unavailable_reason == "Aucune clé n'est enregistrée pour Frankfurter."
        assert report.total.positions_missing_fx == 1
        assert report.total.positions_missing_price == 0
        assert report.total.market_value_cents == 0  # excluded from the reporting total

    def test_convert_cents_is_identity_across_a_matching_currency_even_with_a_garbage_rate(self):
        assert convert_cents(12_345, "EUR", "EUR", "not-a-number") == 12_345
        assert convert_cents(12_345, "EUR", "EUR", None) == 12_345

    def test_convert_cents_returns_none_when_a_conversion_is_needed_but_no_rate_is_given(self):
        assert convert_cents(12_345, "USD", "EUR", None) is None

    def test_convert_cents_rejects_an_unparseable_rate_rather_than_silently_ignoring_it(self):
        with pytest.raises(ValueError):
            convert_cents(12_345, "USD", "EUR", "douze")


class TestCostBasisAcrossLotsRoundsOnce:
    def test_a_positions_cost_basis_sums_differently_priced_lots_via_total_value_cents(self):
        """Same fixture shape as `test_quantity.py`'s per-lot-vs-end-rounding
        pair, exercised through the engine: two fractional lots whose
        individual contributions each round to nothing, but whose exact sum
        is a full cent."""
        position = _position(
            lots=[_lot("0.005", 33), _lot("0.005", 67)], price=_quote(0),
        )
        [pv] = value_portfolio([position]).positions
        assert pv.cost_basis_cents == 1


class TestInvariant:
    def test_valued_plus_missing_price_plus_missing_fx_always_equals_the_total(self):
        positions = [
            _position(position_id=1, symbol="A", lots=[_lot("1", 100)], price=_quote(100)),
            _position(
                position_id=2, symbol="B", lots=[_lot("1", 100)], price=None,
                price_unavailable_reason="x",
            ),
            _position(
                position_id=3, symbol="C", currency="USD", lots=[_lot("1", 100)],
                price=_quote(100), fx_rate_to_reporting=None,
                fx_unavailable_reason="y",
            ),
            _position(position_id=4, symbol="D", lots=[]),
        ]
        report = value_portfolio(positions)
        assert (
            report.total.positions_valued
            + report.total.positions_missing_price
            + report.total.positions_missing_fx
        ) == report.total.positions_total == 4
