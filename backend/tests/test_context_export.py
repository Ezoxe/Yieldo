"""`engines/context_export.py` -- the filterable context export. Design §8.2.

**Every fixture here deliberately holds rows the scope must EXCLUDE.** A
fixture containing only in-scope rows cannot tell a working filter from no
filter at all: the totals would be identical either way. So each dimension is
tested against data where a broken filter leaks something visible -- a merchant
name, a year, an account -- and the assertion is that the leak is absent from
the whole rendered document, not merely absent from one computed total.
"""

from datetime import date

import pytest

from app.engines.context_export import (
    TARGET_MODELS,
    ExportAccount,
    ExportDebt,
    ExportGoal,
    ExportInputs,
    ExportPosition,
    ExportRecurrence,
    ExportScope,
    ExportTransaction,
    build_context_export,
    estimate_tokens,
    target_model,
)

TODAY = date(2026, 9, 3)

# Three years, two accounts, two categories, one transfer. Every one of those
# is something some scope below must exclude, and each carries a merchant name
# that would be visible in the document if the filter let it through.
CARREFOUR = "CARTE X1234 CARREFOUR MARKET"
DARTY = "CARTE X1234 DARTY MADELEINE"
ANCIEN = "VIREMENT ANCIEN LOYER 2024"
LIVRET = "VIREMENT INTERNE VERS LIVRET"


def _tx(
    tx_id: int,
    on: date,
    amount: int,
    label: str,
    *,
    account_id: int = 1,
    account_name: str = "Compte courant",
    category_id: int | None = 1,
    category_name: str | None = "Alimentation",
    is_transfer: bool = False,
) -> ExportTransaction:
    return ExportTransaction(
        id=tx_id, on=on, amount_cents=amount, label=label,
        account_id=account_id, account_name=account_name,
        category_id=category_id, category_name=category_name, is_transfer=is_transfer,
    )


ROWS = [
    # 2024 -- outside every "2025 et 2026" scope below.
    _tx(1, date(2024, 6, 12), -123_456, ANCIEN, category_id=2, category_name="Logement"),
    # 2025 and 2026, on account 1, category 1.
    _tx(2, date(2025, 3, 4), -12_000, CARREFOUR),
    _tx(3, date(2026, 1, 9), -8_000, CARREFOUR),
    # 2026, on account 2, category 2 -- excluded by an account OR a category scope.
    _tx(4, date(2026, 2, 14), -30_000, DARTY, account_id=2, account_name="Compte joint",
        category_id=2, category_name="Logement"),
    # An internal transfer: never an expense, whatever the scope says.
    _tx(5, date(2026, 2, 20), -100_000, LIVRET, is_transfer=True),
    # One inflow, so income is a real figure rather than a structural zero.
    _tx(6, date(2026, 1, 2), 200_000, "VIREMENT SALAIRE", category_id=None,
        category_name=None),
]


def _inputs(**overrides) -> ExportInputs:
    base = dict(
        reporting_currency="EUR",
        transactions=list(ROWS),
        accounts=[
            ExportAccount(id=1, name="Compte courant", kind="checking", balance_cents=120_000),
            ExportAccount(id=2, name="Compte joint", kind="checking", balance_cents=-45_000),
        ],
        categories={1: "Alimentation", 2: "Logement"},
        debts=[ExportDebt(name="Prêt auto Cetelem", principal_cents=800_000,
                          annual_rate_bps=490, minimum_payment_cents=15_000)],
        goals=[ExportGoal(name="Vacances Corse", target_cents=300_000,
                          saved_cents=90_000, due_on=date(2027, 6, 30))],
        positions=[ExportPosition(symbol="MWRD", name="Amundi MSCI World",
                                  asset_class="equity", quantity="12",
                                  market_value_cents=216_000)],
        recurrences=[ExportRecurrence(label="PRLV NETFLIX", amount_cents=-1_299,
                                      periodicity="monthly", annual_cents=-15_588,
                                      status="active")],
        net_worth_cents=291_000,
        projection=None,
        projection_unavailable_reason="Aucune capacité d'épargne mesurable.",
        tax=None,
        tax_unavailable_reason="Aucune plus-value latente à imposer.",
    )
    base.update(overrides)
    return ExportInputs(**base)


def _scope(**overrides) -> ExportScope:
    base = dict(
        date_from=date(2025, 1, 1), date_to=date(2026, 12, 31),
        account_ids=None, category_ids=None, granularity="monthly",
        modules=("profil", "analyses"), anonymise=False,
    )
    base.update(overrides)
    return ExportScope(**base)


def _build(scope=None, inputs=None, target=None):
    return build_context_export(inputs or _inputs(), scope or _scope(), target, TODAY)


# --------------------------------------------------------------------------
# One test per scope dimension, each proving what it EXCLUDES.
# --------------------------------------------------------------------------


def test_a_2025_2026_period_actually_excludes_2024():
    """Design §8.2's own example. The 2024 row is 1 234,56 € -- more than the
    two in-scope Carrefour rows put together -- so a filter that let it through
    would be visible in the total AND its merchant name would be in the
    document. A fixture holding only 2025-2026 rows could not tell the two
    apart at all."""
    document = _build(_scope(granularity="transaction"))
    assert ANCIEN not in document.markdown
    assert "2024" not in document.markdown
    assert CARREFOUR in document.markdown
    # 120,00 + 80,00 + 300,00 of spend, and NOT the 1 234,56 from 2024.
    assert "1 234,56" not in document.markdown
    assert "234,56" not in document.markdown


def test_an_account_scope_excludes_every_other_accounts_rows():
    document = _build(_scope(account_ids=frozenset({1}), granularity="transaction"))
    assert DARTY not in document.markdown
    assert "Compte joint" not in document.markdown
    assert CARREFOUR in document.markdown


def test_a_category_scope_excludes_every_other_categorys_rows():
    document = _build(_scope(category_ids=frozenset({1}), granularity="transaction"))
    assert DARTY not in document.markdown
    assert "Logement" not in document.markdown
    assert CARREFOUR in document.markdown


def test_an_uncategorised_row_is_excluded_by_a_category_scope():
    """A row with no category is not "every category" -- it is no category, and
    a scope naming categories has not named it."""
    document = _build(_scope(category_ids=frozenset({1}), granularity="transaction"))
    assert "VIREMENT SALAIRE" not in document.markdown


def test_an_internal_transfer_is_never_counted_and_the_count_is_stated():
    document = _build(_scope(granularity="transaction"))
    assert LIVRET not in document.markdown
    assert document.excluded_transfer_count == 1
    assert "virement" in document.markdown.lower()
    # 1 000,00 EUR of transfer would dwarf every real figure here.
    assert "1 000,00" not in document.markdown


def test_a_module_that_was_not_asked_for_is_absent_and_one_that_was_is_present():
    document = _build(_scope(modules=("dettes",)))
    assert "Prêt auto Cetelem" in document.markdown
    # Not asked for: goals, positions, recurrences.
    assert "Vacances Corse" not in document.markdown
    assert "MWRD" not in document.markdown
    assert "PRLV NETFLIX" not in document.markdown


def test_every_module_renders_when_every_module_is_asked_for():
    from app.engines.context_export import MODULES

    document = _build(_scope(modules=MODULES))
    assert "Prêt auto Cetelem" in document.markdown
    assert "Vacances Corse" in document.markdown
    assert "MWRD" in document.markdown
    assert "PRLV NETFLIX" in document.markdown
    # An unavailable module names its own cause rather than printing nothing.
    assert "Aucune capacité d'épargne mesurable." in document.markdown
    assert "Aucune plus-value latente à imposer." in document.markdown
    assert set(document.sections) == set(MODULES)


# --------------------------------------------------------------------------
# Granularity.
# --------------------------------------------------------------------------


def test_annual_granularity_aggregates_by_year_and_lists_no_transaction():
    document = _build(_scope(granularity="annual"))
    assert "| 2025 |" in document.markdown
    assert "| 2026 |" in document.markdown
    assert CARREFOUR not in document.markdown


def test_monthly_granularity_aggregates_by_month_and_lists_no_transaction():
    document = _build(_scope(granularity="monthly"))
    assert "| 2025-03 |" in document.markdown
    assert "| 2026-01 |" in document.markdown
    assert "| 2025 |" not in document.markdown
    assert CARREFOUR not in document.markdown


def test_transaction_granularity_lists_every_row_in_scope():
    document = _build(_scope(granularity="transaction"))
    assert CARREFOUR in document.markdown
    assert DARTY in document.markdown
    assert document.transaction_count == 4  # 2 Carrefour, 1 Darty, 1 salary


# --------------------------------------------------------------------------
# Anonymisation is a promise about the WHOLE document.
# --------------------------------------------------------------------------

SEEDED_NAMES = [
    CARREFOUR, DARTY, ANCIEN, LIVRET, "VIREMENT SALAIRE",
    "Compte courant", "Compte joint", "Prêt auto Cetelem", "Vacances Corse",
    "MWRD", "Amundi MSCI World", "PRLV NETFLIX",
]


def test_anonymisation_leaves_no_merchant_string_anywhere_in_the_document():
    """Scanned across the WHOLE rendered document, every module included --
    never one field. A merchant that survives inside a module's prose is a
    broken promise even when the transaction table is clean."""
    from app.engines.context_export import MODULES

    document = _build(_scope(modules=MODULES, granularity="transaction", anonymise=True))
    for name in SEEDED_NAMES:
        assert name not in document.markdown, f"« {name} » a survécu à l'anonymisation"


def test_anonymisation_leaves_no_absolute_amount_anywhere_in_the_document():
    from app.engines.context_export import MODULES

    document = _build(_scope(modules=MODULES, granularity="transaction", anonymise=True))
    assert "€" not in document.markdown
    assert "EUR" not in document.markdown
    # The figures that WOULD have been printed, in every form they take.
    for absolute in ("120,00", "80,00", "300,00", "8 000,00", "2 160,00", "155,88"):
        assert absolute not in document.markdown


def test_anonymisation_keeps_the_same_merchant_as_the_same_pseudonym():
    """Two Carrefour rows must read as ONE masked merchant, or every
    aggregation the model does on the document is wrong."""
    document = _build(_scope(granularity="transaction", anonymise=True))
    assert document.markdown.count("Marchand 1") >= 2


def test_anonymisation_still_carries_the_shape_of_the_spending():
    document = _build(_scope(granularity="monthly", anonymise=True))
    assert "%" in document.markdown
    assert "base 100" in document.markdown.lower()


def test_anonymisation_refuses_when_there_is_no_base_to_be_relative_to():
    """No spend on the scope means no reference, and a percentage of zero is
    not a figure. Refused in French, naming its own remedy -- never a table of
    0,0 % standing in for data nobody has."""
    empty = _inputs(transactions=[_tx(9, date(2026, 5, 1), 100_000, "VIREMENT SALAIRE")])
    with pytest.raises(ValueError) as excinfo:
        _build(_scope(anonymise=True), inputs=empty)
    assert "anonymisation" in str(excinfo.value).lower()
    assert "désactivez" in str(excinfo.value) or "Élargissez" in str(excinfo.value)


def test_without_anonymisation_the_amounts_are_absolute_and_the_merchants_intact():
    document = _build(_scope(granularity="transaction"))
    assert CARREFOUR in document.markdown
    assert "120,00 €" in document.markdown


# --------------------------------------------------------------------------
# Token estimate and the context-window warning.
# --------------------------------------------------------------------------


def test_the_token_estimate_is_a_real_function_of_the_document_length():
    short = estimate_tokens("abc")
    longer = estimate_tokens("abc" * 1_000)
    assert 0 < short < longer
    # Deliberately conservative: a French document is closer to 3,5 characters
    # per token than to 4, and under-estimating would tell the user a document
    # fits when it does not.
    assert estimate_tokens("x" * 3_500) >= 1_000


def test_a_document_under_the_window_carries_no_warning():
    document = _build(_scope(), target=target_model("gemini-1-5-pro"))
    assert document.warning is None


def test_a_document_over_the_window_says_so_with_both_figures_and_a_remedy():
    from app.engines.context_export import MODULES

    # Ten thousand transactions listed one by one: far past a small local model.
    rows = [
        _tx(1_000 + index, date(2026, 1, 1), -1_000, f"ACHAT NUMERO {index}")
        for index in range(4_000)
    ]
    document = _build(
        _scope(modules=MODULES, granularity="transaction"),
        inputs=_inputs(transactions=rows),
        target=target_model("local-8k"),
    )
    assert document.warning is not None
    stripped = "".join(ch for ch in document.warning if not ch.isspace())
    assert str(document.estimated_tokens) in stripped
    assert "8" in document.warning  # the window it exceeds
    assert "granularité" in document.warning


def test_every_declared_target_model_is_resolvable_by_its_own_key():
    for model in TARGET_MODELS:
        assert target_model(model.key) is model


def test_an_unknown_target_model_is_refused_rather_than_defaulted():
    with pytest.raises(ValueError) as excinfo:
        target_model("un-modele-qui-nexiste-pas")
    assert "un-modele-qui-nexiste-pas" in str(excinfo.value)


# --------------------------------------------------------------------------
# The document says what it is.
# --------------------------------------------------------------------------


def test_the_document_states_its_own_scope_before_any_figure():
    document = _build(_scope(account_ids=frozenset({1}), category_ids=frozenset({1})))
    head = document.markdown.split("## ")[1]
    assert "Périmètre" in head
    assert "2025-01-01" in head and "2026-12-31" in head
    assert "Compte courant" in head
    assert "Alimentation" in head
    assert "mensuelle" in head


def test_an_open_ended_period_is_resolved_against_the_ledger_not_the_clock():
    """`today` is a parameter, and an absent bound falls back to the ledger's
    own span -- never to `date.today()` read inside the engine."""
    document = _build(_scope(date_from=None, date_to=None, granularity="transaction"))
    # The whole ledger, 2024 included, because no period was declared.
    assert ANCIEN in document.markdown


def test_an_account_scope_withholds_the_household_wide_net_worth():
    """A net worth spans every account. Printed under a scope that keeps only
    one, it would put back the very balances the filter excluded — so it is
    withheld, and the withholding is stated rather than left as a silence."""
    document = _build(_scope(modules=("patrimoine",), account_ids=frozenset({1})))
    assert "2 910,00" not in document.markdown
    assert "Patrimoine net non communiqué" in document.markdown
    assert "Compte joint" not in document.markdown
    assert "-450,00" not in document.markdown
    assert "1 200,00 €" in document.markdown  # the account that IS in scope


def test_with_no_account_scope_the_net_worth_is_the_household_figure():
    document = _build(_scope(modules=("patrimoine",)))
    assert "2 910,00 €" in document.markdown


# --------------------------------------------------------------------------
# The five ready-made templates. Design §8.2.
# --------------------------------------------------------------------------


def test_the_five_templates_design_8_2_names_are_all_there():
    from app.engines.context_export import build_templates

    keys = [template.key for template in build_templates(TODAY)]
    assert keys == [
        "bilan-annuel", "faisabilite-achat", "revue-portefeuille",
        "optimisation-fiscale", "diagnostic-budgetaire",
    ]


def test_each_template_pre_selects_a_scope_and_carries_a_question():
    from app.engines.context_export import build_templates

    for template in build_templates(TODAY):
        assert template.question.strip(), template.key
        assert template.scope.modules, template.key
        assert template.scope.date_from is not None, template.key
        assert template.scope.date_to is not None, template.key
        assert template.scope.date_from <= template.scope.date_to, template.key
        # Every module a template names must be a real one.
        for module in template.scope.modules:
            assert module in MODULES_FOR_TEST, (template.key, module)


MODULES_FOR_TEST = (
    "profil", "budget", "patrimoine", "dettes", "objectifs",
    "positions", "recurrences", "analyses", "projections", "fiscalite",
)


def test_the_templates_pre_select_different_scopes_from_each_other():
    """Five presets that all resolved to the same scope would be one preset
    printed five times."""
    from app.engines.context_export import build_templates

    scopes = {
        (t.scope.date_from, t.scope.date_to, t.scope.granularity, t.scope.modules)
        for t in build_templates(TODAY)
    }
    assert len(scopes) == 5


def test_the_annual_templates_cover_the_last_COMPLETE_calendar_year():
    """2026-09-03 is inside 2026, so the year to report on is 2025 -- a bilan
    of a year still running would be a bilan of eight months."""
    from app.engines.context_export import build_templates

    bilan = next(t for t in build_templates(TODAY) if t.key == "bilan-annuel")
    assert bilan.scope.date_from == date(2025, 1, 1)
    assert bilan.scope.date_to == date(2025, 12, 31)


def test_the_rolling_templates_stop_at_the_last_complete_month():
    """A month still running is not an observation. 2026-09-03 means the last
    complete month is August 2026."""
    from app.engines.context_export import build_templates

    diagnostic = next(t for t in build_templates(TODAY) if t.key == "diagnostic-budgetaire")
    assert diagnostic.scope.date_to == date(2026, 8, 31)
    assert diagnostic.scope.date_from == date(2026, 3, 1)  # six complete months


def test_every_template_builds_a_real_document_on_real_inputs():
    from app.engines.context_export import build_templates

    for template in build_templates(TODAY):
        document = build_context_export(_inputs(), template.scope, None, TODAY)
        assert document.markdown.startswith("# Contexte financier")
        assert document.estimated_tokens > 0
        assert set(document.sections) == set(template.scope.modules)
