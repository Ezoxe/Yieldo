"""`/api/portfolio`: CRUD on accounts, positions and lots, plus
`GET /api/portfolio/valuation`.

The real network is never touched: `market.providers.PROVIDERS` entries are
monkeypatched with fakes that record whether -- and how many times -- they
were actually called, the same idiom `test_connections_api.py` already
uses for `/api/connections`.
"""

from datetime import UTC, datetime, timedelta

from app.market.client import FxRate, MarketError, MarketFailureCause, Quote
from app.market.providers import PROVIDERS
from app.models import PricePoint, QuotaWindow, User


def _register(client, email="patrimoine@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


class _FakeQuoteProvider:
    def __init__(self, name, requires_key=False, quote=None, error=None):
        self.name = name
        self.requires_key = requires_key
        self._quote = quote
        self._error = error
        self.calls = 0

    def validate_key(self, api_key):  # pragma: no cover -- not exercised here
        pass

    def fetch_quote(self, symbol, api_key, *, now):
        self.calls += 1
        if self._error is not None:
            raise self._error
        return self._quote


class _FakeFxProvider:
    def __init__(self, name, requires_key=False, rate=None, error=None):
        self.name = name
        self.requires_key = requires_key
        self._rate = rate
        self._error = error
        self.calls = 0

    def validate_key(self, api_key):  # pragma: no cover
        pass

    def fetch_rate(self, base_currency, quote_currency, api_key, *, now):
        self.calls += 1
        if self._error is not None:
            raise self._error
        return self._rate


def _install_quote(monkeypatch, provider, **kwargs):
    fake = _FakeQuoteProvider(provider, **kwargs)
    monkeypatch.setitem(PROVIDERS, provider, fake)
    return fake


def _install_fx(monkeypatch, provider, **kwargs):
    fake = _FakeFxProvider(provider, **kwargs)
    monkeypatch.setitem(PROVIDERS, provider, fake)
    return fake


def _quote(symbol="AAPL", price_cents=15_000, currency="USD", source="finnhub", when=None):
    now = when or datetime.now(UTC)
    return Quote(symbol=symbol, price_cents=price_cents, currency=currency,
                as_of=now.date(), fetched_at=now, source=source)


def _fx(rate="0.90", base="USD", target="EUR", when=None):
    now = when or datetime.now(UTC)
    return FxRate(base_currency=base, quote_currency=target, rate=rate,
                 as_of=now.date(), fetched_at=now, source="frankfurter")


def _account(client, headers, name="CTO Boursorama", kind="cto"):
    return client.post(
        "/api/portfolio/accounts", headers=headers, json={"name": name, "kind": kind}
    ).json()


def _instrument(client, headers, symbol="AAPL", asset_class="equity", currency="USD",
                is_fractionable=False, name="Apple Inc."):
    return client.post(
        "/api/portfolio/instruments", headers=headers,
        json={"symbol": symbol, "name": name, "asset_class": asset_class,
              "currency": currency, "is_fractionable": is_fractionable},
    ).json()


def _position(client, headers, account_id, instrument_id):
    return client.post(
        "/api/portfolio/positions", headers=headers,
        json={"investment_account_id": account_id, "instrument_id": instrument_id},
    ).json()


def _lot(client, headers, position_id, quantity="10", unit_cost_cents=12_000,
        acquired_on="2026-01-15"):
    return client.post(
        "/api/portfolio/lots", headers=headers,
        json={"position_id": position_id, "quantity": quantity,
              "unit_cost_cents": unit_cost_cents, "acquired_on": acquired_on},
    ).json()


class TestAccountsCrud:
    def test_create_list_patch_and_archive_an_account(self, client):
        headers = _register(client)
        created = _account(client, headers, name="PEA", kind="pea")
        assert created["currency"] == "EUR"
        assert created["archived"] is False

        listed = client.get("/api/portfolio/accounts", headers=headers).json()
        assert [a["id"] for a in listed] == [created["id"]]

        patched = client.patch(
            f"/api/portfolio/accounts/{created['id']}", headers=headers,
            json={"name": "PEA Boursorama"},
        ).json()
        assert patched["name"] == "PEA Boursorama"
        assert patched["kind"] == "pea"

        assert client.delete(
            f"/api/portfolio/accounts/{created['id']}", headers=headers
        ).status_code == 204
        # Archived, not gone -- excluded from the default listing.
        assert client.get("/api/portfolio/accounts", headers=headers).json() == []

    def test_an_unknown_kind_is_refused(self, client):
        headers = _register(client)
        response = client.post(
            "/api/portfolio/accounts", headers=headers,
            json={"name": "X", "kind": "bitcoin_wallet"},
        )
        assert response.status_code == 422

    def test_patching_a_null_onto_a_not_nullable_field_is_refused(self, client):
        headers = _register(client)
        created = _account(client, headers)
        response = client.patch(
            f"/api/portfolio/accounts/{created['id']}", headers=headers, json={"name": None}
        )
        assert response.status_code == 422

    def test_a_nonexistent_account_is_404(self, client):
        headers = _register(client)
        assert client.patch(
            "/api/portfolio/accounts/999999", headers=headers, json={"name": "x"}
        ).status_code == 404
        assert client.delete("/api/portfolio/accounts/999999", headers=headers).status_code == 404


class TestInstrumentsFindOrCreate:
    def test_creating_the_same_symbol_and_asset_class_twice_returns_the_same_row(self, client):
        headers = _register(client)
        first = _instrument(client, headers, symbol="AAPL", asset_class="equity")
        second = _instrument(
            client, headers, symbol="AAPL", asset_class="equity", name="A different name",
        )
        assert first["id"] == second["id"]
        # An existing row is never edited by a second POST.
        assert second["name"] == first["name"]

    def test_the_same_symbol_under_a_different_asset_class_is_a_different_instrument(self, client):
        headers = _register(client)
        equity = _instrument(client, headers, symbol="X", asset_class="equity")
        crypto = _instrument(client, headers, symbol="X", asset_class="crypto")
        assert equity["id"] != crypto["id"]

    def test_an_unknown_asset_class_is_refused(self, client):
        headers = _register(client)
        response = client.post(
            "/api/portfolio/instruments", headers=headers,
            json={"symbol": "X", "name": "X", "asset_class": "nft", "currency": "USD"},
        )
        assert response.status_code == 422

    def test_listing_can_be_filtered_by_symbol(self, client):
        headers = _register(client)
        _instrument(client, headers, symbol="AAPL", asset_class="equity")
        _instrument(client, headers, symbol="MSFT", asset_class="equity")
        listed = client.get(
            "/api/portfolio/instruments", headers=headers, params={"symbol": "AAP"}
        ).json()
        assert [i["symbol"] for i in listed] == ["AAPL"]


class TestPositionsAndLotsCrud:
    def test_creating_a_position_requires_an_owned_account(self, client):
        headers = _register(client)
        instrument = _instrument(client, headers)
        response = client.post(
            "/api/portfolio/positions", headers=headers,
            json={"investment_account_id": 999999, "instrument_id": instrument["id"]},
        )
        assert response.status_code == 404

    def test_creating_a_position_requires_an_existing_instrument(self, client):
        headers = _register(client)
        account = _account(client, headers)
        response = client.post(
            "/api/portfolio/positions", headers=headers,
            json={"investment_account_id": account["id"], "instrument_id": 999999},
        )
        assert response.status_code == 404

    def test_a_duplicate_position_for_the_same_account_and_instrument_is_refused(self, client):
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers)
        _position(client, headers, account["id"], instrument["id"])
        response = client.post(
            "/api/portfolio/positions", headers=headers,
            json={"investment_account_id": account["id"], "instrument_id": instrument["id"]},
        )
        assert response.status_code == 422

    def test_lots_round_trip_through_create_patch_and_delete(self, client):
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers)
        position = _position(client, headers, account["id"], instrument["id"])

        lot = _lot(client, headers, position["id"], quantity="0.0050")
        assert lot["quantity"] == "0.005000000000000000"

        patched = client.patch(
            f"/api/portfolio/lots/{lot['id']}", headers=headers,
            json={"unit_cost_cents": 20_000},
        ).json()
        assert patched["unit_cost_cents"] == 20_000

        listed = client.get(
            "/api/portfolio/lots", headers=headers, params={"position_id": position["id"]}
        ).json()
        assert [row["id"] for row in listed] == [lot["id"]]

        assert client.delete(f"/api/portfolio/lots/{lot['id']}", headers=headers).status_code == 204
        assert client.get(
            "/api/portfolio/lots", headers=headers, params={"position_id": position["id"]}
        ).json() == []

    def test_creating_a_lot_requires_an_owned_position(self, client):
        headers = _register(client)
        response = client.post(
            "/api/portfolio/lots", headers=headers,
            json={"position_id": 999999, "quantity": "1", "unit_cost_cents": 100,
                  "acquired_on": "2026-01-01"},
        )
        assert response.status_code == 404

    def test_deleting_a_position_cascades_its_lots(self, client, db):
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers)
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"])

        assert client.delete(
            f"/api/portfolio/positions/{position['id']}", headers=headers
        ).status_code == 204
        from app.models import Lot
        assert db.query(Lot).filter(Lot.position_id == position["id"]).count() == 0


class TestIsolation:
    def test_another_users_accounts_positions_and_lots_are_never_visible(self, client):
        """Seeds BOB's own data first and asserts BOB's own read reflects it
        -- if the seeding step silently wrote nothing (a broken fixture, a
        rolled-back transaction), this assertion fails before the isolation
        assertion ever gets a chance to pass for the wrong reason. Only THEN
        does it check that ALICE, who never touched any of it, sees none of
        Bob's accounts, positions or lots."""
        alice = _register(client, "alice@example.fr")
        bob = _register(client, "bob@example.fr")

        bob_account = _account(client, bob, name="PEA de Bob", kind="pea")
        bob_instrument = _instrument(client, bob, symbol="AAPL", asset_class="equity")
        bob_position = _position(client, bob, bob_account["id"], bob_instrument["id"])
        bob_lot = _lot(client, bob, bob_position["id"])

        # First: the seed actually took effect for the user it was written for.
        bob_accounts = client.get("/api/portfolio/accounts", headers=bob).json()
        assert [a["id"] for a in bob_accounts] == [bob_account["id"]]
        bob_positions = client.get("/api/portfolio/positions", headers=bob).json()
        assert [p["id"] for p in bob_positions] == [bob_position["id"]]
        bob_lots = client.get("/api/portfolio/lots", headers=bob).json()
        assert [row["id"] for row in bob_lots] == [bob_lot["id"]]

        # Only now: a different user, who did nothing, sees none of it.
        assert client.get("/api/portfolio/accounts", headers=alice).json() == []
        assert client.get("/api/portfolio/positions", headers=alice).json() == []
        assert client.get("/api/portfolio/lots", headers=alice).json() == []
        assert client.get(
            "/api/portfolio/positions", headers=alice, params={"account_id": bob_account["id"]}
        ).json() == []
        assert client.patch(
            f"/api/portfolio/accounts/{bob_account['id']}", headers=alice, json={"name": "x"}
        ).status_code == 404
        assert client.delete(
            f"/api/portfolio/lots/{bob_lot['id']}", headers=alice
        ).status_code == 404

    def test_valuation_never_blends_another_users_positions(self, client, monkeypatch):
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000))
        alice = _register(client, "alice@example.fr")
        bob = _register(client, "bob@example.fr")

        bob_account = _account(client, bob)
        bob_instrument = _instrument(client, bob, symbol="AAPL", asset_class="equity",
                                     currency="EUR")
        bob_position = _position(client, bob, bob_account["id"], bob_instrument["id"])
        _lot(client, bob, bob_position["id"], quantity="10")

        bob_valuation = client.get("/api/portfolio/valuation", headers=bob).json()
        assert bob_valuation["total"]["positions_total"] == 1

        alice_valuation = client.get("/api/portfolio/valuation", headers=alice).json()
        assert alice_valuation["total"]["positions_total"] == 0
        assert alice_valuation["total"]["market_value_cents"] == 0


class TestValuation:
    def test_an_empty_portfolio_reads_as_a_definite_zero(self, client):
        headers = _register(client)
        body = client.get("/api/portfolio/valuation", headers=headers).json()
        assert body["total"] == {
            "market_value_cents": 0, "cost_basis_cents": 0, "unrealised_gain_cents": 0,
            "positions_total": 0, "positions_valued": 0, "positions_missing_price": 0,
            "positions_missing_fx": 0,
        }
        assert body["positions"] == []

    def test_a_position_priced_in_the_reporting_currency_is_valued_from_the_fetched_quote(
        self, client, monkeypatch,
    ):
        fake = _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=15_000))
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers, currency="EUR")
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="10", unit_cost_cents=12_000)

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["market_value_cents"] == 150_000
        assert pv["cost_basis_cents"] == 120_000
        assert pv["unrealised_gain_cents"] == 30_000
        assert pv["price"]["is_stale"] is False
        assert body["total"]["market_value_cents"] == 150_000
        assert fake.calls == 1

    def test_a_missing_price_is_never_cost_or_zero_and_names_its_cause(self, client, monkeypatch):
        """The wire-level version of Task 7's own headline rule: a position
        whose price could not be fetched carries `market_value_cents: null`,
        never its cost basis and never zero."""
        _install_quote(
            monkeypatch, "finnhub",
            error=MarketError(
                MarketFailureCause.NO_KEY, "Aucune clé n'est enregistrée pour Finnhub."
            ),
        )
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers, currency="EUR")
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="10", unit_cost_cents=12_000)

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["market_value_cents"] is None
        assert pv["unrealised_gain_cents"] is None
        assert "Aucune clé" in pv["price_unavailable_reason"]
        assert pv["cost_basis_cents"] == 120_000  # still known -- it needs no price
        assert body["total"]["market_value_cents"] == 0
        assert body["total"]["positions_missing_price"] == 1
        assert body["total"]["positions_valued"] == 0

    def test_a_stale_cached_price_is_returned_with_its_timestamp_rather_than_dropped(
        self, client, monkeypatch, db,
    ):
        """The other half of the missing-vs-stale distinction: when a fresh
        fetch fails but an OLD price is on record, the position is valued at
        that stale price -- `is_stale: true` -- never at None. A wrong
        implementation that only ever calls the provider fresh (no cache at
        all) cannot produce this outcome; one that always prefers the cache
        over a fresh attempt would never even try the provider, which the
        `fake.calls == 1` assertion below rules out."""
        fake = _install_quote(
            monkeypatch, "finnhub",
            error=MarketError(MarketFailureCause.SERVICE_UNREACHABLE,
                              "Le service Finnhub est injoignable pour le moment."),
        )
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers, currency="EUR")
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="10", unit_cost_cents=12_000)

        stale_fetch = datetime.now(UTC) - timedelta(hours=2)
        db.add(PricePoint(
            instrument_id=instrument["id"], as_of=stale_fetch.date(), price_cents=13_370,
            source="finnhub", fetched_at=stale_fetch,
        ))
        db.commit()

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["price"]["is_stale"] is True
        assert pv["price"]["price_cents"] == 13_370
        assert pv["market_value_cents"] == 133_700
        assert pv["price_unavailable_reason"] is None
        assert body["total"]["positions_valued"] == 1
        assert body["total"]["positions_missing_price"] == 0
        assert fake.calls == 1  # a fresh attempt genuinely was made and failed

    def test_a_fresh_cached_price_is_reused_without_calling_the_provider_again(
        self, client, monkeypatch, db,
    ):
        def _must_not_be_called(_symbol, _api_key, *, now):
            raise AssertionError("must not call the provider while the cache is still fresh")

        fake = _install_quote(monkeypatch, "finnhub")
        fake.fetch_quote = _must_not_be_called
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers, currency="EUR")
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="10", unit_cost_cents=12_000)

        fresh_fetch = datetime.now(UTC) - timedelta(minutes=1)  # well under the 5-minute TTL
        db.add(PricePoint(
            instrument_id=instrument["id"], as_of=fresh_fetch.date(), price_cents=20_000,
            source="finnhub", fetched_at=fresh_fetch,
        ))
        db.commit()

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["price"]["is_stale"] is False
        assert pv["market_value_cents"] == 200_000

    def test_quota_exhausted_refuses_before_the_provider_is_ever_called(
        self, client, monkeypatch, db,
    ):
        fake = _install_quote(monkeypatch, "finnhub")

        def _must_not_be_called(_symbol, _api_key, *, now):
            raise AssertionError("must not call the provider once the pool is at its ceiling")
        fake.fetch_quote = _must_not_be_called

        headers = _register(client)
        user = db.query(User).filter(User.email == "patrimoine@example.fr").first()
        now = datetime.now(UTC).replace(second=0, microsecond=0)
        db.add(QuotaWindow(user_id=user.id, provider="finnhub", window_started_at=now, used=48))
        db.commit()

        account = _account(client, headers)
        instrument = _instrument(client, headers, currency="EUR")
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="10", unit_cost_cents=12_000)

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["market_value_cents"] is None
        assert "quota" in pv["price_unavailable_reason"]
        assert "épuisé" in pv["price_unavailable_reason"]

    def test_a_cash_position_is_valued_at_par_without_calling_any_provider(
        self, client, monkeypatch,
    ):
        fake = _install_quote(monkeypatch, "finnhub")

        def _must_not_be_called(_symbol, _api_key, *, now):
            raise AssertionError("cash needs no provider at all")
        fake.fetch_quote = _must_not_be_called

        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(
            client, headers, symbol="EUR", asset_class="cash", currency="EUR", name="Espèces",
        )
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="1000", unit_cost_cents=100)

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["market_value_cents"] == 100_000  # 1 000 units at 1,00/unit

    def test_a_zero_quantity_position_is_valued_at_zero_without_calling_any_provider(
        self, client, monkeypatch,
    ):
        fake = _install_quote(monkeypatch, "finnhub")

        def _must_not_be_called(_symbol, _api_key, *, now):
            raise AssertionError("a position worth zero needs no price fetched at all")
        fake.fetch_quote = _must_not_be_called

        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers, currency="EUR")
        _position(client, headers, account["id"], instrument["id"])
        # No lot at all -- a position that exists but was never funded.

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["market_value_cents"] == 0
        assert body["total"]["positions_valued"] == 1
        assert body["total"]["positions_missing_price"] == 0

    def test_two_currencies_are_blended_via_the_fetched_fx_rate(self, client, monkeypatch):
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000, currency="EUR"))
        fx = _install_fx(monkeypatch, "frankfurter", rate=_fx(rate="0.5"))

        headers = _register(client)
        account = _account(client, headers)

        eur_instrument = _instrument(client, headers, symbol="EURCO", currency="EUR")
        eur_position = _position(client, headers, account["id"], eur_instrument["id"])
        _lot(client, headers, eur_position["id"], quantity="1", unit_cost_cents=10_000)

        usd_instrument = _instrument(client, headers, symbol="USDCO", currency="USD")
        usd_position = _position(client, headers, account["id"], usd_instrument["id"])
        _lot(client, headers, usd_position["id"], quantity="1", unit_cost_cents=10_000)

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        usd_pv = next(p for p in body["positions"] if p["symbol"] == "USDCO")
        assert usd_pv["market_value_cents"] == 10_000  # native, unconverted
        assert usd_pv["market_value_reporting_cents"] == 5_000  # 10 000 * 0,5
        assert body["total"]["market_value_cents"] == 10_000 + 5_000
        assert fx.calls == 1  # one call covers every USD position in this request

    def test_a_known_price_with_no_fx_rate_is_missing_fx_not_missing_price(
        self, client, monkeypatch,
    ):
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000, currency="USD"))
        _install_fx(
            monkeypatch, "frankfurter",
            error=MarketError(MarketFailureCause.SERVICE_UNREACHABLE,
                              "Le service Frankfurter est injoignable pour le moment."),
        )
        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(client, headers, currency="USD")
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="1", unit_cost_cents=10_000)

        body = client.get("/api/portfolio/valuation", headers=headers).json()
        [pv] = body["positions"]
        assert pv["market_value_cents"] == 10_000  # native value still known
        assert pv["market_value_reporting_cents"] is None
        assert "Frankfurter" in pv["fx_unavailable_reason"]
        assert body["total"]["positions_missing_fx"] == 1
        assert body["total"]["positions_missing_price"] == 0

    def test_valuation_requires_authentication(self, client):
        assert client.get("/api/portfolio/valuation").status_code == 401
