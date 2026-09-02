from datetime import date

from app.engines.answer import ChatContext, PortfolioSnapshot, answer_query
from app.engines.capacity import MonthObservation
from app.engines.goal import GoalInput
from app.engines.intent import parse_intent
from app.engines.recurrence import RecurringTx

TODAY = date(2026, 9, 2)


def _tx(on: date, amount: int, label: str, category_id: int | None = None) -> RecurringTx:
    return RecurringTx(
        on=on, amount_cents=amount, label_key=label.lower().replace(" ", ""),
        label_raw=label, category_id=category_id,
    )


def _month(year: int, month: int, inflow: int, outflow: int) -> MonthObservation:
    start = date(year, month, 1)
    end = date(year, month, 28)
    return MonthObservation(
        key=f"{year}-{month:02d}", start=start, end=end,
        inflow_cents=inflow, outflow_cents=outflow, net_cents=inflow + outflow,
        count=2,
    )


def _ctx(**overrides) -> ChatContext:
    base = dict(
        ledger_start=date(2026, 1, 1), ledger_end=date(2026, 8, 31),
        transactions=[], categories={}, months=[],
        recurrence_anchor=TODAY, balance_cents=0,
        existing_debt_payments_cents=0, goals=[],
        portfolio=PortfolioSnapshot(market_value_cents=0, positions_total=0, positions_valued=0),
    )
    base.update(overrides)
    return ChatContext(**base)


def _q(text: str):
    query = parse_intent(text, TODAY)
    assert query.intent  # a ParsedQuery, not an UnrecognisedQuery
    return query


# --------------------------------------------------------------------------
# total_by_category
# --------------------------------------------------------------------------


def test_total_by_category_sums_only_the_matching_category_and_period():
    """Two categories, two periods -- a hardcoded figure or a sum over the
    wrong slice would both produce a plausible-looking wrong number here."""
    ctx = _ctx(
        categories={1: "Restaurant", 2: "Transport"},
        transactions=[
            _tx(date(2026, 3, 5), -3_000, "Le Bistrot", category_id=1),
            _tx(date(2026, 3, 12), -1_500, "Sushi", category_id=1),
            _tx(date(2026, 3, 20), -5_000, "Essence", category_id=2),
            _tx(date(2026, 4, 5), -9_999, "Le Bistrot", category_id=1),  # outside period
        ],
    )
    query = _q("Combien j'ai dépensé en restaurant en mars ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == -4_500
    assert "Restaurant" in answer.text
    assert "mars" in answer.query_description


def test_total_by_category_average_divides_by_complete_months_not_total_days():
    """Two complete months, different totals each -- a mean-of-days or a
    plain total (skipping the division) would both pass a same-value fixture
    but fail this one."""
    ctx = _ctx(
        categories={1: "Restaurant"},
        transactions=[
            _tx(date(2026, 1, 5), -2_000, "A", category_id=1),
            _tx(date(2026, 2, 5), -6_000, "B", category_id=1),
        ],
        months=[_month(2026, 1, 0, -2_000), _month(2026, 2, 0, -6_000)],
    )
    query = _q("Quelle est ma moyenne mensuelle de dépenses en restaurant depuis janvier ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == -4_000  # (-2000 + -6000) / 2, not -8000 and not -2000


def test_total_by_category_average_with_no_complete_months_is_refused():
    ctx = _ctx(categories={1: "Restaurant"}, transactions=[], months=[])
    query = _q("Quelle est ma moyenne mensuelle de dépenses en restaurant en mars ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "aucun mois complet" in answer.text.lower()


def test_total_by_category_unknown_category_names_what_exists():
    ctx = _ctx(categories={1: "Restaurant", 2: "Transport"})
    query = _q("Combien j'ai dépensé en loisirs en mars ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "Restaurant" in answer.text and "Transport" in answer.text


def test_total_by_category_ambiguous_category_is_refused_not_guessed():
    """Neither name is an EXACT match for "restauration" -- both merely
    contain it -- so this must refuse rather than silently pick one."""
    ctx = _ctx(categories={1: "Restauration midi", 2: "Restauration soir"})
    query = _q("Combien j'ai dépensé en restauration ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "Restauration midi" in answer.text and "Restauration soir" in answer.text


def test_total_by_category_with_no_category_named_sums_everything():
    ctx = _ctx(
        categories={1: "Restaurant", 2: "Transport"},
        transactions=[
            _tx(date(2026, 3, 5), -3_000, "A", category_id=1),
            _tx(date(2026, 3, 6), -1_000, "B", category_id=2),
        ],
    )
    query = _q("Combien j'ai dépensé en mars ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == -4_000


def test_total_by_category_with_no_period_covers_the_whole_ledger():
    ctx = _ctx(
        ledger_start=date(2025, 1, 1), ledger_end=date(2026, 1, 31),
        categories={1: "Restaurant"},
        transactions=[
            _tx(date(2025, 6, 5), -1_000, "A", category_id=1),
            _tx(date(2026, 1, 5), -2_000, "B", category_id=1),
        ],
    )
    query = _q("Combien j'ai dépensé en restaurant ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == -3_000
    assert "2025-01-01" in answer.query_description or "toute la période" in answer.text.lower() \
        or "toute la période" in answer.query_description.lower()


# --------------------------------------------------------------------------
# period_comparison
# --------------------------------------------------------------------------


def test_period_comparison_reports_spent_more():
    ctx = _ctx(transactions=[
        _tx(date(2026, 9, 1), -5_000, "A"),   # this month
        _tx(date(2026, 8, 1), -2_000, "B"),   # last month
    ])
    query = _q("Ai-je dépensé plus ce mois-ci que le mois dernier ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == 3_000  # spent 30 EUR more than the baseline
    assert "plus" in answer.text.lower()


def test_period_comparison_reports_spent_less():
    ctx = _ctx(transactions=[
        _tx(date(2026, 9, 1), -1_000, "A"),
        _tx(date(2026, 8, 1), -4_000, "B"),
    ])
    query = _q("Ai-je dépensé plus ce mois-ci que le mois dernier ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == -3_000  # spent 30 EUR less than the baseline
    assert "moins" in answer.text.lower()


# --------------------------------------------------------------------------
# recurrence_evolution / subscription_cost
# --------------------------------------------------------------------------


def _netflix(amounts: list[int], start: date) -> list[RecurringTx]:
    txs = []
    on = start
    for amount in amounts:
        txs.append(_tx(on, amount, "Netflix"))
        month = on.month + 1
        year = on.year + (month > 12)
        month = month if month <= 12 else 1
        on = date(year, month, min(on.day, 28))
    return txs


def test_recurrence_evolution_reports_a_real_price_change():
    txs = _netflix([-1_349, -1_349, -1_349, -1_599, -1_599, -1_599], date(2026, 1, 15))
    ctx = _ctx(transactions=txs, recurrence_anchor=date(2026, 6, 20))
    query = _q("Est-ce que mon abonnement Netflix a augmenté ?")
    answer = answer_query(query, ctx, TODAY)
    assert not answer.is_refusal
    assert "augmenté" in answer.text
    assert "13,49" in answer.text.replace(" ", "").replace(" ", "") or "13,49" in answer.text


def test_recurrence_evolution_with_no_change_says_so():
    txs = _netflix([-1_349, -1_349, -1_349, -1_349, -1_349], date(2026, 1, 15))
    ctx = _ctx(transactions=txs, recurrence_anchor=date(2026, 5, 20))
    query = _q("Est-ce que mon abonnement Netflix a augmenté ?")
    answer = answer_query(query, ctx, TODAY)
    assert not answer.is_refusal
    assert "stable" in answer.text.lower()


def test_recurrence_evolution_engine_notice_passes_through_unchanged():
    """Too few occurrences: `detect_recurrences` refuses on its own, and that
    exact sentence must reach the caller untouched -- never rephrased."""
    from app.engines.recurrence import detect_recurrences

    txs = [_tx(date(2026, 1, 15), -1_349, "Netflix")]
    ctx = _ctx(transactions=txs, recurrence_anchor=date(2026, 6, 20))
    expected = detect_recurrences(txs, date(2026, 6, 20)).notice
    query = _q("Est-ce que mon abonnement Netflix a augmenté ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert answer.text == expected


def test_recurrence_evolution_unknown_name_lists_what_was_found():
    txs = _netflix([-1_349, -1_349, -1_349, -1_349, -1_349], date(2026, 1, 15))
    ctx = _ctx(transactions=txs, recurrence_anchor=date(2026, 5, 20))
    query = _q("Est-ce que mon abonnement Spotify a augmenté ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "Netflix" in answer.text


def test_subscription_cost_totals_annualisable_active_subscriptions():
    txs = _netflix([-1_000] * 5, date(2026, 1, 15))
    ctx = _ctx(transactions=txs, recurrence_anchor=date(2026, 6, 20))
    query = _q("Combien me coûtent mes abonnements ?")
    answer = answer_query(query, ctx, TODAY)
    assert not answer.is_refusal
    assert answer.amount_cents == -12_000  # 1000 cents * 12 months


def test_subscription_cost_engine_notice_passes_through_unchanged():
    ctx = _ctx(transactions=[], recurrence_anchor=TODAY)
    from app.engines.recurrence import detect_recurrences

    expected = detect_recurrences([], TODAY).notice
    query = _q("Combien me coûtent mes abonnements ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert answer.text == expected


# --------------------------------------------------------------------------
# feasibility
# --------------------------------------------------------------------------


def test_feasibility_refusal_passes_through_the_engines_own_sentence():
    """Fewer than three complete months: `assess_feasibility` refuses in its
    own words, and this must be exactly what reaches the user."""
    from app.engines.capacity import measure_savings_capacity
    from app.engines.feasibility import (
        Assumptions,
        PurchaseRequest,
        assess_feasibility,
    )

    ctx = _ctx(months=[])
    query = _q("Puis-je m'acheter une voiture à 20000 € dans 12 mois ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    expected = assess_feasibility(
        PurchaseRequest(target_cents=2_000_000, horizon_months=12, down_payment_cents=0,
                        nature="vehicle"),
        measure_savings_capacity([]), None, 0,
        Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                   ownership_years=5, monthly_income_cents=None,
                   existing_debt_payments_cents=0),
        TODAY,
    ).capacity_unavailable_reason
    assert answer.text == expected


def test_feasibility_out_of_reach_on_a_negative_capacity():
    """The operator's own shape: negative capacity, real verdict, never a
    refusal. `abs()`-ing the capacity anywhere upstream would flip this to
    "comfortable", which is exactly the defect `engines/feasibility.py`
    documents at length."""
    months = [_month(2026, m, 400_000, -700_000) for m in (1, 2, 3)]
    ctx = _ctx(months=months, balance_cents=-2_000_000)
    query = _q("Puis-je m'acheter une voiture à 20000 € dans 12 mois ?")
    answer = answer_query(query, ctx, TODAY)
    assert not answer.is_refusal
    assert "hors de portée" in answer.text


def test_feasibility_comfortable_on_ample_capacity():
    months = [_month(2026, m, 500_000, -100_000) for m in (1, 2, 3)]
    ctx = _ctx(months=months, balance_cents=1_000_000)
    query = _q("Puis-je m'acheter un vélo à 500 € dans 3 mois ?")
    answer = answer_query(query, ctx, TODAY)
    assert not answer.is_refusal
    assert "atteignable confortablement" in answer.text


def test_feasibility_uses_the_default_horizon_when_none_is_stated():
    months = [_month(2026, m, 500_000, -100_000) for m in (1, 2, 3)]
    ctx = _ctx(months=months, balance_cents=0)
    query = _q("Puis-je m'acheter un vélo à 500 € ?")
    answer = answer_query(query, ctx, TODAY)
    assert "12 mois" in answer.query_description
    assert "défaut" in answer.query_description.lower()


# --------------------------------------------------------------------------
# savings_simulation
# --------------------------------------------------------------------------


def test_savings_simulation_computes_a_real_compounded_projection():
    ctx = _ctx()
    query = _q("Si j'épargne 200 € par mois pendant 24 mois, combien aurai-je ?")
    answer = answer_query(query, ctx, TODAY)
    # 200 EUR x 24 months = 4800 EUR contributed; interest on top of that at
    # 3%/an must make the total strictly greater than the plain sum, or this
    # would pass for a "just multiply" implementation too.
    assert answer.amount_cents > 480_000
    assert "24 mois" in answer.query_description


def test_savings_simulation_uses_the_default_horizon_when_none_is_stated():
    ctx = _ctx()
    query = _q("Si j'épargne 200 € par mois, combien aurai-je ?")
    answer = answer_query(query, ctx, TODAY)
    assert "12 mois" in answer.query_description


# --------------------------------------------------------------------------
# goal_status
# --------------------------------------------------------------------------


def test_goal_status_with_no_goals_is_refused():
    ctx = _ctx(goals=[])
    query = _q("Où en sont mes objectifs ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal


def test_goal_status_named_goal_reports_progress():
    goals = [GoalInput(id=1, name="Vacances", target_cents=100_000, saved_cents=40_000,
                       due_on=None, priority=1)]
    months = [_month(2026, m, 500_000, -100_000) for m in (1, 2, 3)]
    ctx = _ctx(goals=goals, months=months)
    query = _q("Où en est mon objectif Vacances ?")
    answer = answer_query(query, ctx, TODAY)
    assert not answer.is_refusal
    assert answer.amount_cents == 60_000
    assert "Vacances" in answer.text


def test_goal_status_named_goal_passes_through_the_engines_refusal():
    """Negative capacity: `evaluate_goals` refuses this goal in its own
    words, and that sentence must reach the user unchanged."""
    goals = [GoalInput(id=1, name="Vacances", target_cents=100_000, saved_cents=0,
                       due_on=None, priority=1)]
    months = [_month(2026, m, 100_000, -400_000) for m in (1, 2, 3)]
    ctx = _ctx(goals=goals, months=months)
    query = _q("Où en est mon objectif Vacances ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "négative" in answer.text.lower() or "nulle" in answer.text.lower()


def test_goal_status_unknown_name_lists_available_goals():
    goals = [GoalInput(id=1, name="Vacances", target_cents=100_000, saved_cents=0,
                       due_on=None, priority=1)]
    ctx = _ctx(goals=goals)
    query = _q("Où en est mon objectif Voiture ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "Vacances" in answer.text


def test_goal_status_with_no_name_reports_every_goal():
    goals = [
        GoalInput(id=1, name="Vacances", target_cents=100_000, saved_cents=100_000,
                 due_on=None, priority=1),
        GoalInput(id=2, name="Voiture", target_cents=500_000, saved_cents=0,
                 due_on=None, priority=2),
    ]
    ctx = _ctx(goals=goals)
    query = _q("Où en sont mes objectifs ?")
    answer = answer_query(query, ctx, TODAY)
    assert "Vacances" in answer.text and "Voiture" in answer.text


# --------------------------------------------------------------------------
# transaction_search
# --------------------------------------------------------------------------


def test_transaction_search_by_merchant_sums_matching_transactions():
    ctx = _ctx(transactions=[
        _tx(date(2026, 3, 5), -3_000, "Darty Paris"),
        _tx(date(2026, 3, 12), -1_500, "Darty en ligne"),
        _tx(date(2026, 3, 20), -5_000, "Fnac"),
    ])
    query = _q("Montre-moi mes achats chez Darty en mars.")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == -4_500
    assert not answer.is_refusal


def test_transaction_search_with_no_match_reports_a_real_zero_not_a_refusal():
    ctx = _ctx(transactions=[_tx(date(2026, 3, 5), -3_000, "Fnac")])
    query = _q("Montre-moi mes achats chez Darty en mars.")
    answer = answer_query(query, ctx, TODAY)
    assert answer.amount_cents == 0
    assert not answer.is_refusal


# --------------------------------------------------------------------------
# patrimoine_projection
# --------------------------------------------------------------------------


def test_patrimoine_projection_with_no_positions_is_refused():
    """The operator's own state: zero investment positions."""
    ctx = _ctx(portfolio=PortfolioSnapshot(0, 0, 0))
    query = _q("Quelle sera la valeur de mon patrimoine dans 5 ans ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "aucune position" in answer.text.lower()


def test_patrimoine_projection_with_unpriced_positions_is_refused():
    ctx = _ctx(portfolio=PortfolioSnapshot(0, 3, 0))
    query = _q("Quelle sera la valeur de mon patrimoine dans 5 ans ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert "valorisée" in answer.text.lower() or "inconnu" in answer.text.lower()


def test_patrimoine_projection_projects_a_real_capital():
    months = [_month(2026, m, 500_000, -100_000) for m in (1, 2, 3)]
    ctx = _ctx(portfolio=PortfolioSnapshot(1_000_000, 2, 2), months=months)
    query = _q("Quelle sera la valeur de mon patrimoine dans 5 ans ?")
    answer = answer_query(query, ctx, TODAY)
    assert not answer.is_refusal
    assert answer.amount_cents > 1_000_000


# --------------------------------------------------------------------------
# Every refusal still carries the executed query.
# --------------------------------------------------------------------------


def test_a_refusal_still_names_the_query_that_was_attempted():
    ctx = _ctx(months=[])
    query = _q("Puis-je m'acheter une voiture à 20000 € dans 12 mois ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.is_refusal
    assert answer.query_description  # non-empty: what was attempted is still shown
    assert "20 000" in answer.query_description or "20000" in answer.query_description


# --------------------------------------------------------------------------
# The chart an answer deserves -- and nothing when it deserves none.
# --------------------------------------------------------------------------


def test_total_by_category_charts_one_bar_per_month_actually_observed():
    """Three months of restaurant spend: the chart must decompose the SAME
    total the sentence quotes, month by month, and never carry a month the
    period does not contain."""
    ctx = _ctx(
        categories={1: "Restaurant"},
        transactions=[
            _tx(date(2026, 1, 5), -2_000, "A", category_id=1),
            _tx(date(2026, 2, 5), -6_000, "B", category_id=1),
            _tx(date(2026, 3, 5), -1_000, "C", category_id=1),
            _tx(date(2025, 12, 5), -9_999, "hors période", category_id=1),
        ],
        months=[_month(2026, m, 0, 0) for m in (1, 2, 3)],
    )
    query = _q("Combien j'ai dépensé en restaurant depuis janvier ?")
    answer = answer_query(query, ctx, TODAY)
    assert answer.chart is not None
    assert answer.chart.kind == "bars"
    assert [point.label for point in answer.chart.points] == [
        "janvier 2026", "février 2026", "mars 2026",
    ]
    assert [point.amount_cents for point in answer.chart.points] == [-2_000, -6_000, -1_000]
    # The decomposition sums to the figure the sentence quotes.
    assert sum(point.amount_cents for point in answer.chart.points) == answer.amount_cents


def test_total_by_category_draws_no_chart_on_a_single_month():
    """One bar is not a chart -- it is the figure already printed beside it."""
    ctx = _ctx(
        categories={1: "Restaurant"},
        transactions=[_tx(date(2026, 3, 5), -2_000, "A", category_id=1)],
        months=[_month(2026, 3, 0, 0)],
    )
    answer = answer_query(_q("Combien j'ai dépensé en restaurant en mars ?"), ctx, TODAY)
    assert answer.chart is None


def test_a_refused_answer_never_carries_a_chart():
    ctx = _ctx(categories={1: "Restaurant"}, transactions=[])
    answer = answer_query(_q("Combien j'ai dépensé en cinéma en mars ?"), ctx, TODAY)
    assert answer.is_refusal
    assert answer.chart is None


def test_period_comparison_charts_the_two_periods_it_weighed():
    ctx = _ctx(
        transactions=[
            _tx(date(2026, 9, 3), -4_000, "A"),
            _tx(date(2026, 8, 3), -1_000, "B"),
        ],
    )
    answer = answer_query(_q("Ai-je dépensé plus ce mois-ci que le mois dernier ?"), ctx, TODAY)
    assert answer.chart is not None
    assert answer.chart.kind == "bars"
    assert len(answer.chart.points) == 2
    # Positive magnitudes, in the same convention the sentence uses.
    assert [point.amount_cents for point in answer.chart.points] == [4_000, 1_000]
    assert "août" in answer.chart.points[1].label


def test_savings_simulation_charts_the_balance_month_by_month():
    answer = answer_query(
        _q("Si j'épargne 200 € par mois pendant 24 mois, combien aurai-je ?"), _ctx(), TODAY
    )
    assert answer.chart is not None
    assert answer.chart.kind == "line"
    assert len(answer.chart.points) == 24
    assert answer.chart.points[-1].amount_cents == answer.amount_cents


def test_subscription_cost_charts_each_subscription_it_counted():
    rows = []
    for month in range(1, 9):
        rows.append(_tx(date(2026, month, 4), -1_299, "NETFLIX"))
        rows.append(_tx(date(2026, month, 8), -999, "SPOTIFY"))
    ctx = _ctx(transactions=rows, recurrence_anchor=date(2026, 8, 20))
    answer = answer_query(_q("Combien me coûtent mes abonnements ?"), ctx, TODAY)
    assert answer.chart is not None
    assert answer.chart.kind == "bars"
    labels = [point.label for point in answer.chart.points]
    assert "NETFLIX" in labels and "SPOTIFY" in labels
    # Annualised magnitudes, positive, and the biggest first.
    assert answer.chart.points[0].amount_cents >= answer.chart.points[1].amount_cents
    assert all(point.amount_cents > 0 for point in answer.chart.points)


def test_goal_status_deserves_no_chart():
    ctx = _ctx(
        goals=[GoalInput(id=1, name="Vacances", target_cents=100_000,
                         saved_cents=40_000, due_on=None, priority=1)],
        months=[_month(2026, m, 500_000, -100_000) for m in (1, 2, 3)],
    )
    answer = answer_query(_q("Où en est mon objectif Vacances ?"), ctx, TODAY)
    assert answer.chart is None
