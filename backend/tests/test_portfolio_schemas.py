"""`app/schemas/portfolio.py`, exercised directly against pydantic -- there is
no `/api/portfolio` router yet (that is Task 9), so these tests validate the
schemas the way `test_patch_nulls.py` validates the ones that DO have a
router: by checking `pydantic.ValidationError`'s own `errors()[*]['type']`
rather than the French-rewritten HTTP body (`app/api/errors.py` only rewrites
messages inside FastAPI's own request-validation exception handler, which a
bare `Model.model_validate()` call never goes through).
"""

import pytest
from pydantic import ValidationError

from app.schemas.portfolio import (
    InvestmentAccountIn,
    InvestmentAccountPatch,
    LotIn,
    LotPatch,
    PositionIn,
)


class TestInvestmentAccountPatchNulls:
    @pytest.mark.parametrize("field", ["name", "kind", "currency", "archived"])
    def test_a_not_null_field_cannot_be_patched_to_null(self, field):
        with pytest.raises(ValidationError) as exc:
            InvestmentAccountPatch.model_validate({field: None})
        assert exc.value.errors()[0]["type"] == "null_not_allowed"

    def test_opened_on_can_still_be_cleared(self):
        """The one nullable column on InvestmentAccount -- the guard is
        per-field, not blanket, exactly like DebtPatch's term_months."""
        patch = InvestmentAccountPatch.model_validate({"opened_on": None})
        assert patch.opened_on is None

    def test_omitting_a_field_leaves_it_untouched(self):
        patch = InvestmentAccountPatch.model_validate({"name": "PEA"})
        assert patch.kind is None
        assert patch.archived is None


class TestInvestmentAccountIn:
    def test_currency_defaults_to_euro(self):
        account = InvestmentAccountIn(name="PEA Boursorama", kind="pea")
        assert account.currency == "EUR"


class TestPositionIn:
    def test_requires_both_foreign_keys(self):
        with pytest.raises(ValidationError):
            PositionIn.model_validate({"investment_account_id": 1})


class TestLotInQuantity:
    def test_a_positive_quantity_is_accepted(self):
        lot = LotIn(position_id=1, quantity="0.000000015", unit_cost_cents=100,
                    acquired_on="2026-01-15")
        assert lot.quantity == "0.000000015000000000"

    def test_the_quantity_is_normalised_to_its_canonical_eighteen_decimal_form(self):
        lot = LotIn(position_id=1, quantity="0.0050", unit_cost_cents=100,
                    acquired_on="2026-01-15")
        assert lot.quantity == "0.005000000000000000"

    def test_a_whole_share_count_is_accepted(self):
        lot = LotIn(position_id=1, quantity="12", unit_cost_cents=15_000,
                    acquired_on="2026-01-15")
        assert lot.quantity == "12.000000000000000000"

    def test_a_zero_quantity_is_refused(self):
        """A lot is an acquisition -- design's own words, Task 2's brief.
        Zero units acquired is not an acquisition."""
        with pytest.raises(ValidationError):
            LotIn(position_id=1, quantity="0", unit_cost_cents=100, acquired_on="2026-01-15")

    def test_a_negative_quantity_is_refused(self):
        with pytest.raises(ValidationError):
            LotIn(position_id=1, quantity="-1", unit_cost_cents=100, acquired_on="2026-01-15")

    def test_unparseable_text_is_refused(self):
        with pytest.raises(ValidationError):
            LotIn(position_id=1, quantity="douze", unit_cost_cents=100,
                  acquired_on="2026-01-15")

    def test_a_float_is_refused(self):
        """The wire type is `str`; pydantic itself rejects a JSON number
        here before engines.quantity ever sees it."""
        with pytest.raises(ValidationError):
            LotIn(position_id=1, quantity=0.000000015, unit_cost_cents=100,  # type: ignore[arg-type]
                  acquired_on="2026-01-15")

    def test_a_negative_unit_cost_is_refused(self):
        with pytest.raises(ValidationError):
            LotIn(position_id=1, quantity="1", unit_cost_cents=-1, acquired_on="2026-01-15")

    def test_a_zero_unit_cost_is_accepted(self):
        """A gifted or inherited lot can legitimately carry no cost basis --
        matching how `DebtPatch.principal_cents` allows a debt that has just
        reached zero."""
        lot = LotIn(position_id=1, quantity="1", unit_cost_cents=0, acquired_on="2026-01-15")
        assert lot.unit_cost_cents == 0


class TestLotPatchNulls:
    @pytest.mark.parametrize("field", ["quantity", "unit_cost_cents", "acquired_on"])
    def test_every_field_refuses_an_explicit_null(self, field):
        """Lot has no nullable column at all -- every patchable field is
        guarded, unlike InvestmentAccountPatch's opened_on exception."""
        with pytest.raises(ValidationError) as exc:
            LotPatch.model_validate({field: None})
        assert exc.value.errors()[0]["type"] == "null_not_allowed"

    def test_a_provided_quantity_is_still_validated_and_normalised(self):
        patch = LotPatch.model_validate({"quantity": "0.005"})
        assert patch.quantity == "0.005000000000000000"

    def test_a_provided_zero_quantity_is_still_refused(self):
        with pytest.raises(ValidationError):
            LotPatch.model_validate({"quantity": "0"})

    def test_omitting_quantity_leaves_it_untouched(self):
        patch = LotPatch.model_validate({"unit_cost_cents": 500})
        assert patch.quantity is None
