"""Market features: what a decision is allowed to look at, computed here and
nowhere else.

Pure, like every other engine: no session, no network, no implicit clock. A
price series comes in, a frozen `MarketFeatures` goes out. **The decision
model never sees a raw price series** -- it sees this dataclass, and it sees
it because the whole safety argument of `app/trading/` rests on the features
being reproducible: `POST /api/invest/oversight/replay/{id}` re-runs a stored
decision against its stored features and says whether the answer still
matches. A feature computed with a float, a clock or a network call could not
be replayed, so none of them appear here.

**Never a float.** Every figure below is an integer -- cents for a price,
basis points for a rate -- computed through a local high-precision
`decimal.Context`, exactly like `engines/quantity.py` and
`engines/allocation.py` and for the same reasons those two spell out at
length. A momentum of 3,47 % is 347 bps, not 0.0347.

**Refusal, not a fallback.** A series too short for the windows asked of it
raises `ValueError` with a French sentence naming what is missing, in the
idiom `allocation.validate_targets` established. Returning a neutral 5 000 bps
RSI for a series of four closes would be a fabricated feature reaching a
decision that trades real money -- exactly the silent fallback CLAUDE.md
forbids, with the worst possible consequence.

**Cutler's RSI, not Wilder's.** Wilder's smoothing is recursive over the
whole series, so the same fourteen closes give a different RSI depending on
how much history preceded them; Cutler's is a plain mean over the window, so
a window IS its RSI. A feature that cannot be recomputed from the window the
audit trail stored is a feature the oversight endpoint cannot verify, which
is the one thing this module exists to make possible.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Context, Decimal

# Same headroom as engines.quantity._CONTEXT: a squared cent difference over a
# twenty-period window comfortably exceeds the ambient context's 28 significant
# digits, and that context truncates silently rather than raising.
_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)

BPS_WHOLE = 10_000  # 100,00 %, in basis points -- the codebase's rate unit.

# A neutral RSI when nothing moved at all across the window: neither buyers nor
# sellers took ground, which is 50 %, not 0 % and not 100 %. Spelt out because
# it is the one value in this module produced by a DEFINITION rather than a
# computation, and a reader is owed the distinction.
_RSI_FLAT_BPS = BPS_WHOLE // 2


@dataclass(frozen=True)
class PriceSeries:
    """Closing prices in one currency, oldest first, in integer cents.

    `symbol` travels with them because every refusal this module raises names
    the instrument: "il manque de l'historique" without saying for what is a
    sentence a household cannot act on.
    """

    symbol: str
    closes: tuple[int, ...]


@dataclass(frozen=True)
class FeatureWindows:
    """The periods the features are computed over.

    A dataclass rather than six keyword arguments because these travel: they
    are persisted beside the decision they produced, so a replay recomputes
    the features the SAME way even after a household changes its strategy.
    """

    short: int = 10
    long: int = 30
    rsi: int = 14
    momentum: int = 10
    volatility: int = 20

    def minimum_closes(self) -> int:
        """The shortest series every window below can be computed from.

        `+ 1` because the three rate features (RSI, momentum, volatility) are
        computed over period-to-period CHANGES: fourteen changes need fifteen
        closes.
        """
        return max(self.short, self.long, self.rsi + 1, self.momentum + 1, self.volatility + 1)


@dataclass(frozen=True)
class MarketFeatures:
    """Everything a decision is allowed to know about an instrument's price.

    Deliberately flat and deliberately all-integer: this is persisted verbatim
    as the decision's inputs (`TradeDecision.features`), fed back into the
    model on a replay, and shown to the household on the Salle de contrôle
    screen. Any field that could not survive that round trip does not belong.
    """

    symbol: str
    closes_seen: int
    last_price_cents: int
    sma_short_cents: int
    sma_long_cents: int
    # (sma_short - sma_long) / sma_long. Positive means the short average sits
    # above the long one -- the classic "trend is up" reading, stated as a
    # measured gap rather than as a verdict.
    trend_bps: int
    # (last - close `momentum` periods ago) / that close.
    momentum_bps: int
    # Cutler's RSI, in basis points: 7 000 is an RSI of 70.
    rsi_bps: int
    # Population standard deviation of the period-to-period returns.
    volatility_bps: int
    # (window high - last) / window high, over the `long` window. Never negative.
    drawdown_bps: int
    # Where `last` sits between the window's low and high, over the `long`
    # window: 0 is at the low, 10 000 is at the high.
    range_position_bps: int

    def canonical(self) -> dict[str, int | str]:
        """The stable, ordered mapping the audit chain hashes and the replay
        endpoint compares against. Field order is this method's contract: a
        dict built any other way would hash differently for the same figures."""
        return {
            "symbol": self.symbol,
            "closes_seen": self.closes_seen,
            "last_price_cents": self.last_price_cents,
            "sma_short_cents": self.sma_short_cents,
            "sma_long_cents": self.sma_long_cents,
            "trend_bps": self.trend_bps,
            "momentum_bps": self.momentum_bps,
            "rsi_bps": self.rsi_bps,
            "volatility_bps": self.volatility_bps,
            "drawdown_bps": self.drawdown_bps,
            "range_position_bps": self.range_position_bps,
        }


def _round_half_up_int(exact: Decimal) -> int:
    return int(_CONTEXT.quantize(exact, Decimal(1)))


def _ratio_bps(part: Decimal, whole: Decimal) -> int:
    """`part / whole` in basis points. `whole` of zero is the caller's problem
    -- every call site below has already refused a zero denominator, and
    returning 0 here would invent a rate for a price of nothing."""
    return _round_half_up_int(_CONTEXT.divide(_CONTEXT.multiply(part, Decimal(BPS_WHOLE)), whole))


def _mean_cents(values: tuple[int, ...]) -> int:
    total = Decimal(sum(values))
    return _round_half_up_int(_CONTEXT.divide(total, Decimal(len(values))))


def _returns_bps(closes: tuple[int, ...]) -> list[int]:
    """Period-to-period returns, in basis points, over `len(closes) - 1` steps.

    A zero or negative previous close is refused rather than skipped: a price
    of nothing is not a price, and dividing by it silently would put an
    invented return into a feature that decides a trade.
    """
    out: list[int] = []
    for previous, current in zip(closes[:-1], closes[1:], strict=True):
        if previous <= 0:
            raise ValueError(
                "Un cours de zéro ou négatif figure dans l'historique : "
                "impossible d'en calculer une variation."
            )
        out.append(_ratio_bps(Decimal(current - previous), Decimal(previous)))
    return out


def _rsi_bps(closes: tuple[int, ...], period: int) -> int:
    changes = [
        current - previous
        for previous, current in zip(closes[-(period + 1):-1], closes[-period:], strict=True)
    ]
    gains = Decimal(sum(change for change in changes if change > 0))
    losses = Decimal(sum(-change for change in changes if change < 0))
    if gains == 0 and losses == 0:
        return _RSI_FLAT_BPS
    if losses == 0:
        return BPS_WHOLE
    if gains == 0:
        return 0
    # RSI = 100 * gains / (gains + losses) -- algebraically identical to
    # 100 - 100/(1 + gains/losses), and one division instead of two.
    return _ratio_bps(gains, _CONTEXT.add(gains, losses))


def _volatility_bps(returns: list[int]) -> int:
    """Population standard deviation of the returns, themselves already in bps.

    Population rather than sample: the window IS the whole of what is being
    described, not a draw from a larger set. Bessel's correction would widen
    the figure by a factor nobody here can interpret.
    """
    count = Decimal(len(returns))
    mean = _CONTEXT.divide(Decimal(sum(returns)), count)
    squared = Decimal(0)
    for value in returns:
        difference = _CONTEXT.subtract(Decimal(value), mean)
        squared = _CONTEXT.add(squared, _CONTEXT.multiply(difference, difference))
    variance = _CONTEXT.divide(squared, count)
    return _round_half_up_int(variance.sqrt(_CONTEXT))


def compute_features(
    series: PriceSeries, windows: FeatureWindows | None = None
) -> MarketFeatures:
    """The one way features are built, for a live decision and for a replay
    alike. Called with the SAME series and the SAME windows it returns the
    SAME dataclass -- that equality is what the oversight replay tests."""
    windows = windows or FeatureWindows()
    closes = series.closes

    minimum = windows.minimum_closes()
    if len(closes) < minimum:
        raise ValueError(
            f"L'historique de « {series.symbol} » compte {len(closes)} cours : il en faut "
            f"au moins {minimum} pour calculer les indicateurs. Attendez d'avoir relevé "
            "assez de cours, ou raccourcissez les fenêtres dans le mandat."
        )
    if any(close <= 0 for close in closes):
        raise ValueError(
            f"L'historique de « {series.symbol} » contient un cours nul ou négatif : "
            "aucun indicateur n'est calculé sur un prix qui n'en est pas un."
        )

    last = closes[-1]
    sma_short = _mean_cents(closes[-windows.short:])
    sma_long = _mean_cents(closes[-windows.long:])
    long_window = closes[-windows.long:]
    high = max(long_window)
    low = min(long_window)

    momentum_base = closes[-(windows.momentum + 1)]
    returns = _returns_bps(closes[-(windows.volatility + 1):])

    return MarketFeatures(
        symbol=series.symbol,
        closes_seen=len(closes),
        last_price_cents=last,
        sma_short_cents=sma_short,
        sma_long_cents=sma_long,
        trend_bps=_ratio_bps(Decimal(sma_short - sma_long), Decimal(sma_long)),
        momentum_bps=_ratio_bps(Decimal(last - momentum_base), Decimal(momentum_base)),
        rsi_bps=_rsi_bps(closes, windows.rsi),
        volatility_bps=_volatility_bps(returns),
        drawdown_bps=_ratio_bps(Decimal(high - last), Decimal(high)),
        # A flat window (high == low) puts `last` at both ends at once; the
        # midpoint is the only honest reading, and it is stated rather than
        # divided into.
        range_position_bps=(
            _RSI_FLAT_BPS if high == low else _ratio_bps(Decimal(last - low), Decimal(high - low))
        ),
    )
