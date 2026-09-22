"""What the model is actually sent.

The context is read by an encoder, not by an engine: what it says in words
changes the answer. Two defects measured on a real simulated day drive these
tests -- the model was sent integers of cents and basis points it read as
plain large numbers, and it was never told that selling with nothing held
does nothing, so it answered « vendre » on 217 decisions out of 234, 158 of
which died on « rien à vendre ».
"""

from app.decision.strategy import BUY, DIRECTION, HOLD, SELL, PositionSnapshot, build_context
from app.engines.quantity import parse as parse_quantity
from app.engines.signals import MarketFeatures

FEATURES = MarketFeatures(
    symbol="BTC-EUR", closes_seen=120, last_price_cents=3_086,
    sma_short_cents=3_246, sma_long_cents=3_364, trend_bps=-351,
    momentum_bps=-1_000, rsi_bps=1_019, volatility_bps=95, drawdown_bps=721,
    range_position_bps=4_449,
)


def held(quantity: str = "12", price_cents: int = 3_000) -> PositionSnapshot:
    return PositionSnapshot(
        quantity=parse_quantity(quantity), average_price_cents=price_cents,
        market_value_cents=3_086 * 12, unrealised_pnl_bps=286,
    )


def test_every_figure_is_also_written_the_way_a_reader_reads_it():
    context = build_context(FEATURES, None)
    # The integers stay: they are the audited input, and the detail panel
    # prints them. The readable form travels beside them.
    assert context["dernier_cours_centimes"] == 3_086
    assert context["dernier_cours"] == "30,86 €"
    assert context["tendance"] == "-3,51 %"
    assert context["momentum"] == "-10,00 %"
    assert context["rsi"] == "10,19 %"
    assert context["volatilite"] == "0,95 %"
    assert context["repli_depuis_le_plus_haut"] == "7,21 %"
    assert context["position_dans_le_canal"] == "44,49 %"


def test_with_nothing_held_the_context_says_a_sale_is_impossible():
    context = build_context(FEATURES, None)
    assert context["position_detenue"] is None
    assert context["actions_possibles"] == ["acheter", "ne rien faire"]
    assert "aucune position" in context["situation"].lower()
    assert "vendre" in context["situation"].lower()


def test_with_a_position_held_a_sale_is_possible_and_the_line_is_readable():
    context = build_context(FEATURES, held())
    assert context["actions_possibles"] == ["acheter", "vendre", "ne rien faire"]
    # The quantity keeps the engine's own string: an audited figure, not a
    # rounded one.
    assert context["position_detenue"]["quantite"].startswith("12")
    assert context["position_detenue"]["prix_de_revient"] == "30,00 €"
    assert context["position_detenue"]["plus_ou_moins_value"] == "+2,86 %"
    assert "12" in context["situation"]
    assert "vendre ce que vous détenez" in context["situation"]


def test_the_situation_names_the_reading_rather_than_repeating_the_numbers():
    down = build_context(FEATURES, None)["lecture"]
    assert "baisse" in down or "sous" in down

    rising = MarketFeatures(
        symbol="AAPL", closes_seen=120, last_price_cents=3_400,
        sma_short_cents=3_380, sma_long_cents=3_300, trend_bps=242,
        momentum_bps=530, rsi_bps=6_800, volatility_bps=90, drawdown_bps=40,
        range_position_bps=8_800,
    )
    up = build_context(rising, None)["lecture"]
    assert "hausse" in up or "au-dessus" in up
    assert up != down


def test_the_context_is_stable_for_the_same_inputs():
    # It is hashed with the features into the audit chain's digest, and a
    # replay compares it: two calls must not differ by a word.
    assert build_context(FEATURES, held()) == build_context(FEATURES, held())


# --------------------------------------------------------------------------
# The question only offers what can be done
# --------------------------------------------------------------------------

def test_with_nothing_held_the_direction_question_offers_no_sale():
    """Measured, twice, on a real simulated day: told in the context that it
    holds nothing, the model still answered « vendre » on 161 decisions out of
    234 — an encoder classifies, it does not obey a sentence. An option that
    cannot be executed has no business being offered; the mandate refused
    every one of those answers anyway."""
    from app.decision.strategy import direction_question

    question = direction_question(None)
    assert question.key == "direction"
    assert question.options == (BUY, HOLD)
    assert "vendre" not in question.prompt.lower()


def test_holding_a_position_puts_the_sale_back_on_the_table():
    from app.decision.strategy import direction_question

    question = direction_question(held())
    assert question.options == (BUY, SELL, HOLD)
    assert question.prompt == DIRECTION.prompt


def test_the_rules_answer_inside_the_options_they_were_offered():
    """The built-in engine reads the same indicators whatever is offered, but
    « vendre » with nothing held is not an option any more: its verdict then
    is « ne rien faire », not a failure. Six decisions of one simulated day
    died `off_contract` before this."""
    from app.decision.replay import ReplayProvider
    from app.decision.strategy import direction_question

    falling = build_context(FEATURES, None)  # every indicator points down
    answer = ReplayProvider().decide(direction_question(None), falling)
    assert answer.choice == HOLD

    # With a position, the sale is offered again and the engine takes it.
    position = held()
    held_answer = ReplayProvider().decide(
        direction_question(position), build_context(FEATURES, position)
    )
    assert held_answer.choice == SELL
