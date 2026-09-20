"""The mandate: the one gate every order passes, pure and deterministic.

No order reaches a broker in this application without a `RiskVerdict` from
this module saying it may. `app/trading/service.py` is the only caller, and it
has no branch that skips the call -- which is the whole design. A decision
model, open source or hosted, correct or taken in by a prompt injection buried
in a news headline, can produce any intention it likes; what it cannot do is
produce an order this module refuses.

Pure, and that is a safety property rather than a style preference:

* **Deterministic.** Same mandate, same account state, same intention, same
  verdict -- so `POST /api/invest/oversight/replay/{id}` can re-run a stored
  refusal and prove it was the mandate that refused, not a bug that happened
  to fire once.
* **No clock, no session, no network.** "Today" is `state.orders_today` and
  `state.realised_pnl_today_cents`, counted by the caller at the route
  boundary like every other clock reading in this codebase. A rule that read
  the wall clock could not be replayed a day later.
* **No float, anywhere.** Money is integer cents, rates are basis points,
  quantities are `engines.quantity.Quantity`. A position sized by a float is a
  position sized wrong.

**Every refusal names its rule and its remedy.** `RiskBreach.rule` is a stable
identifier the screen and the oversight API key off; `RiskBreach.message` is
the French sentence shown to the household, built here so the wording of a
given rule can never drift between the screen, the API and the audit trail.
That is `market/client.failure_message`'s discipline applied to a second
boundary, for the same reason it was applied to the first.

**Two families of rule, and they behave differently on purpose.**

* A *permission* rule -- halted, not armed, symbol off the whitelist, a side
  or an order type the mandate never allowed, a short or a leveraged position
  -- REFUSES. There is no smaller version of an order that was never
  authorised.
* A *size* rule -- position ceiling, total exposure, order notional, cash
  buffer -- REDUCES, down to the largest quantity that satisfies every size
  rule at once, and refuses only when that quantity rounds to nothing. A
  household that set a 2 000 € position ceiling and is offered a 3 000 € order
  meant "buy 2 000 € of it", not "buy nothing".

The order of evaluation is fixed and tested: permissions first, because a
refusal on an unauthorised symbol must not be reported as a sizing problem.
"""

from dataclasses import dataclass, replace
from decimal import ROUND_DOWN, ROUND_HALF_UP, Context, Decimal

from app.engines.quantity import SCALE, Quantity, value_cents

_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)
# Sizing DOWN is the only rounding direction a ceiling may take: rounding a
# reduced quantity up would hand back an order the ceiling had just refused.
_FLOOR_CONTEXT = Context(prec=100, rounding=ROUND_DOWN)
_UNIT_QUANTUM = Decimal(1).scaleb(-SCALE)

BPS_WHOLE = 10_000

SIDES = ("buy", "sell")
ORDER_TYPES = ("market", "limit")

# What an order may be doing, from the mandate's point of view. Reported on the
# verdict so the screen can say "réduit" rather than only "autorisé".
VERDICTS = ("allowed", "reduced", "refused")

# Every rule this module can invoke, in evaluation order. Exported because the
# oversight API and the Mandat screen both name rules, and a rule the screen
# cannot name is a refusal a household cannot act on.
RISK_RULES = (
    "halted",
    "not_armed",
    "unknown_side",
    "unknown_order_type",
    "side_not_allowed",
    "order_type_not_allowed",
    "symbol_not_allowed",
    "limit_price_missing",
    "short_not_allowed",
    "leverage_not_allowed",
    "daily_loss_ceiling",
    "drawdown_ceiling",
    "orders_per_day",
    "non_positive_quantity",
    "order_notional_ceiling",
    "position_ceiling",
    "exposure_ceiling",
    "cash_buffer",
    "reduced_to_nothing",
    "below_minimum_notional",
    "sell_exceeds_position",
)


@dataclass(frozen=True)
class Mandate:
    """What the household authorised, in figures rather than in intent.

    Stored per account as `models/trading_policy.TradingPolicy` and handed here
    as a frozen value. Every ceiling is inclusive: a mandate of 200 000 cents
    allows an order of exactly 200 000 cents and refuses 200 001.
    """

    # Per single position, at reference price. 0 forbids opening any position.
    max_position_cents: int
    # Every open position together.
    max_exposure_cents: int
    # One order's notional.
    max_order_notional_cents: int
    # The day's realised loss (a positive number of cents of LOSS) past which
    # nothing more is bought. Selling to reduce risk stays allowed -- see
    # `_daily_loss_breach`.
    max_daily_loss_cents: int
    # Equity below this share of its own peak halts buying. 2 000 means "stop
    # at 20 % off the high-water mark".
    max_drawdown_bps: int
    max_orders_per_day: int
    # Cash that must remain after a buy. A household's trading float is not its
    # emergency fund.
    min_cash_buffer_cents: int
    # The whitelist. EMPTY MEANS NOTHING IS ALLOWED, never "everything": a
    # mandate that has not named an instrument has not authorised one, and the
    # permissive reading of an empty list is how an agent ends up trading an
    # instrument nobody chose. Symbols are compared upper-cased.
    allowed_symbols: tuple[str, ...]
    # The floor under one order, AFTER any reduction. An order shrunk to a few
    # cents by a ceiling is not a smaller version of the order that was
    # intended -- it is a spread paid, an order slot spent and a position too
    # small to matter. Below this it is refused rather than sent, which is why
    # this is checked after sizing and not before. 0 disables the floor.
    min_order_notional_cents: int = 0
    allowed_sides: tuple[str, ...] = SIDES
    allowed_order_types: tuple[str, ...] = ORDER_TYPES
    allow_short: bool = False
    allow_leverage: bool = False


@dataclass(frozen=True)
class AccountState:
    """The account as the caller measured it, this instant, at the route
    boundary. Nothing here is computed by this module."""

    equity_cents: int
    cash_cents: int
    # The highest equity ever recorded for this account. Equal to
    # `equity_cents` for an account that has never drawn down.
    peak_equity_cents: int
    # Every open position, at reference price.
    exposure_cents: int
    # This instrument's own position, at reference price, and its unit count.
    position_cents: int
    position_quantity: Quantity
    # A positive number is a PROFIT; a loss is negative. Named `pnl` rather
    # than `loss` so the sign can never be read the wrong way round.
    realised_pnl_today_cents: int
    orders_today: int
    halted: bool = False
    halted_reason: str | None = None
    # Live execution is armed, and the arming has not expired. A paper run
    # passes True: the arming gate exists to protect real money, and applying
    # it to the simulator would make the sandbox untestable, which is the
    # opposite of safe. `app/api/invest_orders.py` is where that distinction
    # is made, once.
    armed: bool = True


@dataclass(frozen=True)
class OrderIntent:
    """What the pipeline would like to do, before the mandate has seen it."""

    symbol: str
    side: str
    quantity: Quantity
    order_type: str
    reference_price_cents: int
    limit_price_cents: int | None = None


@dataclass(frozen=True)
class RiskBreach:
    rule: str
    message: str  # French, shown verbatim
    # The ceiling and the figure that met it, both in the rule's own unit --
    # cents for money, basis points for a rate, a plain count for orders. The
    # screen prints them beside the sentence; the oversight API returns them so
    # a supervising agent can check the arithmetic itself.
    limit: int | None = None
    observed: int | None = None


@dataclass(frozen=True)
class RiskVerdict:
    decision: str  # one of VERDICTS
    quantity: Quantity  # what may actually be sent -- possibly reduced
    notional_cents: int  # that quantity at the reference price
    breaches: tuple[RiskBreach, ...]

    @property
    def allowed(self) -> bool:
        return self.decision != "refused"

    def canonical(self) -> dict[str, object]:
        """The stable mapping the audit chain hashes, like
        `MarketFeatures.canonical`."""
        return {
            "decision": self.decision,
            "quantity": str(self.quantity),
            "notional_cents": self.notional_cents,
            "breaches": [
                {
                    "rule": breach.rule,
                    "message": breach.message,
                    "limit": breach.limit,
                    "observed": breach.observed,
                }
                for breach in self.breaches
            ],
        }


_NARROW_NBSP = " "


def _euros(cents: int) -> str:
    """An integer number of cents as French money: 123456 -> "1 234,56 €".

    Integer arithmetic, the typographic minus and the narrow no-break space,
    exactly like `engines/allocation._french_hundredths` -- the same sentence
    reaches the same screen, and two spellings of 1 234,56 € in one interface
    is a defect a reader notices before a developer does.
    """
    sign = "−" if cents < 0 else ""
    whole, fraction = divmod(abs(cents), 100)
    grouped = f"{whole:,}".replace(",", _NARROW_NBSP)
    return f"{sign}{grouped},{fraction:02d}{_NARROW_NBSP}€"


def _percent(bps: int) -> str:
    whole, fraction = divmod(abs(bps), 100)
    sign = "−" if bps < 0 else ""
    return f"{sign}{whole},{fraction:02d}{_NARROW_NBSP}%"


def _quantity_for_value(target_cents: int, price_cents: int) -> Quantity:
    """The largest quantity worth no more than `target_cents` at `price_cents`.

    Rounds DOWN, always: this function exists only to shrink an order to fit
    under a ceiling, and a half-up rounding here would hand back a quantity
    worth one cent more than the rule just allowed.
    """
    if target_cents <= 0 or price_cents <= 0:
        return Quantity(Decimal(0))
    exact = _FLOOR_CONTEXT.divide(Decimal(target_cents), Decimal(price_cents))
    return Quantity(_FLOOR_CONTEXT.quantize(exact, _UNIT_QUANTUM))


def _refused(intent: OrderIntent, breach: RiskBreach) -> RiskVerdict:
    return RiskVerdict(
        decision="refused", quantity=Quantity(Decimal(0)), notional_cents=0,
        breaches=(breach,),
    )


def _permission_breach(
    mandate: Mandate, state: AccountState, intent: OrderIntent
) -> RiskBreach | None:
    """The rules that admit no smaller version of themselves, in order."""
    if state.halted:
        reason = state.halted_reason or "aucune raison enregistrée"
        return RiskBreach(
            "halted",
            f"Le pilotage est à l'arrêt ({reason}) : aucun ordre n'est transmis tant qu'il "
            "n'a pas été relancé depuis la Salle de contrôle.",
        )
    if not state.armed:
        return RiskBreach(
            "not_armed",
            "L'exécution réelle n'est pas armée : armez-la dans Investissement → Mandat, "
            "elle se désarme ensuite toute seule.",
        )
    if intent.side not in SIDES:
        return RiskBreach(
            "unknown_side",
            f"Sens d'ordre inconnu : « {intent.side} ». Les sens possibles sont "
            f"{', '.join(SIDES)}.",
        )
    if intent.order_type not in ORDER_TYPES:
        return RiskBreach(
            "unknown_order_type",
            f"Type d'ordre inconnu : « {intent.order_type} ». Les types possibles sont "
            f"{', '.join(ORDER_TYPES)}.",
        )
    if intent.side not in mandate.allowed_sides:
        return RiskBreach(
            "side_not_allowed",
            f"Le mandat n'autorise pas ce sens d'ordre ({intent.side}). Modifiez-le dans "
            "Investissement → Mandat.",
        )
    if intent.order_type not in mandate.allowed_order_types:
        return RiskBreach(
            "order_type_not_allowed",
            f"Le mandat n'autorise pas les ordres « {intent.order_type} ». Modifiez-le dans "
            "Investissement → Mandat.",
        )
    if intent.symbol.upper() not in {symbol.upper() for symbol in mandate.allowed_symbols}:
        return RiskBreach(
            "symbol_not_allowed",
            f"« {intent.symbol} » ne figure pas dans la liste des instruments autorisés par "
            "le mandat. Ajoutez-le dans Investissement → Mandat pour qu'il soit négociable.",
        )
    if intent.order_type == "limit" and intent.limit_price_cents is None:
        return RiskBreach(
            "limit_price_missing",
            "Un ordre à cours limité sans limite n'est pas un ordre à cours limité : "
            "aucune limite n'a été fournie.",
        )
    if intent.reference_price_cents <= 0:
        return RiskBreach(
            "non_positive_quantity",
            f"Aucun cours de référence connu pour « {intent.symbol} » : impossible de "
            "dimensionner un ordre. Vérifiez la connexion au fournisseur de cours.",
        )
    if intent.quantity.value <= 0:
        return RiskBreach(
            "non_positive_quantity",
            "La quantité demandée est nulle ou négative : il n'y a pas d'ordre à passer.",
        )
    # A sale beyond what is held is a short position by another name.
    if (
        intent.side == "sell"
        and not mandate.allow_short
        and intent.quantity.value > state.position_quantity.value
    ):
        return RiskBreach(
            "sell_exceeds_position",
            f"La vente porte sur {intent.quantity} unité(s) alors que "
            f"{state.position_quantity} seulement sont détenues, et le mandat interdit "
            "la vente à découvert.",
        )
    if mandate.allow_leverage is False and intent.side == "buy":
        cost = value_cents(intent.quantity, intent.reference_price_cents)
        if cost > state.cash_cents:
            return RiskBreach(
                "leverage_not_allowed",
                f"L'achat coûterait {_euros(cost)} pour {_euros(state.cash_cents)} "
                "disponibles, et le mandat interdit l'effet de levier.",
                limit=state.cash_cents, observed=cost,
            )
    return None


def _standing_breach(
    mandate: Mandate, state: AccountState, intent: OrderIntent
) -> RiskBreach | None:
    """Conditions that close the account to NEW risk without closing it to
    reducing risk. A sale that shrinks an existing position is never blocked by
    a loss ceiling -- blocking it would trap a household inside exactly the
    position the ceiling was written to limit."""
    reducing = intent.side == "sell" and intent.quantity.value <= state.position_quantity.value
    if reducing:
        return None

    loss_today = -state.realised_pnl_today_cents
    if loss_today >= mandate.max_daily_loss_cents:
        return RiskBreach(
            "daily_loss_ceiling",
            f"La perte du jour atteint {_euros(loss_today)} pour un plafond de "
            f"{_euros(mandate.max_daily_loss_cents)} : plus aucune position n'est ouverte "
            "aujourd'hui. Les ventes qui réduisent le risque restent possibles.",
            limit=mandate.max_daily_loss_cents, observed=loss_today,
        )

    if state.peak_equity_cents > 0:
        fallen = state.peak_equity_cents - state.equity_cents
        drawdown_bps = int(
            _CONTEXT.quantize(
                _CONTEXT.divide(
                    _CONTEXT.multiply(Decimal(fallen), Decimal(BPS_WHOLE)),
                    Decimal(state.peak_equity_cents),
                ),
                Decimal(1),
            )
        )
        if drawdown_bps >= mandate.max_drawdown_bps:
            return RiskBreach(
                "drawdown_ceiling",
                f"Le capital a reculé de {_percent(drawdown_bps)} depuis son plus haut, "
                f"pour un plafond de {_percent(mandate.max_drawdown_bps)} : plus aucune "
                "position n'est ouverte. Les ventes qui réduisent le risque restent "
                "possibles.",
                limit=mandate.max_drawdown_bps, observed=drawdown_bps,
            )

    if state.orders_today >= mandate.max_orders_per_day:
        return RiskBreach(
            "orders_per_day",
            f"{state.orders_today} ordres ont déjà été transmis aujourd'hui, pour un "
            f"plafond de {mandate.max_orders_per_day}.",
            limit=mandate.max_orders_per_day, observed=state.orders_today,
        )
    return None


def _size_ceilings(
    mandate: Mandate, state: AccountState, intent: OrderIntent
) -> list[tuple[str, int, int, str]]:
    """Every size rule as `(rule, ceiling_cents, room_cents, message)`.

    `room_cents` is what this rule leaves for THIS order, which is not the
    ceiling itself: a 2 000 € position ceiling on a position already worth
    1 500 € leaves 500 €.
    """
    if intent.side == "sell":
        # A sale reduces every one of these. The only sale-side limit is
        # "not more than is held", and `_permission_breach` already holds it.
        return []

    notional = value_cents(intent.quantity, intent.reference_price_cents)
    ceilings = [
        (
            "order_notional_ceiling", mandate.max_order_notional_cents,
            mandate.max_order_notional_cents,
            f"L'ordre porterait sur {_euros(notional)}, pour un plafond par ordre de "
            f"{_euros(mandate.max_order_notional_cents)}.",
        ),
        (
            "position_ceiling", mandate.max_position_cents,
            mandate.max_position_cents - state.position_cents,
            f"La position sur « {intent.symbol} » atteindrait "
            f"{_euros(state.position_cents + notional)}, pour un plafond par position de "
            f"{_euros(mandate.max_position_cents)}.",
        ),
        (
            "exposure_ceiling", mandate.max_exposure_cents,
            mandate.max_exposure_cents - state.exposure_cents,
            f"L'exposition totale atteindrait {_euros(state.exposure_cents + notional)}, "
            f"pour un plafond de {_euros(mandate.max_exposure_cents)}.",
        ),
        (
            "cash_buffer", mandate.min_cash_buffer_cents,
            state.cash_cents - mandate.min_cash_buffer_cents,
            f"L'achat laisserait {_euros(state.cash_cents - notional)} en liquidités, "
            f"pour une réserve minimale de {_euros(mandate.min_cash_buffer_cents)}.",
        ),
    ]
    return ceilings


def evaluate_order(
    mandate: Mandate, state: AccountState, intent: OrderIntent
) -> RiskVerdict:
    """The gate. Returns what may be sent, or refuses and says which rule did."""
    breach = _permission_breach(mandate, state, intent)
    if breach is not None:
        return _refused(intent, breach)

    breach = _standing_breach(mandate, state, intent)
    if breach is not None:
        return _refused(intent, breach)

    notional = value_cents(intent.quantity, intent.reference_price_cents)
    quantity = intent.quantity
    breaches: list[RiskBreach] = []

    for rule, ceiling, room, message in _size_ceilings(mandate, state, intent):
        if notional <= room:
            continue
        breaches.append(RiskBreach(rule, message, limit=ceiling, observed=notional))
        candidate = _quantity_for_value(room, intent.reference_price_cents)
        if candidate.value < quantity.value:
            quantity = candidate

    if quantity.value <= 0:
        return RiskVerdict(
            decision="refused", quantity=Quantity(Decimal(0)), notional_cents=0,
            breaches=(
                *breaches,
                RiskBreach(
                    "reduced_to_nothing",
                    "Une fois ramené dans les limites du mandat, l'ordre ne porterait plus "
                    "sur rien : il n'est pas transmis.",
                ),
            ),
        )

    final_notional = value_cents(quantity, intent.reference_price_cents)
    if (
        mandate.min_order_notional_cents > 0
        and final_notional < mandate.min_order_notional_cents
    ):
        return RiskVerdict(
            decision="refused", quantity=Quantity(Decimal(0)), notional_cents=0,
            breaches=(
                *breaches,
                RiskBreach(
                    "below_minimum_notional",
                    f"L'ordre ne porterait que sur {_euros(final_notional)}, sous le "
                    f"montant minimal de {_euros(mandate.min_order_notional_cents)} : il "
                    "n'est pas transmis. Un ordre de quelques centimes paie un écart de "
                    "cotation pour une position qui ne change rien.",
                    limit=mandate.min_order_notional_cents, observed=final_notional,
                ),
            ),
        )

    if quantity.value == intent.quantity.value:
        return RiskVerdict(
            decision="allowed", quantity=quantity,
            notional_cents=value_cents(quantity, intent.reference_price_cents),
            breaches=tuple(breaches),
        )

    return RiskVerdict(
        decision="reduced", quantity=quantity,
        notional_cents=value_cents(quantity, intent.reference_price_cents),
        breaches=tuple(breaches),
    )


def with_quantity(intent: OrderIntent, quantity: Quantity) -> OrderIntent:
    """The intent as the verdict allows it. Used by `trading/service.py` so the
    quantity actually sent is the one this module returned, never the one the
    model asked for."""
    return replace(intent, quantity=quantity)
