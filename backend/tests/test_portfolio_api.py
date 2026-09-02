"""`/api/portfolio`: CRUD on accounts, positions and lots, plus
`GET /api/portfolio/valuation`.

The real network is never touched: `market.providers.PROVIDERS` entries are
monkeypatched with fakes that record whether -- and how many times -- they
were actually called, the same idiom `test_connections_api.py` already
uses for `/api/connections`.
"""

from datetime import UTC, datetime, timedelta

from app.engines import quantity
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


class TestArchivedAccounts:
    def test_an_archived_accounts_position_no_longer_counts_toward_the_valuation(
        self, client, monkeypatch,
    ):
        """Archiving is how the operator says an envelope is no longer part of
        his patrimoine. `_valuation_inputs` must exclude it, not just `GET
        /accounts` -- a wrong implementation that only hides the account from
        the list but keeps summing its positions would still pass a fixture
        that never re-checks the total after archiving, which is exactly why
        this test asserts the total before AND after, and asserts the whole
        position vanishes from `positions` rather than merely reads zero."""
        fake = _install_quote(monkeypatch, "finnhub")

        def _must_not_be_called(_symbol, _api_key, *, now):
            raise AssertionError("an archived account's position needs no price fetched")
        fake.fetch_quote = _must_not_be_called

        headers = _register(client)
        account = _account(client, headers)
        instrument = _instrument(
            client, headers, symbol="EUR", asset_class="cash", currency="EUR", name="Espèces",
        )
        position = _position(client, headers, account["id"], instrument["id"])
        _lot(client, headers, position["id"], quantity="1000", unit_cost_cents=100)

        before = client.get("/api/portfolio/valuation", headers=headers).json()
        assert before["total"]["market_value_cents"] == 100_000
        assert before["total"]["positions_total"] == 1

        assert client.delete(
            f"/api/portfolio/accounts/{account['id']}", headers=headers
        ).status_code == 204

        after = client.get("/api/portfolio/valuation", headers=headers).json()
        assert after["positions"] == []
        assert after["total"] == {
            "market_value_cents": 0, "cost_basis_cents": 0, "unrealised_gain_cents": 0,
            "positions_total": 0, "positions_valued": 0, "positions_missing_price": 0,
            "positions_missing_fx": 0,
        }

    def test_archived_accounts_are_hidden_by_default_but_listed_and_restorable_on_request(
        self, client,
    ):
        """The un-archive path: without a way to list an archived account's
        own id, `archived: bool | None` on `InvestmentAccountPatch` is
        reachable in principle but unusable in practice -- there is no way to
        learn which id to PATCH. `?archived=true` is that way back."""
        headers = _register(client)
        account = _account(client, headers, name="PEA", kind="pea")
        assert client.delete(
            f"/api/portfolio/accounts/{account['id']}", headers=headers
        ).status_code == 204
        assert client.get("/api/portfolio/accounts", headers=headers).json() == []

        archived = client.get(
            "/api/portfolio/accounts", headers=headers, params={"archived": "true"}
        ).json()
        assert [a["id"] for a in archived] == [account["id"]]
        assert archived[0]["archived"] is True

        restored = client.patch(
            f"/api/portfolio/accounts/{account['id']}", headers=headers,
            json={"archived": False},
        ).json()
        assert restored["archived"] is False

        listed = client.get("/api/portfolio/accounts", headers=headers).json()
        assert [a["id"] for a in listed] == [account["id"]]
        assert client.get(
            "/api/portfolio/accounts", headers=headers, params={"archived": "true"}
        ).json() == []


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


# --- Allocation targets, drift and the proposed trades (plan Task 8, wired
# --- onto this router by Task 10).


def _put_targets(client, headers, targets):
    return client.put(
        "/api/portfolio/targets", headers=headers,
        json={"targets": [{"asset_class": a, "target_bps": b} for a, b in targets]},
    )


def _holding(client, headers, account_id, symbol, asset_class, quantity,
             currency="EUR", is_fractionable=False, unit_cost_cents=10_000):
    """One instrument, one position, one lot -- the three calls every
    allocation case below needs before there is anything to drift."""
    instrument = _instrument(client, headers, symbol=symbol, asset_class=asset_class,
                             currency=currency, is_fractionable=is_fractionable,
                             name=f"{symbol} test")
    position = _position(client, headers, account_id, instrument["id"])
    _lot(client, headers, position["id"], quantity=quantity, unit_cost_cents=unit_cost_cents)
    return position


class TestAllocationTargets:
    def test_a_user_who_has_declared_nothing_has_no_targets(self, client):
        headers = _register(client)
        assert client.get("/api/portfolio/targets", headers=headers).json() == []

    def test_targets_summing_to_one_hundred_percent_are_stored_and_read_back(self, client):
        headers = _register(client)
        stored = _put_targets(client, headers, [("equity", 6_000), ("crypto", 4_000)])
        assert stored.status_code == 200
        assert [(t["asset_class"], t["target_bps"]) for t in stored.json()] == [
            ("crypto", 4_000), ("equity", 6_000),
        ]
        read_back = client.get("/api/portfolio/targets", headers=headers).json()
        assert [(t["asset_class"], t["target_bps"]) for t in read_back] == [
            ("crypto", 4_000), ("equity", 6_000),
        ]

    def test_a_second_put_replaces_the_whole_set_rather_than_merging_into_it(self, client):
        headers = _register(client)
        _put_targets(client, headers, [("equity", 6_000), ("crypto", 4_000)])
        _put_targets(client, headers, [("etf", 10_000)])
        assert [
            (t["asset_class"], t["target_bps"])
            for t in client.get("/api/portfolio/targets", headers=headers).json()
        ] == [("etf", 10_000)]

    def test_an_empty_list_clears_the_targets(self, client):
        headers = _register(client)
        _put_targets(client, headers, [("equity", 10_000)])
        assert _put_targets(client, headers, []).json() == []
        assert client.get("/api/portfolio/targets", headers=headers).json() == []

    def test_targets_that_do_not_sum_to_one_hundred_are_refused_in_the_engines_own_words(
        self, client,
    ):
        headers = _register(client)
        response = _put_targets(client, headers,
                                [("equity", 4_500), ("crypto", 4_500), ("etf", 2_000)])
        assert response.status_code == 422
        assert "110,00 %" in response.json()["detail"]
        # And nothing was stored: a refused set must never half-land.
        assert client.get("/api/portfolio/targets", headers=headers).json() == []

    def test_the_same_asset_class_twice_is_refused(self, client):
        headers = _register(client)
        response = _put_targets(client, headers, [("equity", 5_000), ("equity", 5_000)])
        assert response.status_code == 422
        assert "plus d'une allocation cible" in response.json()["detail"]

    def test_an_unknown_asset_class_is_refused_before_the_engine_ever_sees_it(self, client):
        headers = _register(client)
        response = _put_targets(client, headers, [("actions", 10_000)])
        assert response.status_code == 422
        assert "Classe d'actifs inconnue" in response.json()["detail"]

    def test_a_target_outside_zero_to_one_hundred_percent_is_refused(self, client):
        headers = _register(client)
        assert _put_targets(client, headers, [("equity", 12_000)]).status_code == 422

    def test_targets_require_authentication(self, client):
        assert client.get("/api/portfolio/targets").status_code == 401
        assert client.put("/api/portfolio/targets", json={"targets": []}).status_code == 401


class TestAllocation:
    def test_without_targets_the_report_is_absent_and_a_french_sentence_says_why(self, client):
        headers = _register(client)
        response = client.get("/api/portfolio/allocation", headers=headers)
        # A refusal, not a failure: 200, with the reason as content.
        assert response.status_code == 200
        body = response.json()
        assert body["report"] is None
        assert body["targets"] == []
        assert "Aucune allocation cible" in body["unavailable_reason"]
        assert body["reporting_currency"] == "EUR"

    def test_drift_and_two_trades_one_whole_unit_and_one_fractional(self, client, monkeypatch):
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000, currency="EUR"))
        _install_quote(monkeypatch, "coingecko",
                       quote=_quote(symbol="BTC", price_cents=40_000, currency="EUR",
                                    source="coingecko"))
        headers = _register(client)
        account = _account(client, headers)
        # 6 x 100,00 EUR of equity; 1 x 400,00 EUR of crypto. Two providers, two
        # different prices: a fixture of identical values could not tell a
        # per-class drift from a per-instrument one.
        _holding(client, headers, account["id"], "AAPL", "equity", "6")
        _holding(client, headers, account["id"], "BTC", "crypto", "1", is_fractionable=True)
        _put_targets(client, headers, [("equity", 5_000), ("crypto", 5_000)])

        body = client.get("/api/portfolio/allocation", headers=headers).json()
        report = body["report"]
        assert report["total_value_cents"] == 100_000
        assert report["holdings_total"] == 2
        assert report["holdings_valued"] == 2

        drifts = {d["asset_class"]: d for d in report["drifts"]}
        assert drifts["equity"]["current_bps"] == 6_000
        assert drifts["equity"]["drift_bps"] == 1_000  # overweight
        assert drifts["equity"]["drift_cents"] == -10_000
        assert drifts["crypto"]["current_bps"] == 4_000
        assert drifts["crypto"]["drift_cents"] == 10_000

        trades = {t["symbol"]: t for t in report["trades"]}
        assert trades["AAPL"]["action"] == "sell"
        # A whole unit, because AAPL is not fractionable -- and a QUANTITY, so
        # it travels as TEXT at `engines.quantity`'s canonical 18-decimal
        # scale, never through a money field. The literal string is asserted
        # as well as the parsed value: it is the wire contract the screen has
        # to render from, and a screen that fed it to a money formatter would
        # print a number a thousand billion times too large.
        assert trades["AAPL"]["quantity"] == "1.000000000000000000"
        assert quantity.parse(trades["AAPL"]["quantity"]).value == 1
        assert trades["AAPL"]["estimated_value_cents"] == 10_000
        assert trades["BTC"]["action"] == "buy"
        assert trades["BTC"]["quantity"] == "0.250000000000000000"
        assert report["refusals"] == []

    def test_a_drift_smaller_than_one_whole_unit_is_refused_rather_than_sized_at_zero(
        self, client, monkeypatch,
    ):
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=100_000, currency="EUR"))
        _install_quote(monkeypatch, "coingecko",
                       quote=_quote(symbol="BTC", price_cents=1_000, currency="EUR",
                                    source="coingecko"))
        headers = _register(client)
        account = _account(client, headers)
        _holding(client, headers, account["id"], "AAPL", "equity", "1")
        _holding(client, headers, account["id"], "BTC", "crypto", "1", is_fractionable=True)
        _put_targets(client, headers, [("equity", 9_900), ("crypto", 100)])

        report = client.get("/api/portfolio/allocation", headers=headers).json()["report"]
        assert [t["symbol"] for t in report["trades"]] == ["BTC"]
        [refusal] = [r for r in report["refusals"] if r["symbol"] == "AAPL"]
        assert "pas fractionnable" in refusal["reason"]
        assert "moins d'une unité" in refusal["reason"]
        assert "Aucun ordre" in refusal["reason"]

    def test_a_holding_whose_price_is_missing_is_excluded_and_its_class_refuses_a_trade(
        self, client, monkeypatch,
    ):
        _install_quote(monkeypatch, "finnhub",
                       error=MarketError(MarketFailureCause.NO_KEY,
                                         "Aucune cle n'est enregistree pour Finnhub."))
        _install_quote(monkeypatch, "coingecko",
                       quote=_quote(symbol="BTC", price_cents=40_000, currency="EUR",
                                    source="coingecko"))
        headers = _register(client)
        account = _account(client, headers)
        _holding(client, headers, account["id"], "AAPL", "equity", "6")
        _holding(client, headers, account["id"], "BTC", "crypto", "1", is_fractionable=True)
        _put_targets(client, headers, [("equity", 5_000), ("crypto", 5_000)])

        report = client.get("/api/portfolio/allocation", headers=headers).json()["report"]
        # Only what could be valued drifts at all -- the crypto holding is the
        # whole of the known total, so equity reads 0 % of 400,00 EUR.
        assert report["holdings_total"] == 2
        assert report["holdings_valued"] == 1
        assert report["total_value_cents"] == 40_000
        drifts = {d["asset_class"]: d for d in report["drifts"]}
        assert drifts["equity"]["current_value_cents"] == 0
        [refusal] = [r for r in report["refusals"] if r["asset_class"] == "equity"]
        assert refusal["symbol"] == ""
        assert "Aucun instrument avec un prix connu" in refusal["reason"]

    def test_the_report_carries_the_valuation_completeness_beside_the_total(
        self, client, monkeypatch,
    ):
        """`holdings_total`/`holdings_valued` are the allocation's own version
        of `positions_total`/`positions_valued`, and the two must agree -- a
        screen printing one number from each would contradict itself."""
        _install_quote(monkeypatch, "finnhub",
                       error=MarketError(MarketFailureCause.NO_KEY, "Aucune cle."))
        headers = _register(client)
        account = _account(client, headers)
        _holding(client, headers, account["id"], "AAPL", "equity", "6")
        _put_targets(client, headers, [("equity", 10_000)])

        allocation = client.get("/api/portfolio/allocation", headers=headers).json()
        valuation = client.get("/api/portfolio/valuation", headers=headers).json()
        assert allocation["report"]["holdings_total"] == valuation["total"]["positions_total"]
        assert allocation["report"]["holdings_valued"] == valuation["total"]["positions_valued"]

    def test_a_foreign_currency_holding_is_sized_against_its_reporting_price(
        self, client, monkeypatch,
    ):
        """The engine trades against a REPORTING-currency unit price. A USD
        instrument at 100,00 USD and a rate of 0,90 is 90,00 EUR per unit --
        sizing against the native 100,00 would propose the wrong quantity."""
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000, currency="USD"))
        _install_fx(monkeypatch, "frankfurter", rate=_fx(rate="0.90"))
        _install_quote(monkeypatch, "coingecko",
                       quote=_quote(symbol="BTC", price_cents=9_000, currency="EUR",
                                    source="coingecko"))
        headers = _register(client)
        account = _account(client, headers)
        # 10 x 90,00 EUR = 900,00 EUR of equity, 1 x 90,00 EUR of crypto.
        _holding(client, headers, account["id"], "AAPL", "equity", "10", currency="USD")
        _holding(client, headers, account["id"], "BTC", "crypto", "1", is_fractionable=True)
        _put_targets(client, headers, [("equity", 8_000), ("crypto", 2_000)])

        report = client.get("/api/portfolio/allocation", headers=headers).json()["report"]
        assert report["total_value_cents"] == 99_000
        trades = {t["symbol"]: t for t in report["trades"]}
        # Target equity 79 200, current 90 000: sell 10 800 cents at 90,00 EUR
        # a unit = 1,2 units, rounded to 1 whole unit (AAPL is not fractionable).
        assert trades["AAPL"]["action"] == "sell"
        assert quantity.parse(trades["AAPL"]["quantity"]).value == 1
        assert trades["AAPL"]["estimated_value_cents"] == 9_000

    def test_allocation_requires_authentication(self, client):
        assert client.get("/api/portfolio/allocation").status_code == 401


class TestAllocationIsolation:
    def test_another_users_targets_and_allocation_are_never_visible(self, client, monkeypatch):
        """Seeds BOB and asserts BOB's OWN reads reflect the seed FIRST -- if
        the seeding step silently wrote nothing (a broken fixture, a rolled-back
        transaction), this fails here rather than letting the isolation
        assertions below pass for the wrong reason. Only then does it check
        that ALICE, who declared nothing, sees none of it."""
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000, currency="EUR"))
        alice = _register(client, "alice@example.fr")
        bob = _register(client, "bob@example.fr")

        bob_account = _account(client, bob, name="PEA de Bob", kind="pea")
        _holding(client, bob, bob_account["id"], "AAPL", "equity", "6")
        assert _put_targets(client, bob, [("equity", 10_000)]).status_code == 200

        # First: the seed actually took effect for the user it was written for.
        assert [
            (t["asset_class"], t["target_bps"])
            for t in client.get("/api/portfolio/targets", headers=bob).json()
        ] == [("equity", 10_000)]
        bob_allocation = client.get("/api/portfolio/allocation", headers=bob).json()
        assert bob_allocation["report"]["total_value_cents"] == 60_000
        assert bob_allocation["report"]["holdings_total"] == 1

        # Only now: a different user, who declared nothing, sees none of it.
        assert client.get("/api/portfolio/targets", headers=alice).json() == []
        alice_allocation = client.get("/api/portfolio/allocation", headers=alice).json()
        assert alice_allocation["report"] is None
        assert "Aucune allocation cible" in alice_allocation["unavailable_reason"]

        # And Alice declaring her own targets never reaches Bob's holdings.
        _put_targets(client, alice, [("equity", 10_000)])
        alice_allocation = client.get("/api/portfolio/allocation", headers=alice).json()
        assert alice_allocation["report"]["holdings_total"] == 0
        assert alice_allocation["report"]["total_value_cents"] == 0
        # Bob's own targets are untouched by Alice's PUT.
        assert len(client.get("/api/portfolio/targets", headers=bob).json()) == 1


class TestConcurrentValuationAndAllocation:
    """`/patrimoine` reads `/valuation` and `/allocation`, and BOTH go through
    `_valuation_inputs`, which writes a `quota_windows` row and any freshly
    fetched `price_points`. On a cold database neither row exists yet, so two
    requests arriving together both INSERT and the second violates
    `uq_quota_window_user_provider` -- a 500 on the very first load of the
    screen, which is precisely the state every new user is in.

    Reproduced 5 times out of 5 against a real uvicorn before the fix.
    """

    def test_a_second_request_racing_the_first_still_answers(self, client, monkeypatch, db):
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000, currency="EUR"))
        headers = _register(client)
        account = _account(client, headers)
        _holding(client, headers, account["id"], "AAPL", "equity", "6")
        _put_targets(client, headers, [("equity", 10_000)])

        # The first request commits its own QuotaWindow row. Simulating the
        # race directly -- a second session inserting the SAME row underneath
        # an in-flight request -- is what the TestClient cannot do on its own,
        # so the collision is provoked at the point it really happens: the
        # commit inside `_valuation_inputs`.
        from app.models import QuotaWindow

        real_commit = db.commit
        calls = {"n": 0}

        def commit_colliding_once():
            calls["n"] += 1
            if calls["n"] == 1:
                # Another request got there first with the identical row.
                db.add(QuotaWindow(
                    user_id=db.query(User).first().id, provider="finnhub",
                    window_started_at=datetime.now(UTC), used=1,
                ))
                db.add(QuotaWindow(
                    user_id=db.query(User).first().id, provider="finnhub",
                    window_started_at=datetime.now(UTC), used=1,
                ))
            return real_commit()

        monkeypatch.setattr(db, "commit", commit_colliding_once)

        response = client.get("/api/portfolio/valuation", headers=headers)
        # The answer was computed before any write -- losing the race to
        # persist a cache row must not cost the user their valuation.
        assert response.status_code == 200
        assert response.json()["total"]["positions_total"] == 1

    def test_the_quota_row_is_written_exactly_once_per_provider(self, client, monkeypatch, db):
        """The invariant the unique constraint exists to hold, asserted from
        the outside: two reads that each price the same position through the
        same provider leave ONE window row, never two."""
        _install_quote(monkeypatch, "finnhub", quote=_quote(price_cents=10_000, currency="EUR"))
        headers = _register(client)
        account = _account(client, headers)
        _holding(client, headers, account["id"], "AAPL", "equity", "6")
        _put_targets(client, headers, [("equity", 10_000)])

        assert client.get("/api/portfolio/valuation", headers=headers).status_code == 200
        assert client.get("/api/portfolio/allocation", headers=headers).status_code == 200

        rows = db.query(QuotaWindow).filter(QuotaWindow.provider == "finnhub").all()
        assert len(rows) == 1
