"""`engines/quantity.py`: a fractional unit count, never money, never a float.

The module docstring in `engines/amortization.py` explains why every interior
computation in a money engine runs in `decimal.Decimal`; this module extends
the same discipline to *quantities* -- the other number a position needs,
which is not money and must never be rounded to the cent. The tests below are
built to kill specific wrong implementations, not just to exercise the happy
path:

* `parse`/`str` round-tripping a tiny crypto amount kills a `float` sneaking
  in anywhere on the path (a float can't represent 0,000000015 exactly).
* the "same type" test kills a design that special-cases share counts and
  crypto amounts differently.
* the huge-quantity test kills the exact defect class CLAUDE.md's Task 1 brief
  calls out by name: a value that silently corrupts, or crashes with
  `decimal.InvalidOperation`, under Python's default 28-significant-digit
  decimal context -- verified against an oracle (`fractions.Fraction`) that
  shares no code path with `quantity.py`'s own arithmetic.
* the per-lot-vs-end-rounding pair kills a `value_cents` that rounds each
  contribution before summing: the "wrong" variant is reimplemented right
  here, deliberately, so the two numbers can be compared directly. The
  companion whole-share test proves why a fixture of integer quantities alone
  could never have caught that regression -- the two implementations agree
  exactly when there is no fractional cent to round.
"""

from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

import pytest

from app.engines import quantity
from app.engines.quantity import Quantity, QuantityError


def _round_half_up_fraction(value: Fraction) -> int:
    """An independent oracle for 'half away from zero', built from
    `fractions.Fraction` alone -- no `decimal` module involved anywhere in
    this function, so it cannot share a bug with the code under test.
    Works entirely in magnitude space so the sign never complicates the
    tie-break: `abs()` on a `Fraction` always leaves a non-negative
    numerator over a positive denominator, so `divmod` floors correctly.
    """
    sign = 1 if value >= 0 else -1
    magnitude = abs(value)
    floor, remainder = divmod(magnitude.numerator, magnitude.denominator)
    if 2 * remainder >= magnitude.denominator:
        floor += 1
    return sign * floor


class TestParseAndRoundTrip:
    def test_a_tiny_crypto_quantity_round_trips_exactly(self):
        raw = "0.000000015"
        q = quantity.parse(raw)
        assert Decimal(str(q)) == Decimal(raw)
        assert quantity.parse(str(q)) == q

    def test_a_whole_share_count_round_trips(self):
        q = quantity.parse("12")
        assert quantity.parse(str(q)) == q
        assert Decimal(str(q)) == Decimal(12)

    def test_the_same_type_carries_a_share_count_and_a_crypto_amount(self):
        """0,000000015 BTC and 12 actions: literally the plan's own example.
        Kills a design that needs a different type -- or a different scale --
        for one or the other."""
        shares = quantity.parse("12")
        btc = quantity.parse("0.000000015")
        assert type(shares) is type(btc) is Quantity
        assert shares.value == Decimal(12)
        assert btc.value == Decimal("0.000000015")

    def test_exactly_eighteen_decimal_places_is_accepted_and_round_trips(self):
        raw = "1." + "123456789012345678"
        assert len(raw.split(".")[1]) == 18
        q = quantity.parse(raw)
        assert str(q) == raw

    def test_nineteen_decimal_places_is_refused_not_silently_truncated(self):
        raw = "1." + "1234567890123456789"  # 19 digits
        with pytest.raises(QuantityError):
            quantity.parse(raw)

    def test_zero_round_trips(self):
        q = quantity.parse("0")
        assert q.value == 0
        assert quantity.value_cents(q, 12_345) == 0

    def test_a_negative_quantity_round_trips_and_keeps_its_sign(self):
        q = quantity.parse("-0.5")
        assert q.value == Decimal("-0.5")
        assert quantity.parse(str(q)) == q


class TestRejectsInvalidInput:
    def test_a_float_is_refused_by_parse(self):
        with pytest.raises(QuantityError):
            quantity.parse(0.000000015)  # type: ignore[arg-type]

    def test_a_float_is_refused_by_the_constructor(self):
        """The dataclass itself refuses a float, not only the string-parsing
        boundary -- a caller building a Quantity directly from a computed
        float must not slip past `parse`."""
        with pytest.raises(QuantityError):
            Quantity(0.000000015)  # type: ignore[arg-type]

    def test_unparseable_text_is_refused_in_french(self):
        with pytest.raises(QuantityError, match="n'est pas un nombre"):
            quantity.parse("douze")

    def test_empty_text_is_refused(self):
        with pytest.raises(QuantityError):
            quantity.parse("")

    def test_nan_is_refused(self):
        with pytest.raises(QuantityError):
            quantity.parse("NaN")

    def test_infinity_is_refused(self):
        with pytest.raises(QuantityError):
            quantity.parse("Infinity")


class TestHugeQuantity:
    def test_a_quantity_beyond_the_default_context_precision_neither_crashes_nor_corrupts(self):
        """15 integer digits + 18 fractional digits = 33 significant digits --
        beyond Python's default context (prec=28). Confirmed by hand before
        writing this test: quantizing this exact value under
        `decimal.getcontext()` raises `InvalidOperation`, and multiplying it
        under that same default context returns a WRONG, silently-truncated
        product (not an exception) -- the precise defect class the task
        brief warns about ("shipped a balance that compounded to a
        decimal.InvalidOperation crash while its exactness invariant held
        throughout"). `quantity.value_cents` must do neither.
        """
        raw = "123456789012345.123456789012345678"
        q = quantity.parse(raw)
        assert str(q) == raw  # lossless: parsing did not round anything away

        price_cents = 733
        # Independent oracle: exact rational arithmetic, zero shared code
        # with `decimal`.
        exact = Fraction(raw) * price_cents
        expected = _round_half_up_fraction(exact)

        assert quantity.value_cents(q, price_cents) == expected
        assert expected == 90_493_826_346_048_975  # pinned, see module docstring


class TestValueCents:
    def test_rounds_half_up_at_the_exact_half_cent_boundary(self):
        # 0.5 * 1 cent = 0.5 cents exactly -- ties go away from zero.
        assert quantity.value_cents(quantity.parse("0.5"), 1) == 1

    def test_rounds_half_up_symmetrically_for_a_negative_quantity(self):
        """`amortization.cents` documents this symmetry explicitly: rounding
        a negative half toward -inf (instead of away from zero, like the
        positive case) is a silent directional bias. Same rule here."""
        assert quantity.value_cents(quantity.parse("-0.5"), 1) == -1

    def test_rounds_half_up_symmetrically_for_a_negative_price(self):
        # A negative price is unusual but real (WTI crude went negative in
        # April 2020) -- value_cents must still compute, not refuse.
        assert quantity.value_cents(quantity.parse("0.5"), -1) == -1

    def test_zero_price_is_zero_regardless_of_quantity(self):
        assert quantity.value_cents(quantity.parse("999999.999999999999999999"), 0) == 0

    def test_zero_quantity_is_zero_regardless_of_price(self):
        assert quantity.value_cents(quantity.parse("0"), 1_000_000) == 0

    def test_a_whole_number_of_units_needs_no_rounding_at_all(self):
        assert quantity.value_cents(quantity.parse("12"), 15_073) == 12 * 15_073


def _wrong_per_lot_value_cents(lots: list[tuple[Quantity, int]]) -> int:
    """The bug `value_cents`'s docstring warns against, reimplemented here so
    the two numbers can be compared directly: round EACH lot's contribution
    to the cent, THEN sum -- instead of summing the exact quantities first
    and rounding once. Deliberately uses the ambient global `Decimal`
    context, exactly as a naive per-lot loop would in real code; this is not
    a helper `quantity.py` exports, because shipping it would be the bug."""
    total = 0
    for qty, price_cents in lots:
        exact = qty.value * Decimal(price_cents)
        total += int(exact.quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return total


class TestPerLotVersusEndRounding:
    def test_a_large_fractional_holding_drifts_by_real_money_under_per_lot_rounding(self):
        """1 000 lots of 0,005 units at 100 cents (1,00 EUR): each lot's exact
        value is 0,5 cents -- a tie, which ROUND_HALF_UP always rounds UP.
        Rounding every lot before summing therefore overcounts by half a cent
        on every single one of the 1 000 lots. Summing the exact quantities
        first and rounding ONCE removes that bias entirely, because the
        aggregate (5,000 units) times the price is an exact whole number of
        cents with nothing left to round.

        wrong (per-lot):  1 000 x 1 cent  = 1 000 cents = 10,00 EUR
        correct (once):   5,000 x 100     =   500 cents =  5,00 EUR

        A single lot cannot show this: with one lot there is nothing to sum,
        so 'round then sum' and 'sum then round' are the same operation --
        see `test_a_single_whole_lot_cannot_distinguish_the_two_strategies`.
        """
        price_cents = 100
        lots = [(quantity.parse("0.005"), price_cents) for _ in range(1_000)]

        wrong_total = _wrong_per_lot_value_cents(lots)
        total_quantity = sum((q for q, _ in lots), start=quantity.parse("0"))
        correct_total = quantity.value_cents(total_quantity, price_cents)

        assert wrong_total == 1_000
        assert correct_total == 500
        assert wrong_total - correct_total == 500  # 5,00 EUR of pure rounding drift
        assert wrong_total != correct_total

    def test_a_single_whole_lot_cannot_distinguish_the_two_strategies(self):
        """A fixture of ONE lot -- or of only whole-unit lots -- passes
        whether `value_cents` rounds once or per lot, because there is no
        fractional cent anywhere for the two strategies to disagree about.
        This is exactly why the fractional, many-lot fixture above is the
        one that actually exercises the 'rounds once, not per unit'
        contract."""
        price_cents = 333
        lots = [(quantity.parse("1"), price_cents) for _ in range(10)]

        wrong_total = _wrong_per_lot_value_cents(lots)
        total_quantity = sum((q for q, _ in lots), start=quantity.parse("0"))
        correct_total = quantity.value_cents(total_quantity, price_cents)

        assert wrong_total == correct_total == 3_330


class TestTotalValueCents:
    def test_an_empty_list_of_lots_is_worth_nothing(self):
        assert quantity.total_value_cents([]) == 0

    def test_a_single_lot_matches_value_cents(self):
        q = quantity.parse("3.5")
        assert quantity.total_value_cents([(q, 1_000)]) == quantity.value_cents(q, 1_000)

    def test_lots_at_different_unit_costs_are_summed_before_rounding_once(self):
        """The case `value_cents` genuinely cannot cover: two lots of the
        SAME instrument bought at two DIFFERENT unit costs, each with a
        fractional cent of its own -- 0,005 units at 33 cents is 0,165
        cents, and 0,005 units at 67 cents is 0,335 cents. Rounded per lot
        first (0 + 0 = 0 cents, since each is below half a cent) that would
        silently lose both; summed exactly first (0,165 + 0,335 = 0,5
        cents, a tie) and rounded once, ROUND_HALF_UP carries it to 1 cent.
        A per-lot implementation and this one disagree on this exact
        fixture, which is the point of building it rather than asserting a
        single arbitrary total."""
        lots = [(quantity.parse("0.005"), 33), (quantity.parse("0.005"), 67)]
        per_lot_wrong = sum(
            int((q.value * Decimal(p)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            for q, p in lots
        )
        assert per_lot_wrong == 0
        assert quantity.total_value_cents(lots) == 1

    def test_a_huge_lot_does_not_crash_or_corrupt(self):
        """Same trap as `TestHugeQuantity`, reached through the multi-pair
        summation instead of a single multiplication."""
        raw = "123456789012345.123456789012345678"
        q = quantity.parse(raw)
        exact = Fraction(raw) * 733
        expected = _round_half_up_fraction(exact)
        assert quantity.total_value_cents([(q, 733)]) == expected


class TestArithmetic:
    def test_addition_sums_two_quantities_exactly(self):
        assert quantity.parse("0.1") + quantity.parse("0.2") == quantity.parse("0.3")

    def test_subtraction_is_the_inverse_of_addition(self):
        total = quantity.parse("12.5")
        part = quantity.parse("5.25")
        assert total - part == quantity.parse("7.25")

    def test_addition_does_not_crash_on_a_large_aggregate(self):
        """Summing many lots must not hit the default context's precision
        ceiling either -- the same trap as `TestHugeQuantity`, but reached
        through repeated addition instead of a single huge literal."""
        running = quantity.parse("0")
        for _ in range(1_000):
            running = running + quantity.parse("123456789012.123456789012345678")
        assert running == quantity.parse("123456789012123.456789012345678000")
