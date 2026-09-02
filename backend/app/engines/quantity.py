"""Fractional unit counts -- never money, never a float.

A position holds a `Quantity`: 0,000000015 BTC and 12 actions are the same
type, at the same fixed scale, exactly like `amortization.py`'s money
computations run through one `cents()` regardless of whether the figure is a
mensualité or a capital. The reasons are the same reasons, restated for a
different unit:

**Never a float.** A `Quantity` is built from a `Decimal` and, at the wire
boundary, from a *string* (`parse`) -- never from a Python `float`, which
cannot represent 0,000000015 exactly and would silently corrupt it the
instant it entered the type. Both entry points refuse a `float` outright
rather than coercing it.

**A fixed scale, chosen for the deepest precision any instrument here
plausibly needs.** `SCALE = 18` is wei precision -- the decimal depth of an
18-decimal ERC-20 token, deeper than a Bitcoin satoshi (8) and far deeper
than a share count (0). Every `Quantity` is quantised to exactly this many
decimal places; more than that is refused outright rather than silently
rounded away, because silently discarding real precision is exactly the kind
of fallback-standing-in-for-real-data CLAUDE.md's no-silent-failures rule
forbids.

**Every operation below runs inside a LOCAL, high-precision `decimal.Context`
-- never the ambient global one (`decimal.getcontext()`, 28 significant
digits by default).** At `SCALE = 18` fractional digits, the default context
leaves room for barely ten integer digits before arithmetic on a legitimate
value starts to go wrong -- confirmed by hand before this module was written:
multiplying a 33-significant-digit quantity under the default context does
NOT raise, it silently returns a truncated, wrong product, and quantising
that same value under the default context DOES raise
`decimal.InvalidOperation`. That second failure mode is the literal shape of
the defect this project has already paid for once: "Phase 2B's task 1
shipped a balance that compounded to a `decimal.InvalidOperation` crash while
its exactness invariant held throughout." `_CONTEXT` below is sized with
headroom no real instrument approaches, so neither failure mode can recur
here.

**`value_cents` rounds ONCE, at the end, `ROUND_HALF_UP`.** Rounding a
fractional quantity's contribution to the cent and then summing many such
roundings -- once per lot -- overcounts by up to half a cent on every lot;
across a large holding that drift is real money, not a rounding curiosity.
`value_cents` is deliberately the ONLY place in this module that rounds at
all, and it does so exactly once, on the exact product of the full-precision
quantity and the integer price -- see `tests/test_quantity.py` for the fixture
that makes the two strategies disagree by 5,00 EUR on 1 000 lots.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Context, Decimal, InvalidOperation

# Wei precision: the deepest decimal scale any instrument this app prices
# plausibly needs. A share count uses zero of these digits; the type is the
# same for both because the scale is fixed, never inferred per instrument.
SCALE = 18
_QUANTUM = Decimal(1).scaleb(-SCALE)

# prec=100 leaves enormous headroom over SCALE's 18 fractional digits --
# there is room for an 80-digit integer part, absurdly beyond any real
# holding or price, specifically so arithmetic on a legitimate large value
# never approaches the ceiling that broke phase 2B's task 1. Fixed at
# ROUND_HALF_UP so it agrees with `amortization.cents` and `value_cents`
# below on which way a tie falls; every other operation in this module is
# exact (padding zeros or adding two values already at the same scale), so
# the rounding mode never actually applies to them.
_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)


class QuantityError(ValueError):
    """A value could not become a valid `Quantity`."""


@dataclass(frozen=True)
class Quantity:
    """A count of units, exact to `SCALE` decimal places. Never a float.

    Construct from a `Decimal` directly (e.g. `Quantity(Decimal("12"))`) when
    already holding one in code, or from external input via `parse`, the only
    entry point that accepts a string. Both paths converge here, and here is
    where the invariant is enforced: finite, at most `SCALE` decimal places,
    and always normalised to exactly `SCALE` places internally so two
    `Quantity`s built from differently-padded input compare equal.
    """

    value: Decimal

    def __post_init__(self) -> None:
        if not isinstance(self.value, Decimal):
            raise QuantityError(
                "Quantité invalide : attendu un Decimal, jamais un float ni un entier "
                "implicite."
            )
        if not self.value.is_finite():
            raise QuantityError("Quantité invalide : la valeur n'est pas un nombre fini.")
        exponent = self.value.as_tuple().exponent
        if exponent < -SCALE:
            raise QuantityError(
                f"Quantité invalide : plus de {SCALE} décimales ne sont pas prises en charge."
            )
        # Pad to exactly SCALE decimal places. Always exact given the guard
        # above (never MORE than SCALE places going in), so this never
        # actually rounds anything away -- it only appends trailing zeros.
        object.__setattr__(self, "value", _CONTEXT.quantize(self.value, _QUANTUM))

    def __str__(self) -> str:
        # 'f' forces plain fixed-point notation unconditionally -- Decimal's
        # default str() can fall back to scientific notation for a very small
        # magnitude, which parse() below does not accept back.
        return format(self.value, "f")

    def __add__(self, other: "Quantity") -> "Quantity":
        if not isinstance(other, Quantity):
            return NotImplemented
        return Quantity(_CONTEXT.add(self.value, other.value))

    def __sub__(self, other: "Quantity") -> "Quantity":
        if not isinstance(other, Quantity):
            return NotImplemented
        return Quantity(_CONTEXT.subtract(self.value, other.value))


def parse(raw: str) -> Quantity:
    """The wire/DB boundary constructor -- the only entry point that accepts
    untyped external input, and the ONLY place a `Quantity` is ever built from
    text. Rejects a `float` outright rather than accepting `str(some_float)`:
    a caller holding a float has already lost the precision this module
    exists to protect, and letting it in here would just hide where.
    """
    if not isinstance(raw, str):
        raise QuantityError(
            "Quantité invalide : une quantité doit être fournie sous forme de texte, "
            "jamais un nombre à virgule flottante."
        )
    text = raw.strip()
    if not text:
        raise QuantityError("Quantité invalide : la valeur est vide.")
    try:
        # The plain constructor, not `_CONTEXT.create_decimal`: it has no
        # precision ceiling on construction from a string, so nothing here
        # can silently truncate a legitimate value before __post_init__ even
        # gets to validate its scale.
        value = Decimal(text)
    except InvalidOperation as exc:
        raise QuantityError(f"Quantité invalide : « {raw} » n'est pas un nombre.") from exc
    return Quantity(value)


def value_cents(quantity: Quantity, price_cents: int) -> int:
    """`quantity * price_cents`, rounded ONCE at the end, half away from zero.

    Never per unit, never per lot -- see the module docstring for why that
    distinction is worth a dedicated fixture in the test suite rather than a
    single assertion.
    """
    exact = _CONTEXT.multiply(quantity.value, Decimal(price_cents))
    return int(_CONTEXT.quantize(exact, Decimal(1)))
