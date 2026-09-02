from datetime import date

import pytest

from app.engines import quantity
from app.engines.portfolio import LotHolding
from app.engines.tax_fr import (
    ASSURANCE_VIE_ABATEMENT_COUPLE_CENTS,
    ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS,
    PFU_INCOME_TAX_BPS,
    PFU_TOTAL_BPS,
    SOCIAL_LEVIES_BPS,
    compare_regimes,
    compute_assurance_vie_gain,
    compute_bareme,
    compute_capital_gain,
    compute_pea_gain,
    compute_pfu,
)


def _lot(qty: str, unit_cost_cents: int) -> LotHolding:
    return LotHolding(quantity=quantity.parse(qty), unit_cost_cents=unit_cost_cents)


# --- PFU: 12,80 % + 17,20 % = 30,00 %, always, on a positive gain.


def test_pfu_splits_income_tax_and_social_levies_at_their_published_rates():
    result = compute_pfu(1_000_000)  # 10 000,00 EUR
    assert result.regime == "pfu"
    assert result.income_tax_cents == 128_000  # 12,80 %
    assert result.social_levies_cents == 172_000  # 17,20 %
    assert result.total_tax_cents == 300_000  # 30,00 %, PFU_TOTAL_BPS
    assert result.net_gain_cents == 700_000
    assert PFU_TOTAL_BPS == PFU_INCOME_TAX_BPS + SOCIAL_LEVIES_BPS == 3_000


def test_pfu_on_a_loss_taxes_nothing_and_reports_the_loss_unclamped():
    """A moins-value is never taxed -- but it is not floored to zero either.
    `net_gain_cents` must still read -500 000, never 0: clamping the LOSS
    itself (rather than just the tax on it) would hide exactly how bad the
    disposal was, which is the montecarlo-class defect this module's
    docstring explicitly distinguishes itself from."""
    result = compute_pfu(-500_000)
    assert result.income_tax_cents == 0
    assert result.social_levies_cents == 0
    assert result.total_tax_cents == 0
    assert result.net_gain_cents == -500_000


def test_pfu_on_a_gain_of_exactly_zero_taxes_nothing():
    result = compute_pfu(0)
    assert result.total_tax_cents == 0
    assert result.net_gain_cents == 0


# --- Barème: the elective alternative, marginal rate on income tax, social
# --- levies untouched by the election.


def test_bareme_taxes_income_at_the_households_own_bracket():
    result = compute_bareme(1_000_000, marginal_rate_bps=3_000)  # 30 %
    assert result.regime == "bareme"
    assert result.income_tax_cents == 300_000
    assert result.social_levies_cents == 172_000  # unchanged by the election
    assert result.total_tax_cents == 472_000
    assert result.net_gain_cents == 528_000


def test_bareme_at_a_zero_bracket_still_owes_social_levies():
    """A wrong implementation that ties the WHOLE tax to the marginal rate
    (rather than only its income-tax component) would answer zero here --
    the social levies are due regardless of the household's bracket."""
    result = compute_bareme(1_000_000, marginal_rate_bps=0)
    assert result.income_tax_cents == 0
    assert result.social_levies_cents == 172_000
    assert result.total_tax_cents == 172_000


def test_bareme_refuses_a_rate_outside_zero_to_a_hundred_percent():
    with pytest.raises(ValueError, match="taux marginal"):
        compute_bareme(1_000_000, marginal_rate_bps=10_001)
    with pytest.raises(ValueError, match="taux marginal"):
        compute_bareme(1_000_000, marginal_rate_bps=-1)


# --- Comparing the two, on the identical gain.


def test_compare_regimes_names_pfu_as_cheaper_above_its_own_rate():
    comparison = compare_regimes(1_000_000, marginal_rate_bps=1_500)  # 15 % > 12,80 %
    assert comparison.pfu.total_tax_cents == 300_000
    assert comparison.bareme.total_tax_cents == 322_000
    assert comparison.cheaper == "pfu"


def test_compare_regimes_names_bareme_as_cheaper_below_its_own_rate():
    comparison = compare_regimes(1_000_000, marginal_rate_bps=500)  # 5 % < 12,80 %
    assert comparison.bareme.total_tax_cents == 222_000
    assert comparison.cheaper == "bareme"


def test_compare_regimes_breaks_an_exact_tie_toward_pfu():
    """At the household's marginal rate exactly equal to the PFU's own
    12,80 %, the two totals tie -- and the regime requiring no election at
    all wins the tie, per the module's own documented rule. A `<=` versus
    `<` slip in the comparison would silently flip this."""
    comparison = compare_regimes(1_000_000, marginal_rate_bps=PFU_INCOME_TAX_BPS)
    assert comparison.pfu.total_tax_cents == comparison.bareme.total_tax_cents
    assert comparison.cheaper == "pfu"


# --- PEA: exempt from income tax at and after the fifth anniversary of the
# --- ENVELOPE's own opening date, never before.


def test_a_pea_sold_one_day_before_its_fifth_anniversary_is_taxed_as_usual():
    result = compute_pea_gain(1_000_000, opened_on=date(2020, 1, 10), today=date(2025, 1, 9))
    assert result.exempt is False
    assert result.years_held == 4
    assert result.regime == "pfu"
    assert result.total_tax_cents == 300_000  # ordinary PFU, nothing exempted


def test_a_pea_sold_exactly_on_its_fifth_anniversary_is_exempt():
    """The boundary itself, not a day either side of it: article 157, 5° bis
    CGI exempts from the expiry of the fifth year onward, so the anniversary
    date itself already qualifies."""
    result = compute_pea_gain(1_000_000, opened_on=date(2020, 1, 10), today=date(2025, 1, 10))
    assert result.exempt is True
    assert result.years_held == 5
    assert result.regime == "pea_exempt"
    assert result.income_tax_cents == 0
    assert result.social_levies_cents == 172_000  # social levies survive the exemption
    assert result.net_gain_cents == 828_000


def test_a_pea_opened_on_29_february_reaches_its_anniversary_on_28_february():
    """29 February is the one date `_add_years`' anniversary arithmetic cannot
    express in a non-leap year, and a PEA is the one envelope whose whole tax
    treatment turns on an anniversary. 2020 is a leap year; 2025 is not.

    Two wrong implementations die here, on different assertions:

    * `opened_on.replace(year=...)` with no `except ValueError` raises
      `ValueError: day is out of range for month` on the FIRST call below --
      every PEA opened on a 29 February crashes the tax panel outright.
    * Clamping the missing day FORWARD to 1 March instead of back to 28
      February makes the plan turn five on 1 March 2025, so the second call
      reports `years_held == 4` and bills 300 000 c of PFU on a gain article
      157, 5° bis CGI exempts from income tax -- a day late, for real money.
    """
    opened = date(2020, 2, 29)

    eve = compute_pea_gain(1_000_000, opened_on=opened, today=date(2025, 2, 27))
    assert eve.years_held == 4
    assert eve.exempt is False
    assert eve.regime == "pfu"
    assert eve.total_tax_cents == 300_000

    anniversary = compute_pea_gain(1_000_000, opened_on=opened, today=date(2025, 2, 28))
    assert anniversary.years_held == 5
    assert anniversary.exempt is True
    assert anniversary.regime == "pea_exempt"
    assert anniversary.income_tax_cents == 0
    assert anniversary.social_levies_cents == 172_000  # never exempted
    assert anniversary.net_gain_cents == 828_000


def test_a_pea_opened_on_29_february_keeps_the_real_date_on_a_leap_anniversary():
    """The complement: 2024 IS a leap year, so the fourth anniversary falls on
    the real 29 February and the 28th is still one day short. An
    implementation that clamped to 28 February unconditionally -- rather than
    only when the target year has no 29th -- would grant the anniversary a day
    early here."""
    opened = date(2020, 2, 29)
    assert compute_pea_gain(
        1_000_000, opened_on=opened, today=date(2024, 2, 28)
    ).years_held == 3
    assert compute_pea_gain(
        1_000_000, opened_on=opened, today=date(2024, 2, 29)
    ).years_held == 4


def test_a_pea_before_five_years_can_still_elect_bareme():
    result = compute_pea_gain(
        1_000_000, opened_on=date(2023, 1, 1), today=date(2024, 1, 1), marginal_rate_bps=2_000,
    )
    assert result.exempt is False
    assert result.regime == "bareme"
    assert result.income_tax_cents == 200_000
    assert result.social_levies_cents == 172_000


def test_an_exempt_pea_sold_at_a_loss_still_owes_and_taxes_nothing():
    result = compute_pea_gain(-100_000, opened_on=date(2015, 1, 1), today=date(2025, 1, 1))
    assert result.exempt is True
    assert result.total_tax_cents == 0
    assert result.net_gain_cents == -100_000


def test_pea_refuses_an_opening_date_in_the_future():
    with pytest.raises(ValueError, match="postérieure"):
        compute_pea_gain(1_000_000, opened_on=date(2030, 1, 1), today=date(2026, 1, 1))


# --- Assurance-vie: the eight-year abatement, income-tax base only.


def test_an_assurance_vie_at_seven_years_gets_no_abatement_and_pays_pfu():
    """Self-review's own scenario: seven years, one short of the eighth-year
    threshold -- ordinary PFU applies, in full, to the whole gain."""
    result = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2017, 1, 1), today=date(2024, 1, 1),
        total_premiums_cents=10_000_000, joint_taxation=False,
    )
    assert result.years_held == 7
    assert result.regime == "pfu"
    assert result.abatement_applied_cents == 0
    assert result.income_tax_cents == 128_000
    assert result.social_levies_cents == 172_000
    assert result.total_tax_cents == 300_000


def test_an_assurance_vie_exactly_on_its_eighth_anniversary_gets_the_abatement():
    """The boundary itself: article 125-0 A, I CGI's abatement applies from
    the eighth anniversary onward, so the anniversary date already
    qualifies -- mirrors `test_a_pea_sold_exactly_on_its_fifth_anniversary_
    is_exempt`, the same off-by-one this module could make in either
    direction."""
    result = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2018, 3, 5), today=date(2026, 3, 5),
        total_premiums_cents=10_000_000, joint_taxation=False,
    )
    assert result.years_held == 8
    assert result.regime == "assurance_vie_reduced"
    assert result.abatement_applied_cents == ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS

    one_day_short = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2018, 3, 5), today=date(2026, 3, 4),
        total_premiums_cents=10_000_000, joint_taxation=False,
    )
    assert one_day_short.years_held == 7
    assert one_day_short.regime == "pfu"
    assert one_day_short.abatement_applied_cents == 0


def test_an_assurance_vie_at_nine_years_gets_the_abatement_and_the_reduced_rate():
    """Self-review's other scenario: nine years, past the eighth-year
    threshold. Single filer: 4 600 EUR abated from the income-tax base, and
    the remainder taxed at 7,50 %, not 12,80 %."""
    result = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2017, 1, 1), today=date(2026, 1, 1),
        total_premiums_cents=10_000_000, joint_taxation=False,
    )
    assert result.years_held == 9
    assert result.regime == "assurance_vie_reduced"
    assert result.abatement_applied_cents == ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS
    # (1 000 000 - 460 000) * 7,50 % = 40 500
    assert result.income_tax_cents == 40_500
    assert result.social_levies_cents == 172_000
    assert result.total_tax_cents == 212_500
    assert result.net_gain_cents == 787_500


def test_the_abatement_is_doubled_for_a_couple_under_joint_taxation():
    result = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2017, 1, 1), today=date(2026, 1, 1),
        total_premiums_cents=10_000_000, joint_taxation=True,
    )
    assert result.abatement_applied_cents == ASSURANCE_VIE_ABATEMENT_COUPLE_CENTS
    # (1 000 000 - 920 000) * 7,50 % = 6 000
    assert result.income_tax_cents == 6_000
    assert result.total_tax_cents == 178_000


def test_the_abatement_never_reduces_the_social_levies_base():
    """Article 125-0 A, I CGI's abatement is an INCOME TAX allowance only.
    A wrong implementation that also nets it off the social-levies base
    would answer 92 880 (17,20 % of the post-abatement 540 000) instead of
    the correct 172 000 (17,20 % of the full 1 000 000 gain)."""
    result = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2017, 1, 1), today=date(2026, 1, 1),
        total_premiums_cents=10_000_000, joint_taxation=False,
    )
    assert result.social_levies_cents == 172_000
    assert result.social_levies_cents != 92_880


def test_above_the_premium_threshold_the_reduced_rate_does_not_apply():
    result = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2017, 1, 1), today=date(2026, 1, 1),
        total_premiums_cents=20_000_000, joint_taxation=False,  # over 150 000 EUR
    )
    assert result.regime == "pfu"
    assert result.abatement_applied_cents == ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS  # still eligible
    # (1 000 000 - 460 000) * 12,80 % = 69 120
    assert result.income_tax_cents == 69_120


def test_electing_bareme_on_assurance_vie_keeps_the_age_abatement():
    """Electing barème forfeits the special 7,50 %/12,80 % rate choice, but
    NOT the age-based abatement itself -- the two are independent rules."""
    result = compute_assurance_vie_gain(
        1_000_000, opened_on=date(2017, 1, 1), today=date(2026, 1, 1),
        total_premiums_cents=10_000_000, joint_taxation=False, marginal_rate_bps=2_000,
    )
    assert result.regime == "bareme"
    assert result.abatement_applied_cents == ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS
    # (1 000 000 - 460 000) * 20 % = 108 000
    assert result.income_tax_cents == 108_000


def test_an_assurance_vie_loss_wastes_no_abatement():
    result = compute_assurance_vie_gain(
        -50_000, opened_on=date(2017, 1, 1), today=date(2026, 1, 1),
        total_premiums_cents=10_000_000, joint_taxation=False,
    )
    assert result.abatement_applied_cents == 0
    assert result.total_tax_cents == 0
    assert result.net_gain_cents == -50_000


def test_assurance_vie_refuses_negative_cumulative_premiums():
    with pytest.raises(ValueError, match="primes"):
        compute_assurance_vie_gain(
            1_000_000, opened_on=date(2017, 1, 1), today=date(2026, 1, 1),
            total_premiums_cents=-1, joint_taxation=False,
        )


# --- Per-lot capital gains: the weighted-average cost (PMPA), never FIFO
# --- or LIFO.


def test_a_partial_sale_uses_the_weighted_average_cost_never_fifo_or_lifo():
    """Two lots: 10 units at 100,00 EUR and 10 units at 200,00 EUR -- the
    weighted average is 150,00 EUR/unit. Selling 5 units at 250,00 EUR:

    * PMPA (correct):  cost = 5 * 150,00 = 750,00;  gain = 1 250,00 - 750,00 = 500,00
    * FIFO (wrong):     cost = 5 * 100,00 = 500,00;  gain = 750,00
    * LIFO (also wrong): cost = 5 * 200,00 = 1 000,00; gain = 250,00

    All three land on different figures, so this single fixture kills either
    wrong implementation outright, not merely "a" wrong one."""
    lots = [_lot("10", 10_000), _lot("10", 20_000)]
    result = compute_capital_gain(lots, quantity.parse("5"), sale_price_cents=25_000)
    assert result.weighted_average_unit_cost_cents == 15_000
    assert result.cost_basis_cents == 75_000
    assert result.proceeds_cents == 125_000
    assert result.gain_cents == 50_000
    assert result.gain_cents != 75_000  # would-be FIFO gain
    assert result.gain_cents != 25_000  # would-be LIFO gain


def test_a_lot_sold_below_its_weighted_average_cost_is_a_loss_taxed_at_zero():
    """Self-review's own scenario: tax on a lot sold at a loss. Same two
    lots as above (150,00 EUR/unit average), sold at 100,00 EUR/unit instead
    of 250,00 EUR -- a real capital loss, fed straight into `compute_pfu`."""
    lots = [_lot("10", 10_000), _lot("10", 20_000)]
    sale = compute_capital_gain(lots, quantity.parse("5"), sale_price_cents=10_000)
    assert sale.gain_cents == -25_000
    tax = compute_pfu(sale.gain_cents)
    assert tax.total_tax_cents == 0
    assert tax.net_gain_cents == -25_000


def test_selling_more_than_is_held_is_refused():
    lots = [_lot("10", 10_000)]
    with pytest.raises(ValueError, match="Impossible de céder"):
        compute_capital_gain(lots, quantity.parse("11"), sale_price_cents=10_000)


def test_selling_out_of_no_lots_at_all_is_refused():
    with pytest.raises(ValueError, match="rien à céder"):
        compute_capital_gain([], quantity.parse("1"), sale_price_cents=10_000)


def test_a_non_positive_quantity_sold_is_refused():
    lots = [_lot("10", 10_000)]
    with pytest.raises(ValueError, match="strictement positive"):
        compute_capital_gain(lots, quantity.parse("0"), sale_price_cents=10_000)


def test_a_negative_sale_price_is_refused():
    lots = [_lot("10", 10_000)]
    with pytest.raises(ValueError, match="négatif"):
        compute_capital_gain(lots, quantity.parse("1"), sale_price_cents=-1)
