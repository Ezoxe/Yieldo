from datetime import date

from app.engines.intent import (
    SUPPORTED_FORMULATIONS,
    ParsedQuery,
    UnrecognisedQuery,
    parse_intent,
)

TODAY = date(2026, 9, 2)


def _parse(text: str) -> ParsedQuery:
    result = parse_intent(text, TODAY)
    assert isinstance(result, ParsedQuery), f"{text!r} was not recognised: {result}"
    return result


def _refused(text: str) -> UnrecognisedQuery:
    result = parse_intent(text, TODAY)
    assert isinstance(result, UnrecognisedQuery), f"{text!r} should have been refused"
    return result


# --------------------------------------------------------------------------
# The unrecognised path itself.
# --------------------------------------------------------------------------


def test_empty_text_is_refused():
    assert isinstance(parse_intent("", TODAY), UnrecognisedQuery)
    assert isinstance(parse_intent("   ", TODAY), UnrecognisedQuery)


def test_gibberish_is_refused_and_carries_the_supported_formulations():
    """A guessed answer to unparseable input is the failure this module
    exists to prevent -- the refusal must carry what it DOES understand,
    never a nearest-match verdict."""
    refusal = _refused("zorglub bidule truc machin")
    assert refusal.raw_text == "zorglub bidule truc machin"
    assert refusal.supported_formulations == SUPPORTED_FORMULATIONS
    assert len(refusal.supported_formulations) >= len(
        {"total_by_category", "period_comparison", "recurrence_evolution",
         "subscription_cost", "feasibility", "savings_simulation",
         "goal_status", "transaction_search", "patrimoine_projection"}
    )


def test_a_question_with_no_amount_never_guesses_a_feasibility_target():
    """"Puis-je m'acheter une voiture ?" triggers the feasibility wording but
    names no price. A parser that fills in some default amount here would be
    inventing the one figure the question was actually about -- refusing is
    the only honest answer."""
    _refused("Puis-je m'acheter une voiture ?")


def test_a_recurrence_question_naming_nothing_is_refused():
    """"Est-ce que mon abonnement a augmenté ?" asks about a subscription but
    names none. A parser that answered about "whatever the biggest one is"
    would be answering a different, easier question than the one asked."""
    _refused("Est-ce que mon abonnement a augmenté ?")


# --------------------------------------------------------------------------
# Accents, elisions, apostrophes: not an edge case.
# --------------------------------------------------------------------------


def test_accents_are_not_required():
    with_accents = _parse("Combien j'ai dépensé en restaurant l'an dernier ?")
    without_accents = _parse("Combien j'ai depense en restaurant lan dernier ?")
    assert with_accents.intent == without_accents.intent == "total_by_category"
    assert with_accents.period == without_accents.period


def test_the_apostrophe_in_lan_dernier_is_optional():
    assert _parse("Combien j'ai dépensé en restaurant l'an dernier ?").period.label == (
        "l'année dernière (2025)"
    )
    assert _parse("Combien j ai depense en restaurant lan dernier ?").period.label == (
        "l'année dernière (2025)"
    )


# --------------------------------------------------------------------------
# French date forms, each named explicitly in the plan.
# --------------------------------------------------------------------------


def test_named_month_defaults_to_the_current_year():
    period = _parse("Combien j'ai dépensé en mars ?").period
    assert period.start == date(2026, 3, 1)
    assert period.end == date(2026, 3, 31)


def test_named_month_with_an_explicit_year():
    period = _parse("Combien j'ai dépensé en mars 2025 ?").period
    assert (period.start, period.end) == (date(2025, 3, 1), date(2025, 3, 31))


def test_depuis_a_month_runs_to_today():
    period = _parse("Combien j'ai dépensé depuis janvier ?").period
    assert (period.start, period.end) == (date(2026, 1, 1), TODAY)


def test_le_mois_dernier_is_the_full_previous_calendar_month():
    period = _parse("Combien j'ai dépensé le mois dernier ?").period
    assert (period.start, period.end) == (date(2026, 8, 1), date(2026, 8, 31))


def test_le_mois_dernier_crosses_a_year_boundary():
    january = parse_intent("Combien j'ai dépensé le mois dernier ?", date(2026, 1, 15))
    assert isinstance(january, ParsedQuery)
    assert (january.period.start, january.period.end) == (
        date(2025, 12, 1), date(2025, 12, 31),
    )


def test_sur_les_trois_derniers_mois_spans_three_calendar_months_to_today():
    period = _parse("Combien j'ai dépensé sur les trois derniers mois ?").period
    assert (period.start, period.end) == (date(2026, 7, 1), TODAY)


def test_sur_les_n_derniers_mois_also_accepts_digits():
    period = _parse("Combien j'ai dépensé sur les 6 derniers mois ?").period
    assert period.start == date(2026, 4, 1)


def test_en_annee_alone_is_the_whole_calendar_year():
    period = _parse("Combien j'ai dépensé en 2025 ?").period
    assert (period.start, period.end) == (date(2025, 1, 1), date(2025, 12, 31))


def test_cette_annee_and_ce_mois():
    year = _parse("Combien j'ai dépensé cette année ?").period
    assert (year.start, year.end) == (date(2026, 1, 1), date(2026, 12, 31))
    month = _parse("Combien j'ai dépensé ce mois-ci ?").period
    assert (month.start, month.end) == (date(2026, 9, 1), date(2026, 9, 30))


def test_no_period_phrase_leaves_the_period_unset():
    """No date form at all means "toute la période disponible" -- resolved
    later against the ledger's own span, never guessed here."""
    assert _parse("Combien j'ai dépensé en restaurant ?").period is None


# --------------------------------------------------------------------------
# total_by_category
# --------------------------------------------------------------------------


def test_total_by_category_total_mode():
    query = _parse("Combien j'ai dépensé en restaurant en mars ?")
    assert query.intent == "total_by_category"
    assert query.mode == "total"
    assert query.category_hint == "Restaurant"


def test_total_by_category_average_mode():
    query = _parse("Quelle est ma moyenne mensuelle de dépenses en restaurant ?")
    assert query.intent == "total_by_category"
    assert query.mode == "average"
    assert query.category_hint == "Restaurant"


def test_total_by_category_with_no_category_named_means_every_category():
    query = _parse("Combien j'ai dépensé en mars ?")
    assert query.intent == "total_by_category"
    assert query.category_hint is None


def test_total_by_category_does_not_fire_on_a_transaction_search_phrase():
    """Same vocabulary ("combien", "dépensé"), but "chez Darty" is a merchant
    lookup -- a lookup table keyed on "combien"+"dépensé" alone could not
    tell the two apart; this test would catch it collapsing to one intent."""
    query = _parse("Combien j'ai dépensé chez Darty en mars ?")
    assert query.intent == "transaction_search"


def test_total_by_category_does_not_fire_on_a_feasibility_phrase():
    query = _parse("Puis-je m'acheter une voiture à 20000 € ?")
    assert query.intent == "feasibility"


# --------------------------------------------------------------------------
# period_comparison
# --------------------------------------------------------------------------


def test_period_comparison_against_an_implicit_last_month():
    query = _parse("Ai-je dépensé plus ce mois-ci que le mois dernier ?")
    assert query.intent == "period_comparison"
    assert query.period.start == date(2026, 9, 1)
    assert query.compare_period.start == date(2026, 8, 1)


def test_period_comparison_against_an_implicit_last_year():
    query = _parse("Ai-je dépensé moins que l'an dernier ?")
    assert query.intent == "period_comparison"
    assert query.period.start == date(2026, 1, 1)
    assert query.compare_period.start == date(2025, 1, 1)


def test_period_comparison_between_two_explicit_months():
    query = _parse("Comparez mars et avril 2025.")
    assert query.intent == "period_comparison"
    assert (query.period.start.month, query.compare_period.start.month) == (3, 4)
    assert query.compare_period.start.year == 2025


def test_plus_de_montant_does_not_trigger_a_comparison():
    """"plus de 100 €" shares the word "plus" with the comparison marker
    "plus que" but is an amount threshold, not a comparison -- a parser
    keyed on the bare word "plus" would fire here and be wrong."""
    query = _parse("Combien j'ai dépensé de plus de 100 € en mars ?")
    assert query.intent == "total_by_category"


# --------------------------------------------------------------------------
# recurrence_evolution vs subscription_cost
# --------------------------------------------------------------------------


def test_recurrence_evolution_names_the_subscription():
    query = _parse("Est-ce que mon abonnement Netflix a augmenté ?")
    assert query.intent == "recurrence_evolution"
    assert query.entity == "Netflix"


def test_recurrence_evolution_alternate_phrasing():
    query = _parse("Il y a eu une augmentation de prix chez Free ?")
    assert query.intent == "recurrence_evolution"
    assert query.entity == "Free"


def test_subscription_cost_total():
    query = _parse("Combien me coûtent mes abonnements ?")
    assert query.intent == "subscription_cost"


def test_subscription_cost_alternate_phrasing():
    query = _parse("Quel est le coût total de mes abonnements ?")
    assert query.intent == "subscription_cost"


def test_an_abonnement_with_no_price_change_marker_is_the_total_not_the_evolution():
    query = _parse("Combien coûtent mes abonnements ce mois-ci ?")
    assert query.intent == "subscription_cost"


# --------------------------------------------------------------------------
# feasibility
# --------------------------------------------------------------------------


def test_feasibility_with_amount_and_horizon():
    query = _parse("Puis-je m'acheter une voiture à 20 000 € dans 12 mois ?")
    assert query.intent == "feasibility"
    assert query.amount_cents == 2_000_000
    assert query.horizon_months == 12
    assert query.nature == "vehicle"


def test_feasibility_alternate_phrasing_detects_property():
    query = _parse("Ai-je les moyens de m'offrir un appartement à 300000 euros ?")
    assert query.intent == "feasibility"
    assert query.amount_cents == 30_000_000
    assert query.nature == "property"


def test_feasibility_with_no_horizon_leaves_it_unset():
    query = _parse("Puis-je m'acheter un vélo à 500 € ?")
    assert query.horizon_months is None
    assert query.nature == "other"


# --------------------------------------------------------------------------
# savings_simulation
# --------------------------------------------------------------------------


def test_savings_simulation_with_amount_and_horizon():
    query = _parse("Si j'épargne 200 € par mois pendant 24 mois, combien aurai-je ?")
    assert query.intent == "savings_simulation"
    assert query.amount_cents == 20_000
    assert query.horizon_months == 24


def test_savings_simulation_alternate_phrasing():
    query = _parse("Si je mets de côté 100 € chaque mois sur 3 ans, combien j'aurai ?")
    assert query.intent == "savings_simulation"
    assert query.amount_cents == 10_000
    assert query.horizon_months == 36


def test_savings_simulation_without_an_amount_is_refused():
    _refused("Si j'épargne chaque mois, combien aurai-je ?")


# --------------------------------------------------------------------------
# goal_status
# --------------------------------------------------------------------------


def test_goal_status_names_the_goal():
    query = _parse("Où en est mon objectif Vacances ?")
    assert query.intent == "goal_status"
    assert query.entity == "Vacances"


def test_goal_status_alternate_phrasing():
    query = _parse("Quel est l'état de mon objectif Voiture ?")
    assert query.intent == "goal_status"
    assert query.entity == "Voiture"


def test_goal_status_with_no_name_means_every_goal():
    query = _parse("Où en sont mes objectifs ?")
    assert query.intent == "goal_status"
    assert query.entity is None


# --------------------------------------------------------------------------
# transaction_search
# --------------------------------------------------------------------------


def test_transaction_search_by_merchant_and_period():
    query = _parse("Montre-moi mes achats chez Darty en mars.")
    assert query.intent == "transaction_search"
    assert query.entity == "Darty"
    assert query.period.start.month == 3


def test_transaction_search_alternate_phrasing():
    query = _parse("Liste mes transactions chez Amazon.")
    assert query.intent == "transaction_search"
    assert query.entity == "Amazon"


def test_transaction_search_with_no_merchant_still_matches_on_montre_moi():
    query = _parse("Montre-moi mes transactions en mars.")
    assert query.intent == "transaction_search"
    assert query.entity is None


# --------------------------------------------------------------------------
# patrimoine_projection
# --------------------------------------------------------------------------


def test_patrimoine_projection_with_horizon():
    query = _parse("Quelle sera la valeur de mon patrimoine dans 5 ans ?")
    assert query.intent == "patrimoine_projection"
    assert query.horizon_months == 60


def test_patrimoine_projection_alternate_phrasing():
    query = _parse("Combien vaudra mon patrimoine dans 10 ans ?")
    assert query.intent == "patrimoine_projection"
    assert query.horizon_months == 120


def test_patrimoine_projection_without_horizon_leaves_it_unset():
    query = _parse("Quelle est la projection de mon patrimoine ?")
    assert query.intent == "patrimoine_projection"
    assert query.horizon_months is None


# --------------------------------------------------------------------------
# raw_text is always the untouched original, for the "requête exécutée" trail.
# --------------------------------------------------------------------------


def test_raw_text_preserves_exactly_what_was_typed():
    original = "Combien j'ai DÉPENSÉ en Restaurant en Mars ?"
    query = _parse(original)
    assert query.raw_text == original
