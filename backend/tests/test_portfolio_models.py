"""ORM shapes for phase 3's substrate: instruments, investment accounts,
positions, lots, price points, api keys, quota windows.

Two things this file exists to prove, beyond the usual round-trip checks:

* **A position never carries a quantity or a total** -- it is genuinely
  derived from its lots, summed at read time, not a cached column that could
  drift from them.
* **`instruments`, `price_points`, `api_keys` and `quota_windows` carry no
  `user_id`** -- a deliberate exception to the isolation rule every other
  table in this app follows, documented on each model. The cascade test
  below is the one that actually proves it: deleting a user must take their
  own investment accounts, positions and lots with it, and must NOT touch
  the shared market data or the installation's provider credentials.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.engines import quantity
from app.models import (
    ApiKey,
    Instrument,
    InvestmentAccount,
    Lot,
    Position,
    PricePoint,
    QuotaWindow,
    User,
)
from app.security.crypto import decrypt_secret, encrypt_secret


def _user(db, email="patrimoine@example.com") -> User:
    user = User(email=email, name="Max", password_hash="x")
    db.add(user)
    db.commit()
    return user


def _instrument(db, symbol="AAPL", asset_class="equity") -> Instrument:
    instrument = Instrument(
        symbol=symbol, name="Apple Inc.", asset_class=asset_class, currency="USD"
    )
    db.add(instrument)
    db.commit()
    return instrument


def test_an_investment_account_belongs_to_a_user_and_defaults_to_euro(db):
    user = _user(db)
    account = InvestmentAccount(user_id=user.id, name="PEA Boursorama", kind="pea")
    db.add(account)
    db.commit()
    assert account.currency == "EUR"
    assert account.archived is False
    assert account.opened_on is None


def test_a_position_links_one_account_to_one_instrument_and_stores_no_quantity(db):
    """The whole point of Task 2's design: a position row is just the
    (account, instrument) identity. There is no quantity/total column to
    inspect here -- if there were, this test would need to assert it stayed
    in sync with the lots, which is exactly the drift the design forbids."""
    user = _user(db)
    account = InvestmentAccount(user_id=user.id, name="CTO", kind="cto")
    db.add(account)
    db.commit()
    instrument = _instrument(db)

    position = Position(
        user_id=user.id, investment_account_id=account.id, instrument_id=instrument.id
    )
    db.add(position)
    db.commit()

    assert not hasattr(position, "quantity")
    assert not hasattr(position, "total_cents")


def test_a_position_is_unique_per_account_and_instrument(db):
    user = _user(db)
    account = InvestmentAccount(user_id=user.id, name="CTO", kind="cto")
    db.add(account)
    db.commit()
    instrument = _instrument(db)

    db.add(Position(user_id=user.id, investment_account_id=account.id,
                    instrument_id=instrument.id))
    db.commit()
    db.add(Position(user_id=user.id, investment_account_id=account.id,
                    instrument_id=instrument.id))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_lot_stores_a_quantity_string_that_survives_the_round_trip(db):
    """The exact case Task 1 exists for: a fractional crypto amount, stored
    and read back through the ORM as a string, never touching a float or a
    Numeric column anywhere on the path."""
    user = _user(db)
    account = InvestmentAccount(user_id=user.id, name="Kraken", kind="crypto_exchange")
    db.add(account)
    db.commit()
    instrument = _instrument(db, symbol="BTC", asset_class="crypto")
    position = Position(user_id=user.id, investment_account_id=account.id,
                        instrument_id=instrument.id)
    db.add(position)
    db.commit()

    q = quantity.parse("0.000000015")
    lot = Lot(user_id=user.id, position_id=position.id, quantity=str(q),
              unit_cost_cents=6_000_000_000, acquired_on=date(2026, 1, 15))
    db.add(lot)
    db.commit()
    db.refresh(lot)

    assert quantity.parse(lot.quantity) == q
    assert lot.quantity == "0.000000015000000000"


def test_two_lots_summed_reproduce_the_position_s_holding(db):
    """Nothing computes this automatically at the ORM layer -- that is
    Task 7's job -- but proves the shape supports it: summing lots' parsed
    quantities is the only way to know what a position holds."""
    user = _user(db)
    account = InvestmentAccount(user_id=user.id, name="CTO", kind="cto")
    db.add(account)
    db.commit()
    instrument = _instrument(db)
    position = Position(user_id=user.id, investment_account_id=account.id,
                        instrument_id=instrument.id)
    db.add(position)
    db.commit()
    db.add_all([
        Lot(user_id=user.id, position_id=position.id, quantity="5",
            unit_cost_cents=15_000, acquired_on=date(2025, 1, 1)),
        Lot(user_id=user.id, position_id=position.id, quantity="3",
            unit_cost_cents=17_000, acquired_on=date(2025, 6, 1)),
    ])
    db.commit()

    lots = db.query(Lot).filter(Lot.position_id == position.id).all()
    total = sum((quantity.parse(lot.quantity) for lot in lots), start=quantity.parse("0"))
    assert total == quantity.parse("8")


def test_deleting_an_instrument_still_referenced_by_a_position_is_refused(db):
    user = _user(db)
    account = InvestmentAccount(user_id=user.id, name="CTO", kind="cto")
    db.add(account)
    db.commit()
    instrument = _instrument(db)
    db.add(Position(user_id=user.id, investment_account_id=account.id,
                    instrument_id=instrument.id))
    db.commit()

    db.delete(instrument)
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_price_point_is_unique_per_instrument_and_day(db):
    instrument = _instrument(db)
    db.add(PricePoint(instrument_id=instrument.id, as_of=date(2026, 1, 15),
                      price_cents=19_034, source="finnhub",
                      fetched_at=datetime.now(UTC)))
    db.commit()
    db.add(PricePoint(instrument_id=instrument.id, as_of=date(2026, 1, 15),
                      price_cents=19_100, source="finnhub",
                      fetched_at=datetime.now(UTC)))
    with pytest.raises(IntegrityError):
        db.commit()


def test_an_api_key_stores_the_encrypted_value_not_the_plaintext(db):
    """The model itself does not encrypt -- that is the caller's job (Task 6)
    -- but it must round-trip whatever ciphertext it is handed, and the raw
    column value must never equal the plaintext secret."""
    ciphertext = encrypt_secret("finnhub-live-key-abc123")
    key = ApiKey(provider="finnhub", value=ciphertext)
    db.add(key)
    db.commit()
    db.refresh(key)

    assert key.value != "finnhub-live-key-abc123"
    assert decrypt_secret(key.value) == "finnhub-live-key-abc123"
    assert key.last_used_at is None
    assert key.created_at is not None


def test_an_api_key_is_unique_per_provider(db):
    db.add(ApiKey(provider="finnhub", value=encrypt_secret("a")))
    db.commit()
    db.add(ApiKey(provider="finnhub", value=encrypt_secret("b")))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_quota_window_defaults_to_zero_used_and_is_unique_per_provider(db):
    window = QuotaWindow(provider="alpha_vantage", window_started_at=datetime.now(UTC))
    db.add(window)
    db.commit()
    assert window.used == 0

    db.add(QuotaWindow(provider="alpha_vantage", window_started_at=datetime.now(UTC)))
    with pytest.raises(IntegrityError):
        db.commit()


def test_deleting_a_user_takes_their_investment_accounts_positions_and_lots_but_not_market_data(db):
    user = _user(db)
    account = InvestmentAccount(user_id=user.id, name="CTO", kind="cto")
    db.add(account)
    db.commit()
    instrument = _instrument(db)
    position = Position(user_id=user.id, investment_account_id=account.id,
                        instrument_id=instrument.id)
    db.add(position)
    db.commit()
    db.add(Lot(user_id=user.id, position_id=position.id, quantity="1",
              unit_cost_cents=100, acquired_on=date(2026, 1, 1)))
    db.add(ApiKey(provider="finnhub", value=encrypt_secret("k")))
    db.add(QuotaWindow(provider="finnhub", window_started_at=datetime.now(UTC)))
    db.commit()

    db.delete(user)
    db.commit()

    assert db.query(InvestmentAccount).count() == 0
    assert db.query(Position).count() == 0
    assert db.query(Lot).count() == 0
    # Shared market data and installation-level credentials are untouched --
    # they never referenced the deleted user in the first place.
    assert db.query(Instrument).count() == 1
    assert db.query(ApiKey).count() == 1
    assert db.query(QuotaWindow).count() == 1
