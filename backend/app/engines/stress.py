"""Named historical shocks -- 2008, 2020, 2022 -- applied to the household's
CURRENT allocation by asset class.

Phase 3 plan Task 14. Pure: no session, no network, no implicit clock -- this
module reads no calendar at all, since every shock is a fixed historical
episode with its own already-known dates.

**None of this is a forecast.** A stress test answers "what would today's
holdings be worth if a past shock happened again, unchanged", never "what
will happen". `StressResult` and every caller reading this module's output
must say so where the figure appears -- design's decision-support ethos
(Yieldo computes, it does not predict) applies here exactly as it does to
`engines.montecarlo`'s percentile bands, for the identical reason: a figure
that looks like a prediction is treated like one, and this module was never
asked to make one.

**Each `HistoricalShock` states its own period and its own source, per
asset class.** Nothing here is a tuned number -- every percentage is a real,
published index or asset return over a real, dated window, cited in the
constant that carries it. `2008` and `2020` are stated PEAK-TO-TROUGH, the
way each crash is conventionally discussed; `2022` is stated over the
CALENDAR YEAR instead, the way that episode is conventionally discussed (a
sustained bear market rather than a single dated crash) -- a deliberate,
stated difference in framing, not an inconsistency.

**A shock is not always a loss.** `SHOCK_2008`'s bond figure is POSITIVE:
government bonds rallied on the flight to quality while equities collapsed.
Flooring every class at a loss, or refusing to report a gain, would defeat
the one thing a stress test can actually show a household -- which of their
holdings would have cushioned the others.

**A class this module has no real data for is named, never invented.**
`"crypto"` carries no 2008 figure at all -- Bitcoin did not exist yet -- and
`"etf"` and `"other"` carry no figure in ANY shock, because an ETF's true
composition (equity, bond, commodity, a blend) cannot be recovered from the
generic `INSTRUMENT_ASSET_CLASSES` label alone, and guessing one would be
exactly the fabricated figure this project's no-silent-failures rule
forbids. `apply_shock` reports these as `classes_without_data`, excluded
from every total the way `engines.portfolio` excludes a position with no
price -- never folded in at 0 %, which would silently claim they were
untouched, and never left out of the result entirely, which would silently
claim they do not exist.

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Context, Decimal

from app.engines.portfolio import WeightedGroup

_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)
_BPS = Decimal(10_000)


def _cents(value: Decimal) -> int:
    return int(_CONTEXT.quantize(value, Decimal(1)))


@dataclass(frozen=True)
class HistoricalShock:
    key: str  # "2008" | "2020" | "2022"
    label: str  # French, printed verbatim by a screen.
    period: str  # French, e.g. "octobre 2007 - mars 2009".
    source: str  # French, the citation -- printed beside every figure it produced.
    # asset_class -> signed basis points (negative = decline). Covers ONLY
    # the classes real market history offers for this shock -- see the
    # module docstring.
    impact_bps_by_asset_class: dict[str, int]


# --- 2008: the global financial crisis. Peak to trough.
SHOCK_2008 = HistoricalShock(
    key="2008",
    label="Crise financière de 2008",
    period="octobre 2007 - mars 2009",
    source=(
        "MSCI World Net Total Return (actions), Bloomberg US Aggregate Bond Index "
        "(obligations), FTSE Nareit All Equity REITs (immobilier coté) -- sommet "
        "31 octobre 2007, creux 9 mars 2009 pour les actions et l'immobilier ; "
        "rendement total de l'année civile 2008 pour les obligations."
    ),
    impact_bps_by_asset_class={
        "equity": -5_400,  # -54 %
        "bond": 500,  # +5 %, la fuite vers la qualité -- voir le docstring du module.
        "real_estate": -6_800,  # -68 %
        "cash": 0,  # valeur nominale inchangée par définition.
        # Pas de "crypto" : le Bitcoin n'existait pas encore.
    },
)

# --- 2020: the COVID-19 crash. Peak to trough.
SHOCK_2020 = HistoricalShock(
    key="2020",
    label="Krach du COVID-19 (2020)",
    period="février - mars 2020",
    source=(
        "MSCI World Net Total Return (actions), Bloomberg US Aggregate Bond Index "
        "(obligations, creux intra-mensuel de mars 2020), FTSE Nareit All Equity "
        "REITs (immobilier coté), Bitcoin via CoinMarketCap (cryptomonnaies) -- "
        "sommet 19 février 2020, creux 23 mars 2020 (13 mars pour le Bitcoin)."
    ),
    impact_bps_by_asset_class={
        "equity": -3_400,  # -34 %
        "bond": -600,  # -6 %, crise de liquidité passagère ("dash for cash").
        "real_estate": -4_200,  # -42 %
        "crypto": -6_200,  # -62 %, ~10 150 $ le 19 février -> ~3 850 $ le 13 mars.
        "cash": 0,
    },
)

# --- 2022: the rate-hike bear market. Calendar year -- see the module
# --- docstring on why this one shock is framed differently from the two above.
SHOCK_2022 = HistoricalShock(
    key="2022",
    label="Marché baissier de 2022",
    period="année civile 2022",
    source=(
        "MSCI World Net Total Return (actions), Bloomberg US Aggregate Bond Index "
        "(obligations), FTSE Nareit All Equity REITs (immobilier coté), Bitcoin "
        "via CoinMarketCap (cryptomonnaies) -- rendements totaux de l'année "
        "civile 2022."
    ),
    impact_bps_by_asset_class={
        "equity": -1_800,  # -18 %
        "bond": -1_300,  # -13 %, la pire année obligataire de l'ère moderne.
        "real_estate": -2_400,  # -24 %
        "crypto": -6_400,  # -64 %
        "cash": 0,
    },
)

SHOCKS: tuple[HistoricalShock, ...] = (SHOCK_2008, SHOCK_2020, SHOCK_2022)
_SHOCKS_BY_KEY = {shock.key: shock for shock in SHOCKS}

__all__ = [
    "SHOCK_2008",
    "SHOCK_2020",
    "SHOCK_2022",
    "SHOCKS",
    "ClassImpact",
    "HistoricalShock",
    "StressResult",
    "apply_shock",
    "get_shock",
]


def get_shock(key: str) -> HistoricalShock:
    shock = _SHOCKS_BY_KEY.get(key)
    if shock is None:
        known = ", ".join(s.key for s in SHOCKS)
        raise ValueError(f"Scénario de stress inconnu : « {key} ». Scénarios connus : {known}.")
    return shock


@dataclass(frozen=True)
class ClassImpact:
    asset_class: str
    current_value_cents: int
    # Both None together when this shock has no data for `asset_class`.
    impact_bps: int | None
    stressed_value_cents: int | None


@dataclass(frozen=True)
class StressResult:
    # Republished whole -- design §10: a screen must never show a stressed
    # figure without the period and the source that produced it beside it.
    shock: HistoricalShock
    # The ENTIRE current portfolio, every class, known or not -- so a screen
    # can compute "X EUR sur Y EUR n'a pas pu être testé" the same way
    # `engines.portfolio.PortfolioTotal` reports completeness.
    portfolio_value_cents: int
    # The subset with historical data for THIS shock -- what `impact_bps`
    # and `impact_cents` are actually computed over.
    stressable_value_cents: int
    stressed_value_cents: int  # `stressable_value_cents` after the shock.
    impact_cents: int  # stressed_value_cents - stressable_value_cents.
    # Blended across the stressable subset. 0 when nothing was stressable --
    # there is no share of nothing to report, the same convention
    # `engines.allocation.WeightedGroup.weight` and `engines.portfolio`'s own
    # weights use for the identical reason.
    impact_bps: int
    by_class: list[ClassImpact]
    # Asset classes present in the household's allocation this shock has no
    # data for. Non-empty here does NOT mean `impact_bps == 0` is a real
    # measured "no effect" -- see the module docstring.
    classes_without_data: list[str]


def apply_shock(
    current_by_asset_class: list[WeightedGroup], shock: HistoricalShock
) -> StressResult:
    """`current_by_asset_class` is `engines.portfolio.value_portfolio(...)
    .weight_by_asset_class` -- reused directly rather than re-derived, so a
    stress test can never disagree with the valuation panel about what the
    household currently holds."""
    by_class: list[ClassImpact] = []
    missing: list[str] = []
    portfolio_total = 0
    stressable_total = 0
    stressed_total = 0

    for group in current_by_asset_class:
        portfolio_total += group.value_cents
        impact_bps = shock.impact_bps_by_asset_class.get(group.key)
        if impact_bps is None:
            missing.append(group.key)
            by_class.append(ClassImpact(
                asset_class=group.key, current_value_cents=group.value_cents,
                impact_bps=None, stressed_value_cents=None,
            ))
            continue

        stressed_value = _cents(
            Decimal(group.value_cents) * (_BPS + Decimal(impact_bps)) / _BPS
        )
        by_class.append(ClassImpact(
            asset_class=group.key, current_value_cents=group.value_cents,
            impact_bps=impact_bps, stressed_value_cents=stressed_value,
        ))
        stressable_total += group.value_cents
        stressed_total += stressed_value

    impact_cents = stressed_total - stressable_total
    impact_bps_blended = (
        0 if stressable_total == 0
        else _cents(Decimal(impact_cents) * _BPS / Decimal(stressable_total))
    )

    return StressResult(
        shock=shock, portfolio_value_cents=portfolio_total,
        stressable_value_cents=stressable_total, stressed_value_cents=stressed_total,
        impact_cents=impact_cents, impact_bps=impact_bps_blended, by_class=by_class,
        classes_without_data=missing,
    )
