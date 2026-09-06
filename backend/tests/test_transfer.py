"""The rule that decides what is a movement of your own money, and the figure
that says how much of it actually left the current account."""

from datetime import date

import pytest

from app.engines.transfer import (
    SAVINGS_ACCOUNT_KINDS,
    SetAsideRow,
    is_internal_transfer,
    measure_set_aside,
)


# --- The marking rule -------------------------------------------------------

def test_a_transfer_kind_category_marks_the_row():
    assert is_internal_transfer(
        category_kind="transfer", account_kind="checking", transfer_source="auto"
    ) is True


def test_an_expense_category_on_a_current_account_is_not_a_transfer():
    assert is_internal_transfer(
        category_kind="expense", account_kind="checking", transfer_source="auto"
    ) is False


def test_an_uncategorised_row_on_a_savings_account_is_a_transfer():
    assert is_internal_transfer(
        category_kind=None, account_kind="savings", transfer_source="auto"
    ) is True


@pytest.mark.parametrize("kind", sorted(SAVINGS_ACCOUNT_KINDS))
def test_every_savings_kind_carries_the_account_rule(kind: str):
    assert is_internal_transfer(
        category_kind=None, account_kind=kind, transfer_source="auto"
    ) is True


def test_interest_categorised_as_income_on_a_livret_stays_a_flow():
    """The account rule decides only where no category has. Interest is income,
    and calling it a transfer would hide a real gain."""
    assert is_internal_transfer(
        category_kind="income", account_kind="savings", transfer_source="auto"
    ) is False


def test_management_fees_categorised_as_an_expense_on_a_pea_stay_a_flow():
    assert is_internal_transfer(
        category_kind="expense", account_kind="pea", transfer_source="auto"
    ) is False


def test_an_uncategorised_row_on_a_current_account_is_not_a_transfer():
    assert is_internal_transfer(
        category_kind=None, account_kind="checking", transfer_source="auto"
    ) is False


def test_a_manual_mark_is_never_recomputed():
    """`is_internal_transfer` answers what the automatic rules would say. A
    `manual` row must never be passed to it -- and if it is, it refuses rather
    than returning a value a caller could mistake for an answer."""
    with pytest.raises(ValueError):
        is_internal_transfer(
            category_kind="transfer", account_kind="checking", transfer_source="manual"
        )


# --- What actually left the current account ---------------------------------

# What each slug used below is, so a test row carries the same pair a real one
# does. `interets` is the only income category here, and it is the case that
# proves the account rule does not swallow a real gain.
_KIND = {
    "epargne": "transfer",
    "virement-interne": "transfer",
    "interets": "income",
}


def _row(
    on: date,
    amount_cents: int,
    *,
    account_kind: str = "checking",
    category_slug: str | None = None,
) -> SetAsideRow:
    return SetAsideRow(
        on=on,
        amount_cents=amount_cents,
        account_kind=account_kind,
        category_root_slug=category_slug,
        category_kind=_KIND.get(category_slug) if category_slug else None,
    )


def test_a_debit_categorised_as_savings_is_money_set_aside():
    rows = [_row(date(2025, 3, 5), -30_000, category_slug="epargne")]
    assert measure_set_aside(rows) == {"2025-03": 30_000}


def test_the_same_movement_seen_from_both_sides_is_counted_once():
    """Both accounts imported: a debit on the current account and its mirror
    credit on the livret. One movement, one figure."""
    rows = [
        _row(date(2025, 3, 5), -30_000, category_slug="epargne"),
        _row(date(2025, 3, 5), 30_000, account_kind="savings", category_slug="epargne"),
    ]
    assert measure_set_aside(rows) == {"2025-03": 30_000}


def test_a_credit_from_an_account_yieldo_does_not_hold_is_still_counted():
    """No debit anywhere in the ledger to mirror it -- the source account was
    never imported. The account rule catches what the category could not."""
    rows = [_row(date(2025, 3, 12), 50_000, account_kind="savings")]
    assert measure_set_aside(rows) == {"2025-03": 50_000}


def test_a_mirror_only_pairs_within_its_own_month():
    """A debit in March and a credit in April are two movements as far as this
    measure can tell, and it says so rather than silently netting them."""
    rows = [
        _row(date(2025, 3, 28), -30_000, category_slug="epargne"),
        _row(date(2025, 4, 2), 30_000, account_kind="savings"),
    ]
    assert measure_set_aside(rows) == {"2025-03": 30_000, "2025-04": 30_000}


def test_two_identical_transfers_in_one_month_are_two_movements():
    rows = [
        _row(date(2025, 3, 5), -30_000, category_slug="epargne"),
        _row(date(2025, 3, 20), -30_000, category_slug="epargne"),
        _row(date(2025, 3, 5), 30_000, account_kind="savings", category_slug="epargne"),
        _row(date(2025, 3, 20), 30_000, account_kind="savings", category_slug="epargne"),
    ]
    assert measure_set_aside(rows) == {"2025-03": 60_000}


def test_interest_credited_on_a_livret_is_not_money_set_aside():
    """It is a gain, not a euro moved out of the current account. Categorised
    income, so neither rule takes it."""
    rows = [_row(date(2025, 3, 31), 1_250, account_kind="savings", category_slug="interets")]
    assert measure_set_aside(rows) == {}


def test_a_withdrawal_from_the_livret_reduces_what_was_set_aside():
    rows = [
        _row(date(2025, 3, 5), -30_000, category_slug="epargne"),
        _row(date(2025, 3, 20), 30_000, category_slug="epargne"),
    ]
    assert measure_set_aside(rows) == {"2025-03": 0}


def test_a_month_that_set_nothing_aside_reports_zero_and_not_a_missing_key():
    """Only for months the caller asked about: the measure has no idea which
    months the ledger covers unless it is told."""
    rows = [_row(date(2025, 3, 5), -30_000, category_slug="epargne")]
    assert measure_set_aside(rows, keys=["2025-02", "2025-03"]) == {
        "2025-02": 0,
        "2025-03": 30_000,
    }


def test_an_internal_transfer_between_two_current_accounts_is_not_savings():
    rows = [_row(date(2025, 3, 5), -30_000, category_slug="virement-interne")]
    assert measure_set_aside(rows) == {}


def test_a_transfer_between_two_savings_accounts_nets_out():
    """Out of the livret, into the PEA: the household set nothing new aside."""
    rows = [
        _row(date(2025, 3, 5), -30_000, account_kind="savings"),
        _row(date(2025, 3, 5), 30_000, account_kind="pea"),
    ]
    assert measure_set_aside(rows) == {"2025-03": 0}


# --- The two tables this engine mirrors must not drift ----------------------

def test_every_savings_account_kind_is_a_real_account_kind():
    from app.models.account import ACCOUNT_KINDS

    assert SAVINGS_ACCOUNT_KINDS <= set(ACCOUNT_KINDS)


def test_the_seed_still_ships_both_slugs_this_engine_names():
    from app.categorization.seed import CATEGORY_TREE
    from app.engines.transfer import INTERNAL_CATEGORY_SLUG, SAVINGS_CATEGORY_SLUG

    by_slug = {row[0]: row for row in CATEGORY_TREE}
    assert by_slug[SAVINGS_CATEGORY_SLUG][2] == "transfer"
    assert by_slug[INTERNAL_CATEGORY_SLUG][2] == "transfer"


def test_a_versement_filed_under_a_child_of_epargne_still_counts():
    """`epargne-livret` is a child of `epargne` and inherits its kind. The
    caller hands the root slug, so the whole subtree counts."""
    rows = [
        SetAsideRow(
            on=date(2025, 3, 5),
            amount_cents=-30_000,
            account_kind="checking",
            category_root_slug="epargne",
            category_kind="transfer",
        )
    ]
    assert measure_set_aside(rows) == {"2025-03": 30_000}
