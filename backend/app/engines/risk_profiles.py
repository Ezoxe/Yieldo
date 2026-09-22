"""Three ready-made mandates: prudent, équilibré, offensif.

A mandate has fourteen fields, and a household that has never set one does
not know that « Ordres maximum par jour : 0 » refuses every order, or that a
conviction floor of 6 silences a model that never answers above 5. These
profiles are the reading of those fields a person would give -- « je veux
prendre peu de risque » -- turned into figures, scaled to the capital.

**They propose, they never apply.** The screen fills the form with them and
the household presses « Enregistrer le mandat » itself, exactly as the CSV
importer proposes a column mapping and commits nothing. Every figure stays
visible and editable; a profile is a starting point, not a policy.

**No profile can produce a mandate that refuses everything.** The four fields
that silently do so when left at zero -- orders per day, daily loss, position
ceiling, order ceiling -- are set from the capital here, and
`tests/test_risk_profiles.py` pins that they are.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

BPS_WHOLE = 10_000


def _share(cents: int, bps: int) -> int:
    """`bps` of `cents`, rounded half-up to the cent. Never a float."""
    return int((Decimal(cents) * bps / BPS_WHOLE).quantize(Decimal(1), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class RiskProfile:
    name: str
    label: str
    summary: str
    # The capital the screen offers with this profile, when the household has
    # not chosen one.
    cash_cents: int
    # Shares of the capital, in basis points.
    max_position_bps: int
    max_exposure_bps: int
    max_order_bps: int
    min_order_bps: int
    max_daily_loss_bps: int
    cash_buffer_bps: int
    # The thresholds a model's answer must clear.
    minimum_conviction: int
    minimum_probability_bps: int
    max_volatility_bps: int
    full_conviction_share_bps: int
    max_drawdown_bps: int
    max_orders_per_day: int

    def mandate(self, cash_cents: int, symbols: list[str] | None = None) -> dict[str, Any]:
        """The body `PUT /invest/policy` takes, for this capital."""
        return {
            "max_position_cents": _share(cash_cents, self.max_position_bps),
            "max_exposure_cents": _share(cash_cents, self.max_exposure_bps),
            "max_order_notional_cents": _share(cash_cents, self.max_order_bps),
            "min_order_notional_cents": _share(cash_cents, self.min_order_bps),
            "max_daily_loss_cents": _share(cash_cents, self.max_daily_loss_bps),
            "min_cash_buffer_cents": _share(cash_cents, self.cash_buffer_bps),
            "max_drawdown_bps": self.max_drawdown_bps,
            "max_orders_per_day": self.max_orders_per_day,
            "allowed_symbols": list(symbols or ["BTC-EUR", "ETH-EUR", "AAPL"]),
            "allow_short": False,
            "allow_leverage": False,
            "allow_limit_orders": True,
            "minimum_conviction": self.minimum_conviction,
            "minimum_probability_bps": self.minimum_probability_bps,
            "max_volatility_bps": self.max_volatility_bps,
            "full_conviction_share_bps": self.full_conviction_share_bps,
            # A profile never arms real execution. Paper, always.
            "autonomy": "paper",
        }


PROFILES: tuple[RiskProfile, ...] = (
    RiskProfile(
        name="prudent",
        label="Prise de risque faible",
        summary=(
            "Peu d'ordres, petites lignes, et un signal net exigé avant d'agir. La journée "
            "reste souvent calme : c'est le but."
        ),
        cash_cents=1_000_000,
        max_position_bps=1_000,      # 10 % du capital par ligne
        max_exposure_bps=3_000,      # 30 % investi au plus
        max_order_bps=500,           # 5 % par ordre
        min_order_bps=50,            # 0,5 % : sous ce montant l'écart mange le gain
        max_daily_loss_bps=200,      # 2 % de perte, puis plus rien ne s'ouvre
        cash_buffer_bps=1_000,
        minimum_conviction=5,
        minimum_probability_bps=5_500,
        max_volatility_bps=1_000,
        full_conviction_share_bps=6_000,
        max_drawdown_bps=800,
        max_orders_per_day=10,
    ),
    RiskProfile(
        name="equilibre",
        label="Prise de risque moyenne",
        summary=(
            "Le réglage de départ conseillé : le modèle agit sur un signal correct, les "
            "lignes restent lisibles, et la journée produit assez d'ordres pour être jugée."
        ),
        cash_cents=1_000_000,
        max_position_bps=2_500,
        max_exposure_bps=7_000,
        max_order_bps=1_500,
        min_order_bps=50,
        max_daily_loss_bps=500,
        cash_buffer_bps=500,
        minimum_conviction=3,
        minimum_probability_bps=4_000,
        max_volatility_bps=2_000,
        full_conviction_share_bps=8_000,
        max_drawdown_bps=1_500,
        max_orders_per_day=30,
    ),
    RiskProfile(
        name="offensif",
        label="Prise de risque forte",
        summary=(
            "Le modèle agit dès qu'il penche, sur de grosses lignes. À réserver au bac à "
            "sable : une journée peut y perdre plusieurs pour cent."
        ),
        cash_cents=1_000_000,
        max_position_bps=4_000,
        max_exposure_bps=9_500,
        max_order_bps=3_000,
        min_order_bps=50,
        max_daily_loss_bps=1_500,
        cash_buffer_bps=0,
        minimum_conviction=1,
        minimum_probability_bps=2_500,
        max_volatility_bps=4_000,
        full_conviction_share_bps=10_000,
        max_drawdown_bps=3_000,
        max_orders_per_day=60,
    ),
)

_BY_NAME = {profile.name: profile for profile in PROFILES}


def profile_names() -> tuple[str, ...]:
    return tuple(profile.name for profile in PROFILES)


def profile_for(name: str) -> RiskProfile:
    """The profile, or `KeyError` -- an unknown name is a caller's mistake,
    never a silent fallback onto the riskiest one."""
    return _BY_NAME[name]
