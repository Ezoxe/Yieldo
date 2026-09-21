"""Synthetic prices: a market that is always open, always the same, and
obviously not real.

The bac à sable's own data source. It exists because the two obvious
alternatives both fail the thing a sandbox is for:

* **Real prices** need a provider quota, a network, and a market that is open.
  A household cannot watch its pipeline think at 22 h on a Sunday, which is
  exactly when someone sits down to look at it.
* **Recorded prices** replay one past, and a strategy tuned against one
  recording learns that recording.

So this module generates a price series from nothing but a symbol and an
index. Two properties make it useful rather than merely fake:

**Deterministic.** The same symbol at the same index is the same price,
forever, on any machine and any Python version. Change a threshold in the
mandate, run the sandbox again, and the difference you see is the threshold --
not a different market. That is why the noise comes from SHA-256 rather than
`random`: a seeded Mersenne Twister is stable in practice but is not a
specified format, and this series is compared across runs months apart.

**No float, no trigonometry.** Prices are integer cents throughout, moved by
integer triangle waves and integer hash noise. A synthetic price computed
through `math.sin` would be a monetary value derived from a float, which
CLAUDE.md forbids at every layer -- and would also drift between platforms.

**It is never mistaken for real.** Only a venue whose `price_source` is
`synthetic` reaches this module, that venue is `internal`, and `internal` can
only ever be `paper`. There is no path from here to a live order book.
"""

import hashlib
from decimal import ROUND_HALF_UP, Context, Decimal

_CONTEXT = Context(prec=60, rounding=ROUND_HALF_UP)

BPS_WHOLE = 10_000

# Three superposed cycles, as (period in steps, amplitude in bps): a slow one
# that gives a stretch its shape, a medium one that gives a session its swings,
# and a fast one that keeps two consecutive closes from ever being equal. All
# three periods are prime, so the sum does not repeat until their product.
#
# **The periods are short on purpose, and the reason is a measured defect.**
# They were 541/97/17 at first, which produced a market so gentle that the
# default indicator windows (10 and 30 closes) never saw a trend worth the
# name: over thirty steps of a 541-step triangle the price moves about a
# hundred basis points, the two moving averages sit on top of each other, and
# a hundred and fifty cycles of the sandbox produced a hundred and fifty
# « ne rien faire » and not one order. A sandbox that never trades cannot
# teach anything, and cannot serve as the baseline `decision/replay.py` exists
# to provide. At 89/29/7 a thirty-close window spans real structure, so the
# indicators cross, the thresholds bite, and both the orders AND the refusals
# actually happen.
_CYCLES = ((89, 900), (29, 350), (7, 120))

# How far the hash noise may move a close, in bps. Small against the cycles:
# noise is what stops an indicator from being trivially predictable, not what
# drives the series.
_NOISE_BPS = 45


def _triangle_bps(index: int, period: int, amplitude_bps: int) -> int:
    """An integer triangle wave: rises from -amplitude to +amplitude over half
    a period, falls back over the other half. Whole numbers only."""
    phase = index % period
    half = period // 2
    if phase < half:
        # -amplitude .. +amplitude
        position = phase
        span = half
    else:
        position = period - phase
        span = period - half
    return (2 * amplitude_bps * position) // max(span, 1) - amplitude_bps


def _hash_int(*parts: object) -> int:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _noise_bps(symbol: str, index: int) -> int:
    """Deterministic noise in [-_NOISE_BPS, +_NOISE_BPS]."""
    return _hash_int(symbol, index, "noise") % (2 * _NOISE_BPS + 1) - _NOISE_BPS


def base_price_cents(symbol: str) -> int:
    """What this instrument is worth around, derived from its own name.

    Spread over four orders of magnitude so a sandbox holding BTC-EUR and an
    ETF at once exercises `engines/quantity`'s fractional path and the whole-
    unit path in the same run -- a rounding defect that only shows on a 40 000 €
    instrument is one a sandbox of 100 € instruments would never surface.
    """
    magnitude = _hash_int(symbol, "magnitude") % 4
    mantissa = 100 + _hash_int(symbol, "mantissa") % 900  # 100..999
    return mantissa * (10 ** magnitude)


def close_cents(symbol: str, index: int, *, base_cents: int | None = None) -> int:
    """One close, at one index. O(1), and the same answer every time."""
    base = base_price_cents(symbol) if base_cents is None else base_cents
    offset_bps = sum(
        _triangle_bps(index + _hash_int(symbol, period) % period, period, amplitude)
        for period, amplitude in _CYCLES
    )
    offset_bps += _noise_bps(symbol, index)
    moved = _CONTEXT.divide(
        _CONTEXT.multiply(Decimal(base), Decimal(BPS_WHOLE + offset_bps)),
        Decimal(BPS_WHOLE),
    )
    # A synthetic price is still a price: it never reaches zero, because every
    # engine downstream refuses one and a sandbox that produced them would be
    # testing the refusal rather than the strategy.
    return max(1, int(_CONTEXT.quantize(moved, Decimal(1))))


def closes(symbol: str, *, end_index: int, count: int) -> tuple[int, ...]:
    """`count` consecutive closes ending at `end_index`, oldest first.

    `end_index` is the caller's own step counter -- how many cycles the sandbox
    has run. Advancing it advances the market; leaving it still leaves the
    market still, which is what makes a decision reproducible while a household
    reads its detail panel.
    """
    if count <= 0:
        raise ValueError("Le nombre de cours demandés doit être positif.")
    start = max(end_index - count + 1, 0)
    base = base_price_cents(symbol)
    return tuple(
        close_cents(symbol, index, base_cents=base)
        for index in range(start, start + count)
    )


def quote_cents(symbol: str, index: int, *, spread_bps: int = 8) -> tuple[int, int]:
    """(bid, ask) around the close at `index`.

    A synthetic book still has a spread, because execution without one flatters
    every strategy that ever runs in it -- the argument `engines/paper_book`
    makes about slippage, applied one level earlier.
    """
    mid = close_cents(symbol, index)
    half = _CONTEXT.divide(
        _CONTEXT.multiply(Decimal(mid), Decimal(spread_bps)), Decimal(2 * BPS_WHOLE)
    )
    offset = max(1, int(_CONTEXT.quantize(half, Decimal(1))))
    return max(1, mid - offset), mid + offset
