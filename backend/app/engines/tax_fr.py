"""French capital-gains taxation: PFU, the barème option, the PEA's
holding-period exemption, assurance-vie's eight-year abatement, and the
weighted-average cost that turns a position's lots into ONE taxable gain.

Phase 3 plan Task 12. Pure: no session, no network, no implicit clock --
`today` is a parameter, exactly like every other engine in this codebase.

**Every rate below is a documented constant carrying its legal source, never
a tuned number.** This module is the one place in the codebase where a
constant being WRONG is not a display bug, it is tax advice being wrong --
the highest bar `CLAUDE.md`'s "no fallback value standing in for real data"
rule sets anywhere in this project. Nothing here is measured, and nothing is
guessed: `marginal_rate_bps` (the household's own income-tax bracket, needed
only to price the barème option) is a value ONLY the household's full tax
return determines, so it is always a caller-supplied assumption, exactly
like `savings.DEFAULT_ANNUAL_RETURN_BPS` is -- never computed by this module,
and always named for what it is.

**Every result names the regime it applied** -- `TaxResult.regime`, one of
`REGIMES` -- so a screen can never print a euro figure whose tax treatment
the reader has to infer from context. A PEA gain realised after five years
and one realised after four are both `TaxResult`s; only the `regime` field
(and, on `PeaTaxResult`, `exempt`) says which rule actually produced the
number.

**Per-lot is why `lots` exist as a table at all.** `compute_capital_gain`
below is the one function in this module that reads a `Position`'s lots
individually rather than through an already-summed total, because French law
requires it to: when only PART of a fungible holding is sold, the deductible
cost is the PRIX MOYEN PONDÉRÉ D'ACQUISITION (PMPA) of every lot behind that
position -- article 150-0 D, 3 CGI for securities, article 150 VH bis, II CGI
for crypto-assets -- never a specific lot chosen FIFO, LIFO, or otherwise.
The taxpayer has no such choice under French law, so this module does not
invent one: it always weighs every lot by its own quantity, which a stored
"position total" could not do (it cannot tell "cheap lots" from "expensive
lots" apart once they are summed).

**A loss is never taxed, and is never clamped either.** `gross_gain_cents`
below can be negative (a moins-value) and stays exactly as negative as it
was computed: only the TAX on it floors at zero (a real gain of -0,01 EUR or
less owes no income tax and no social levies -- there is nothing to tax),
never the gain itself. This is a genuine tax-law floor on a computed TAX
amount, the mirror image of, and NOT a repeat of, `engines.montecarlo`'s
prohibition on clamping a RISK FIGURE at zero: that rule exists so a band
does not lie about how bad an outcome could be, and nothing here hides a
loss -- `net_gain_cents` reports the loss in full, and `gross_gain_cents`
is the caller's own figure, untouched.

**Assurance-vie's abatement reduces the INCOME TAX base only.** Article
125-0 A, I CGI states the allowance (4 600 EUR / 9 200 EUR) against the
gain otherwise subject to income tax; prélèvements sociaux remain due on
the FULL gross gain regardless of the abatement or of how many years the
contract has run -- a common point of confusion this module's tests pin
down explicitly (`test_the_abatement_never_reduces_the_social_levies_base`).

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Context, Decimal

from app.engines.amortization import cents
from app.engines.portfolio import LotHolding
from app.engines.quantity import Quantity, total_value_cents, value_cents

# Same headroom and rounding rule as engines.quantity._CONTEXT and
# engines.portfolio._CONTEXT, for the identical reason: a weighted-average
# unit cost is a genuine division that rarely terminates, and must never hit
# the default 28-significant-digit context's silent truncation or crash.
_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)
_BPS = Decimal(10_000)

# --- PFU (Prélèvement Forfaitaire Unique), the default regime since 1
# January 2018 -- article 200 A CGI, introduced by la loi de finances pour
# 2018 (loi n° 2017-1837 du 30 décembre 2017, art. 28).
PFU_INCOME_TAX_BPS = 1_280  # 12,80 % -- article 200 A, 2 CGI.

# 17,20 % -- CSG 9,20 % (article L136-6 du code de la sécurité sociale) +
# CRDS 0,50 % (ordonnance n° 96-50 du 24 janvier 1996) + prélèvement de
# solidarité 7,50 % (article 235 ter CGI), taux global en vigueur depuis le
# 1er janvier 2018 (loi n° 2017-1836 du 30 décembre 2017 de financement de
# la sécurité sociale pour 2018, art. 8). Due on a gain under EVERY regime
# below, PFU or barème alike -- only the income-tax portion differs between
# the two; the social portion never does.
SOCIAL_LEVIES_BPS = 1_720

PFU_TOTAL_BPS = PFU_INCOME_TAX_BPS + SOCIAL_LEVIES_BPS  # 30,00 %.

# --- PEA (plan d'épargne en actions). Article 157, 5° bis CGI exonère
# d'impôt sur le revenu les produits et plus-values d'un PEA à condition
# qu'aucun retrait (ni rachat) n'intervienne avant l'expiration de la
# cinquième année du plan. Prélèvements sociaux restent dus dans tous les
# cas -- l'exonération ne porte que sur l'impôt sur le revenu.
PEA_EXEMPTION_YEARS = 5

# --- Assurance-vie. Article 125-0 A, I CGI.
ASSURANCE_VIE_ABATEMENT_YEARS = 8
ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS = 460_000  # 4 600 EUR, contribuable seul.
ASSURANCE_VIE_ABATEMENT_COUPLE_CENTS = 920_000  # 9 200 EUR, imposition commune.

# Article 125-0 A, I bis-1 CGI (loi n° 2017-1837 du 30 décembre 2017, art.
# 28): au-delà de 8 ans, le taux d'imposition sur le revenu tombe à 7,50 %
# pour la fraction des gains attachée à un encours de primes n'excédant pas
# 150 000 EUR par assuré, tous contrats confondus. Au-delà de ce seuil (ou
# avant 8 ans, hors option barème), c'est le taux du PFU de droit commun
# (12,80 %) qui s'applique -- ce module ne tente pas la répartition au
# prorata d'un encours à cheval sur le seuil : voir le docstring de
# `compute_assurance_vie_gain`.
ASSURANCE_VIE_REDUCED_RATE_BPS = 750
ASSURANCE_VIE_PREMIUM_THRESHOLD_CENTS = 15_000_000  # 150 000 EUR.

REGIMES = ("pfu", "bareme", "pea_exempt", "assurance_vie_reduced")

__all__ = [
    "ASSURANCE_VIE_ABATEMENT_COUPLE_CENTS",
    "ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS",
    "ASSURANCE_VIE_ABATEMENT_YEARS",
    "ASSURANCE_VIE_PREMIUM_THRESHOLD_CENTS",
    "ASSURANCE_VIE_REDUCED_RATE_BPS",
    "PEA_EXEMPTION_YEARS",
    "PFU_INCOME_TAX_BPS",
    "PFU_TOTAL_BPS",
    "REGIMES",
    "SOCIAL_LEVIES_BPS",
    "AssuranceVieTaxResult",
    "CapitalGain",
    "PeaTaxResult",
    "TaxComparison",
    "TaxResult",
    "compare_regimes",
    "compute_assurance_vie_gain",
    "compute_bareme",
    "compute_capital_gain",
    "compute_pea_gain",
    "compute_pfu",
]


@dataclass(frozen=True)
class CapitalGain:
    """The gross gain (or loss) on ONE disposal, from a position's lots.

    `gain_cents` feeds directly into `compute_pfu` / `compute_bareme` /
    `compute_pea_gain` / `compute_assurance_vie_gain`'s own `gain_cents`
    parameter -- this dataclass is deliberately the accounting step, and the
    regime functions below are deliberately the taxation step, kept apart so
    a caller comparing PFU against barème on the SAME disposal computes the
    weighted-average cost exactly once.
    """

    quantity_sold: str  # str(Quantity), the wire form.
    # Informational: the PMPA rounded for display. NOT what `cost_basis_cents`
    # was computed from -- that used the full-precision average, rounded once,
    # at the end, like every other money computation in this codebase.
    weighted_average_unit_cost_cents: int
    cost_basis_cents: int
    proceeds_cents: int
    gain_cents: int  # proceeds - cost_basis_cents; negative is a moins-value.


@dataclass(frozen=True)
class TaxResult:
    regime: str  # one of REGIMES
    gross_gain_cents: int
    income_tax_cents: int
    social_levies_cents: int
    total_tax_cents: int
    net_gain_cents: int  # gross_gain_cents - total_tax_cents


@dataclass(frozen=True)
class PeaTaxResult(TaxResult):
    years_held: int
    exempt: bool  # True iff `regime == "pea_exempt"`, republished for a screen's convenience.


@dataclass(frozen=True)
class AssuranceVieTaxResult(TaxResult):
    years_held: int
    # 0 before the eighth year, or whenever the gain was already non-positive
    # (there is nothing to abate). Always against the INCOME TAX base only --
    # see the module docstring.
    abatement_applied_cents: int


@dataclass(frozen=True)
class TaxComparison:
    """PFU and barème, on the identical gain, side by side -- design's own
    decision-support ethos: facts presented together, never a recommendation
    Yieldo is not licensed to make. `cheaper` names which total tax is
    smaller; a tie is reported as `"pfu"`, the regime that applies with no
    election required at all.
    """

    pfu: TaxResult
    bareme: TaxResult
    cheaper: str  # "pfu" | "bareme"


def _validate_rate_bps(rate_bps: int, label: str) -> None:
    if not 0 <= rate_bps <= 10_000:
        raise ValueError(f"{label} doit être compris entre 0 et 10 000 points de base.")


def _validate_dates(opened_on: date, today: date) -> None:
    if opened_on > today:
        raise ValueError("La date d'ouverture ne peut pas être postérieure à aujourd'hui.")


def _add_years(on: date, years: int) -> date:
    """`on` plus whole `years`, clamped to 28 February when `on` is a 29
    February landing on a non-leap year -- the one date this arithmetic
    cannot express exactly."""
    try:
        return on.replace(year=on.year + years)
    except ValueError:
        return on.replace(month=2, day=28, year=on.year + years)


def _years_held(opened_on: date, today: date) -> int:
    """Whole years elapsed since `opened_on`, by anniversary -- the same
    convention `PEA_EXEMPTION_YEARS` and `ASSURANCE_VIE_ABATEMENT_YEARS` are
    both stated in law against ("avant l'expiration de la cinquième année"):
    a plan opened on 10 March 2020 turns 5 on 10 March 2025, and is exempt
    from that day onward, not from 1 January 2025."""
    years = today.year - opened_on.year
    if _add_years(opened_on, years) > today:
        years -= 1
    return years


def _split_tax(
    gain_cents: int, income_tax_rate_bps: int, taxable_base_cents: int | None = None
) -> tuple[int, int]:
    """`(income_tax_cents, social_levies_cents)`. Social levies are always on
    `gain_cents` itself (the gross gain); income tax is on `taxable_base_cents`
    when given (post-abatement), else on `gain_cents` too. Both are zero when
    their own base is non-positive -- a loss, or a gain fully absorbed by an
    abatement, owes no tax, never a negative one."""
    base = gain_cents if taxable_base_cents is None else taxable_base_cents
    income_tax = 0 if base <= 0 else cents(Decimal(base) * Decimal(income_tax_rate_bps) / _BPS)
    social = (
        0 if gain_cents <= 0
        else cents(Decimal(gain_cents) * Decimal(SOCIAL_LEVIES_BPS) / _BPS)
    )
    return income_tax, social


def compute_pfu(gain_cents: int) -> TaxResult:
    """The default regime: 12,80 % impôt sur le revenu + 17,20 % prélèvements
    sociaux = 30,00 %, applied to `gain_cents` -- see `PFU_TOTAL_BPS`."""
    income_tax, social = _split_tax(gain_cents, PFU_INCOME_TAX_BPS)
    total = income_tax + social
    return TaxResult(
        regime="pfu", gross_gain_cents=gain_cents, income_tax_cents=income_tax,
        social_levies_cents=social, total_tax_cents=total,
        net_gain_cents=gain_cents - total,
    )


def compute_bareme(gain_cents: int, marginal_rate_bps: int) -> TaxResult:
    """The elective alternative to PFU (article 200 A, 2 CGI): the gain is
    taxed at the household's own marginal income-tax bracket instead of the
    flat 12,80 %, and prélèvements sociaux still apply at the SAME 17,20 %
    either way. `marginal_rate_bps` is the household's bracket, an
    assumption this module never measures -- see the module docstring."""
    _validate_rate_bps(marginal_rate_bps, "Le taux marginal d'imposition")
    income_tax, social = _split_tax(gain_cents, marginal_rate_bps)
    total = income_tax + social
    return TaxResult(
        regime="bareme", gross_gain_cents=gain_cents, income_tax_cents=income_tax,
        social_levies_cents=social, total_tax_cents=total,
        net_gain_cents=gain_cents - total,
    )


def compare_regimes(gain_cents: int, marginal_rate_bps: int) -> TaxComparison:
    """PFU and barème on the same gain, so a screen can show both without
    computing the weighted-average cost twice."""
    pfu = compute_pfu(gain_cents)
    bareme = compute_bareme(gain_cents, marginal_rate_bps)
    cheaper = "bareme" if bareme.total_tax_cents < pfu.total_tax_cents else "pfu"
    return TaxComparison(pfu=pfu, bareme=bareme, cheaper=cheaper)


def compute_pea_gain(
    gain_cents: int, opened_on: date, today: date, marginal_rate_bps: int | None = None
) -> PeaTaxResult:
    """A PEA gain: exempt from income tax (never from prélèvements sociaux)
    once the plan has run `PEA_EXEMPTION_YEARS`, counted from the ENVELOPE's
    own `opened_on` -- never from a lot's acquisition date, since a PEA's
    holding period is a property of the plan, not of any one position inside
    it (`models.InvestmentAccount`'s own docstring states the same rule).

    Before that anniversary, a PEA disposal is taxed exactly like any other
    security's: PFU by default, or barème when `marginal_rate_bps` is given.
    """
    _validate_dates(opened_on, today)
    years = _years_held(opened_on, today)
    exempt = years >= PEA_EXEMPTION_YEARS

    if exempt:
        income_tax, social = _split_tax(gain_cents, 0)
        total = income_tax + social
        return PeaTaxResult(
            regime="pea_exempt", gross_gain_cents=gain_cents, income_tax_cents=income_tax,
            social_levies_cents=social, total_tax_cents=total,
            net_gain_cents=gain_cents - total, years_held=years, exempt=True,
        )

    base = compute_bareme(gain_cents, marginal_rate_bps) if marginal_rate_bps is not None \
        else compute_pfu(gain_cents)
    return PeaTaxResult(
        regime=base.regime, gross_gain_cents=base.gross_gain_cents,
        income_tax_cents=base.income_tax_cents, social_levies_cents=base.social_levies_cents,
        total_tax_cents=base.total_tax_cents, net_gain_cents=base.net_gain_cents,
        years_held=years, exempt=False,
    )


def compute_assurance_vie_gain(
    gain_cents: int, opened_on: date, today: date, total_premiums_cents: int,
    joint_taxation: bool, marginal_rate_bps: int | None = None,
) -> AssuranceVieTaxResult:
    """An assurance-vie gain, net of its eight-year abatement.

    **`total_premiums_cents`** is the taxpayer's cumulative premiums paid
    across every assurance-vie contract they hold, per article 125-0 A, I
    bis-1 CGI's 150 000 EUR per-policyholder threshold -- NOT this one
    contract's premiums alone, and not a figure this module can derive from
    a single position's lots, so the caller supplies it.

    **Scope boundary, stated rather than silently approximated**: when
    `total_premiums_cents` straddles the 150 000 EUR threshold, the law
    apportions the reduced 7,50 % rate pro rata between the premiums below
    and above it, based on which premiums funded the gain. This module does
    not attempt that apportionment -- it has no history of individual
    premium payments to apportion against, only the running total -- and
    instead applies the SIMPLER, all-or-nothing rule: the reduced rate
    applies to the whole post-abatement gain when the running total is at or
    under the threshold, and the standard PFU rate applies to the whole gain
    otherwise. `regime` still names exactly which branch ran.
    """
    _validate_dates(opened_on, today)
    if total_premiums_cents < 0:
        raise ValueError("Le montant cumulé des primes versées ne peut pas être négatif.")

    years = _years_held(opened_on, today)
    abatement_eligible = years >= ASSURANCE_VIE_ABATEMENT_YEARS

    if marginal_rate_bps is not None:
        _validate_rate_bps(marginal_rate_bps, "Le taux marginal d'imposition")
        regime = "bareme"
        income_tax_rate_bps = marginal_rate_bps
    elif abatement_eligible and total_premiums_cents <= ASSURANCE_VIE_PREMIUM_THRESHOLD_CENTS:
        regime = "assurance_vie_reduced"
        income_tax_rate_bps = ASSURANCE_VIE_REDUCED_RATE_BPS
    else:
        regime = "pfu"
        income_tax_rate_bps = PFU_INCOME_TAX_BPS

    abatement_cents = 0
    if abatement_eligible and gain_cents > 0:
        abatement_cents = min(
            gain_cents,
            ASSURANCE_VIE_ABATEMENT_COUPLE_CENTS if joint_taxation
            else ASSURANCE_VIE_ABATEMENT_SINGLE_CENTS,
        )
    taxable_after_abatement = gain_cents - abatement_cents

    # Social levies are computed on `gain_cents` (the GROSS gain) inside
    # `_split_tax`, never on `taxable_after_abatement` -- the abatement is an
    # income-tax allowance only. See the module docstring.
    income_tax, social = _split_tax(gain_cents, income_tax_rate_bps, taxable_after_abatement)
    total = income_tax + social
    return AssuranceVieTaxResult(
        regime=regime, gross_gain_cents=gain_cents, income_tax_cents=income_tax,
        social_levies_cents=social, total_tax_cents=total,
        net_gain_cents=gain_cents - total, years_held=years,
        abatement_applied_cents=abatement_cents,
    )


def compute_capital_gain(
    lots: list[LotHolding], quantity_sold: Quantity, sale_price_cents: int
) -> CapitalGain:
    """The gross gain on selling `quantity_sold` units out of `lots`, at the
    weighted-average acquisition cost (PMPA) of every lot -- see the module
    docstring for why this must read every lot rather than a stored total.
    """
    if quantity_sold.value <= 0:
        raise ValueError("La quantité cédée doit être strictement positive.")
    if sale_price_cents < 0:
        raise ValueError("Le prix de cession ne peut pas être négatif.")

    total_quantity = Quantity(Decimal(0))
    for lot in lots:
        total_quantity = total_quantity + lot.quantity
    if total_quantity.value <= 0:
        raise ValueError("Aucune quantité détenue : il n'y a rien à céder.")
    if quantity_sold.value > total_quantity.value:
        raise ValueError(
            f"Impossible de céder {quantity_sold} unités : seules {total_quantity} "
            "sont détenues."
        )

    total_cost_cents = total_value_cents([(lot.quantity, lot.unit_cost_cents) for lot in lots])
    # Full precision, unrounded -- rounded exactly once below, for each of
    # the two figures it feeds, exactly like `engines.quantity.value_cents`.
    weighted_average = _CONTEXT.divide(Decimal(total_cost_cents), total_quantity.value)
    cost_of_sold = cents(_CONTEXT.multiply(weighted_average, quantity_sold.value))
    proceeds = value_cents(quantity_sold, sale_price_cents)

    return CapitalGain(
        quantity_sold=str(quantity_sold),
        weighted_average_unit_cost_cents=cents(weighted_average),
        cost_basis_cents=cost_of_sold,
        proceeds_cents=proceeds,
        gain_cents=proceeds - cost_of_sold,
    )
