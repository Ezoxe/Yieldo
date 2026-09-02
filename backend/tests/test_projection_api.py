"""`GET /api/projection`: Monte Carlo, FIRE, French tax and the three
historical stress tests, assembled over the requesting user's OWN portfolio
and OWN measured savings capacity.

**The response shape this file exercises first is the REFUSED one.** The
operator holds zero positions and his measured savings capacity is
-746,19 EUR/month, so all four engines answer with a refusal rather than a
figure -- each with its own French cause and its own remedy. A route only
tested on a healthy fixture is defect class 5 on this project's own list.

The real network is never touched: `market.providers.PROVIDERS` entries are
monkeypatched with fakes, the same idiom `test_portfolio_api.py` already
uses, and every populated case below prefers `cash` (valued at par, no
provider consulted at all) wherever an equity price is not the point.
"""

from datetime import UTC, date, datetime

from app.engines.montecarlo import DEFAULT_TRIALS
from app.engines.savings import MAX_PROJECTION_MONTHS
from app.engines.tax_fr import PEA_EXEMPTION_YEARS
from app.market.client import MarketError, MarketFailureCause, Quote
from app.market.providers import PROVIDERS
from app.models import Account, Transaction, User

SEED = 424_242


def _register(client, email="projection@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _ledger_account(db, user_id: int, opening_balance_cents: int = 0) -> Account:
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=opening_balance_cents,
                      include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user_id, account_id, on, amount, label="TX"):
    db.add(Transaction(
        user_id=user_id, account_id=account_id, date=on, amount_cents=amount,
        label_raw=label, label_clean=label.lower(), category_id=None,
        category_source="uncategorized", is_transfer=False,
        dedup_hash=f"{on}{amount}{label}{account_id}", tags=[],
    ))


def _seed_capacity(db, user_id: int, monthly_net_cents: int, months=(1, 2, 3, 4, 5)):
    """A ledger whose measured savings capacity is exactly
    `monthly_net_cents`: one salary and one expense per month, identical
    every month, so the median is the figure itself."""
    account = _ledger_account(db, user_id)
    for month in months:
        _tx(db, user_id, account.id, date(2025, month, 10), 300_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 20),
            monthly_net_cents - 300_000, f"DEPENSE {month}")
    db.commit()
    return account


# --- Portfolio helpers, the same three calls `test_portfolio_api.py` uses.


def _account(client, headers, name="CTO Boursorama", kind="cto", opened_on=None):
    payload = {"name": name, "kind": kind}
    if opened_on is not None:
        payload["opened_on"] = opened_on
    return client.post("/api/portfolio/accounts", headers=headers, json=payload).json()


def _instrument(client, headers, symbol="EUR", asset_class="cash", currency="EUR",
                is_fractionable=True, name=None):
    return client.post("/api/portfolio/instruments", headers=headers, json={
        "symbol": symbol, "name": name or f"{symbol} test", "asset_class": asset_class,
        "currency": currency, "is_fractionable": is_fractionable}).json()


def _holding(client, headers, account_id, symbol="EUR", asset_class="cash",
             quantity="10000", unit_cost_cents=100, currency="EUR",
             is_fractionable=True):
    instrument = _instrument(client, headers, symbol=symbol, asset_class=asset_class,
                             currency=currency, is_fractionable=is_fractionable)
    position = client.post("/api/portfolio/positions", headers=headers, json={
        "investment_account_id": account_id, "instrument_id": instrument["id"]}).json()
    client.post("/api/portfolio/lots", headers=headers, json={
        "position_id": position["id"], "quantity": quantity,
        "unit_cost_cents": unit_cost_cents, "acquired_on": "2020-01-15"})
    return position


class _FakeQuoteProvider:
    def __init__(self, quote=None, error=None):
        self.requires_key = False
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


def _install_quote(monkeypatch, provider="finnhub", **kwargs):
    fake = _FakeQuoteProvider(**kwargs)
    monkeypatch.setitem(PROVIDERS, provider, fake)
    return fake


def _quote(symbol="MWRD", price_cents=10_000, currency="EUR"):
    now = datetime.now(UTC)
    return Quote(symbol=symbol, price_cents=price_cents, currency=currency,
                 as_of=now.date(), fetched_at=now, source="finnhub")


def _get(client, headers, **params):
    query = {"seed": SEED, **params}
    return client.get("/api/projection", headers=headers, params=query)


# --------------------------------------------------------------------------
# The seed. A run nobody can reproduce is not a measurement.
# --------------------------------------------------------------------------


class TestTheSeed:
    def test_the_seed_is_required_and_is_never_generated_server_side(self, client):
        """No default, no `random.randint` fallback, no clock-derived value:
        omitting the seed is a 422 from FastAPI's own validation. A route
        that quietly invented one would produce a fan chart nobody could ever
        reproduce, which is the whole reason `engines.montecarlo` refuses to
        generate one either."""
        headers = _register(client)
        assert client.get("/api/projection", headers=headers).status_code == 422

    def test_the_seed_travels_back_on_the_response(self, client, db):
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])

        body = _get(client, headers).json()
        assert body["assumptions"]["seed"] == SEED
        # And again on the engine's OWN assumptions, straight off
        # `MonteCarloAssumptions.seed` -- the number a bug report quotes.
        assert body["monte_carlo"]["assumptions"]["seed"] == SEED

    def test_the_same_seed_reproduces_the_run_and_a_different_one_does_not(self, client, db):
        """Reproducibility asserted the only way that means anything: the
        identical request twice, compared band for band. The second half
        proves the first is not passing because the run is deterministic
        regardless of the seed."""
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])

        first = _get(client, headers, months=36, trials=200).json()["monte_carlo"]
        again = _get(client, headers, months=36, trials=200).json()["monte_carlo"]
        assert first["points"] == again["points"]

        other = _get(client, headers, months=36, trials=200,
                     seed=SEED + 1).json()["monte_carlo"]
        assert other["points"] != first["points"]


# --------------------------------------------------------------------------
# The operator's own state: zero positions, -746,19 EUR/month. Four refusals.
# --------------------------------------------------------------------------


class TestTheOperatorsOwnFourRefusals:
    def _body(self, client, db):
        headers = _register(client)
        # The operator's real measured capacity, to the cent.
        _seed_capacity(db, _user_id(db, "projection@example.fr"), -74_619)
        return client, headers, _get(client, headers).json()

    def test_every_engine_refuses_and_none_of_them_invents_a_figure(self, client, db):
        _client, _headers, body = self._body(client, db)
        assert body["monte_carlo"] is None
        assert body["fire"]["independence"]["months_to_independence"] is None
        assert body["tax"] is None
        assert body["stress"]["scenarios"] == []

        assert body["monte_carlo_unavailable_reason"]
        assert body["fire"]["independence"]["unavailable_reason"]
        assert body["tax_unavailable_reason"]
        assert body["stress_unavailable_reason"]

    def test_the_four_refusals_are_four_different_sentences(self, client, db):
        """The defect this project has fixed in seventeen tasks is a French
        sentence naming the WRONG cause. Four engines refused for four
        genuinely different reasons -- no capital to project, a capacity that
        is receding, no latent gain to tax, no allocation for a shock to hit
        -- and one sentence repeated four times would name three of them
        wrong."""
        _client, _headers, body = self._body(client, db)
        sentences = [
            body["monte_carlo_unavailable_reason"],
            body["fire"]["independence"]["unavailable_reason"],
            body["tax_unavailable_reason"],
            body["stress_unavailable_reason"],
        ]
        assert len(set(sentences)) == 4

    def test_each_refusal_names_its_own_remedy(self, client, db):
        _client, _headers, body = self._body(client, db)
        # Monte Carlo: there is no starting capital to grow.
        assert "capital" in body["monte_carlo_unavailable_reason"]
        # FIRE: the engine's own words, about the capacity, not the portfolio.
        assert "recule ou stagne" in body["fire"]["independence"]["unavailable_reason"]
        # Tax: about a gain that does not exist, and the lots that would create one.
        assert "plus-value" in body["tax_unavailable_reason"]
        assert "lots" in body["tax_unavailable_reason"]
        # Stress: about the asset classes a shock has nothing to hit.
        assert "classe" in body["stress_unavailable_reason"]

    def test_the_negative_capacity_travels_back_with_its_sign_untouched(self, client, db):
        """No `abs()`, no `max(0, ...)`, anywhere between the ledger and the
        wire. -74 619 read back as 74 619 would present a household going
        backwards as one saving 746,19 EUR a month."""
        _client, _headers, body = self._body(client, db)
        assert body["capacity"]["median_cents"] == -74_619
        assert body["fire"]["independence"]["capacity"]["median_cents"] == -74_619

    def test_the_fire_target_capital_is_still_computed_from_the_measured_expenses(
        self, client, db
    ):
        """A refusal on the TIMELINE is not a refusal on everything: the
        expense rate is measured, so the target capital the 4 % rule implies
        is a real figure and is shown. Blanking the whole panel would hide an
        answer the data supports."""
        _client, _headers, body = self._body(client, db)
        target = body["fire"]["target"]
        # 3 746,19 EUR spent a month -> 44 954,28 EUR/an -> /4 % = 1 123 857,00 EUR.
        assert target["annual_expenses_cents"] == 374_619 * 12
        assert target["withdrawal_rate_bps"] == 400
        assert target["target_capital_cents"] == 374_619 * 12 * 25

    def test_the_three_stress_scenarios_are_still_named_with_their_sources(self, client, db):
        """Refused does not mean hidden. The three episodes are measured
        pasts and stay on screen with their periods and their citations --
        only the euro figures are missing, and the refusal says why."""
        _client, _headers, body = self._body(client, db)
        shocks = body["stress"]["shocks"]
        assert [shock["key"] for shock in shocks] == ["2008", "2020", "2022"]
        for shock in shocks:
            assert shock["period"]
            assert shock["source"]
            assert shock["impact_bps_by_asset_class"]


# --------------------------------------------------------------------------
# The refusals must name the RIGHT cause: no positions at all and positions
# that could not be priced are two different problems with two different fixes.
# --------------------------------------------------------------------------


class TestTheRefusalNamesTheRightCause:
    def test_no_positions_at_all_is_not_the_same_sentence_as_no_price(
        self, client, db, monkeypatch
    ):
        empty = _register(client, "vide@example.fr")
        empty_body = _get(client, empty).json()

        unpriced = _register(client, "sansprix@example.fr")
        _install_quote(monkeypatch, error=MarketError(
            MarketFailureCause.NO_KEY,
            "Aucune clé n'est enregistrée pour Finnhub.",
        ))
        _holding(client, unpriced, _account(client, unpriced)["id"],
                 symbol="MWRD", asset_class="equity", quantity="10", unit_cost_cents=9_000)
        unpriced_body = _get(client, unpriced).json()

        # Both refuse -- but never with the same sentence.
        for key in ("monte_carlo_unavailable_reason", "tax_unavailable_reason",
                    "stress_unavailable_reason"):
            assert empty_body[key] and unpriced_body[key]
            assert empty_body[key] != unpriced_body[key]

        # And the unpriced one points at the connection, not at data entry.
        assert "Connexions" in unpriced_body["monte_carlo_unavailable_reason"]
        assert "Connexions" not in empty_body["monte_carlo_unavailable_reason"]

    def test_the_unpriced_refusal_counts_the_positions_it_could_not_value(
        self, client, monkeypatch
    ):
        headers = _register(client)
        _install_quote(monkeypatch, error=MarketError(
            MarketFailureCause.SERVICE_UNREACHABLE, "Service injoignable."))
        account = _account(client, headers)["id"]
        _holding(client, headers, account, symbol="AAA", asset_class="equity",
                 quantity="10", unit_cost_cents=9_000)
        _holding(client, headers, account, symbol="BBB", asset_class="equity",
                 quantity="5", unit_cost_cents=8_000)

        body = _get(client, headers).json()
        assert body["portfolio"]["positions_total"] == 2
        assert body["portfolio"]["positions_missing_price"] == 2
        assert "2 position" in body["monte_carlo_unavailable_reason"]


# --------------------------------------------------------------------------
# Monte Carlo on a real portfolio: a band, never a number; a band that is
# allowed to go negative.
# --------------------------------------------------------------------------


class TestMonteCarlo:
    def test_a_result_is_a_percentile_band_never_a_single_number(self, client, db):
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])

        body = _get(client, headers, months=60).json()
        mc = body["monte_carlo"]
        assert mc["assumptions"]["percentiles"] == [10, 50, 90]
        assert mc["assumptions"]["trials"] == DEFAULT_TRIALS
        assert len(mc["points"]) == 60
        for point in mc["points"]:
            band = point["percentiles_cents"]
            assert set(band) == {"10", "50", "90"}
            assert band["10"] <= band["50"] <= band["90"]
        # A real distribution, not three copies of one figure: the fixture's
        # volatility must actually spread the trials apart.
        last = mc["points"][-1]["percentiles_cents"]
        assert last["10"] < last["90"]

    def test_the_monthly_contribution_is_the_measured_capacity_signed(self, client, db):
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])
        mc = _get(client, headers, months=12).json()["monte_carlo"]
        assert mc["assumptions"]["monthly_cents"] == 200_000

    def test_a_lower_percentile_is_allowed_to_go_negative_and_is_never_clamped(
        self, client, db
    ):
        """Phase 2A shipped a forecast band anchored at zero, which erased the
        overdraft risk the band existed to show. A household holding
        10 000,00 EUR and losing 1 000,00 EUR every month runs out and keeps
        going -- and the API must say so, in negative cents, all the way to
        the wire."""
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), -100_000)
        _holding(client, headers, _account(client, headers)["id"])

        mc = _get(client, headers, months=60).json()["monte_carlo"]
        assert mc["initial_cents"] == 1_000_000
        assert mc["assumptions"]["monthly_cents"] == -100_000
        last = mc["points"][-1]["percentiles_cents"]
        assert last["10"] < 0
        assert last["50"] < 0
        # Not a zero floor anywhere along the path either.
        assert any(point["percentiles_cents"]["10"] < 0 for point in mc["points"])

    def test_every_point_carries_the_month_it_falls_on(self, client, db):
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])
        mc = _get(client, headers, months=6).json()["monte_carlo"]
        assert [point["month"] for point in mc["points"]] == [1, 2, 3, 4, 5, 6]
        assert all(point["on"] for point in mc["points"])

    def test_a_parameter_outside_the_engines_bounds_is_refused_in_french(self, client):
        """The bounds are the engines' own constants, so they cannot drift --
        and `api/errors.py` renders the refusal in French, never pydantic's
        English. Asserted on a user with NO portfolio on purpose: a nonsense
        parameter must be refused whether or not the run would have been
        refused anyway."""
        headers = _register(client)
        response = _get(client, headers, annual_volatility_bps=-1)
        assert response.status_code == 422
        assert "volatilité annuelle" in response.json()["detail"][0]["msg"]

        too_long = _get(client, headers, months=MAX_PROJECTION_MONTHS + 1)
        assert too_long.status_code == 422
        assert str(MAX_PROJECTION_MONTHS) in too_long.json()["detail"][0]["msg"]

    def test_a_negative_return_is_a_legitimate_scenario_here_and_a_refusal_for_fire(
        self, client, db
    ):
        """`engines.montecarlo` exists partly to model a sustained bear
        market and accepts a negative rate; `savings.months_to_target` and
        `fire.project_retirement` cannot. The two disagree by design, so the
        FIRE panel refuses in its own words rather than the page 422-ing
        around a Monte Carlo run that is perfectly valid."""
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])

        body = _get(client, headers, months=36, annual_return_bps=-500).json()
        assert body["monte_carlo"]["assumptions"]["annual_return_bps"] == -500
        assert len(body["monte_carlo"]["points"]) == 36
        assert body["fire"]["retirement"] is None
        assert "rendement" in body["fire"]["retirement_unavailable_reason"]


# --------------------------------------------------------------------------
# French tax: every figure names the regime that produced it.
# --------------------------------------------------------------------------


class TestFrenchTax:
    def _pea(self, client, headers, opened_on, quantity="100"):
        account = _account(client, headers, name="PEA", kind="pea", opened_on=opened_on)
        _holding(client, headers, account["id"], symbol="PEACASH", asset_class="cash",
                 quantity=quantity, unit_cost_cents=50)
        return account

    def test_a_pea_past_five_years_names_the_exemption_it_applied(self, client):
        headers = _register(client)
        opened = date.today().replace(year=date.today().year - PEA_EXEMPTION_YEARS - 1)
        self._pea(client, headers, opened.isoformat())

        [account] = _get(client, headers).json()["tax"]["accounts"]
        assert account["account_kind"] == "pea"
        assert account["regime"] == "pea_exempt"
        assert account["regime_label"]  # French, printed beside the figure
        assert account["exempt"] is True
        assert account["income_tax_cents"] == 0
        # 100 units bought at 0,50 EUR, worth 1,00 EUR: a 50,00 EUR gain.
        assert account["unrealised_gain_cents"] == 5_000
        assert account["social_levies_cents"] == 860  # 17,20 %, never exempted

    def test_a_pea_before_five_years_names_pfu_instead(self, client):
        headers = _register(client)
        opened = date.today().replace(year=date.today().year - 1)
        self._pea(client, headers, opened.isoformat())

        [account] = _get(client, headers).json()["tax"]["accounts"]
        assert account["regime"] == "pfu"
        assert account["exempt"] is False
        assert account["income_tax_cents"] == 640  # 12,80 % of 5 000

    def test_a_pea_with_no_opening_date_refuses_rather_than_guessing_one(self, client):
        """Article 157, 5° bis CGI counts from the PLAN's opening. With no
        date there is no holding period, and assuming either branch would be
        a fabricated tax answer."""
        headers = _register(client)
        self._pea(client, headers, None)

        [account] = _get(client, headers).json()["tax"]["accounts"]
        assert account["regime"] is None
        assert account["total_tax_cents"] is None
        assert "date d'ouverture" in account["unavailable_reason"]

    def test_an_assurance_vie_past_eight_years_names_its_own_reduced_regime(self, client):
        headers = _register(client)
        opened = date.today().replace(year=date.today().year - 9)
        account = _account(client, headers, name="AV", kind="assurance_vie",
                           opened_on=opened.isoformat())
        # 100 000 units at par (1,00 EUR) = 100 000,00 EUR, bought at 0,50 EUR:
        # a 50 000,00 EUR gain on 50 000,00 EUR of premiums -- deliberately
        # under article 125-0 A, I bis-1 CGI's 150 000 EUR threshold, which is
        # what the reduced 7,5 % rate turns on.
        _holding(client, headers, account["id"], symbol="AVCASH", asset_class="cash",
                 quantity="100000", unit_cost_cents=50)

        [out] = _get(client, headers).json()["tax"]["accounts"]
        assert out["regime"] == "assurance_vie_reduced"
        assert out["abatement_applied_cents"] == 460_000  # 4 600 EUR, single filer
        assert out["years_held"] == 9

    def test_an_ordinary_account_names_pfu_and_prices_the_bareme_beside_it(self, client):
        headers = _register(client)
        _holding(client, headers, _account(client, headers)["id"],
                 quantity="100", unit_cost_cents=50)

        body = _get(client, headers, marginal_rate_bps=3_000).json()
        [account] = body["tax"]["accounts"]
        assert account["regime"] == "pfu"
        assert account["total_tax_cents"] == 1_500  # 30 % of 5 000
        # Both regimes, side by side -- never a recommendation.
        assert account["alternative"]["regime"] == "bareme"
        assert account["alternative"]["total_tax_cents"] == 2_360  # 47,20 %
        assert body["tax"]["cheaper"] == "pfu"

    def test_without_a_marginal_rate_no_bareme_figure_is_invented(self, client):
        headers = _register(client)
        _holding(client, headers, _account(client, headers)["id"],
                 quantity="100", unit_cost_cents=50)
        body = _get(client, headers).json()
        assert body["tax"]["accounts"][0]["alternative"] is None
        assert body["tax"]["cheaper"] is None
        assert body["assumptions"]["marginal_rate_bps"] is None

    def test_an_account_whose_positions_have_no_price_says_so_per_account(
        self, client, monkeypatch
    ):
        headers = _register(client)
        _install_quote(monkeypatch, error=MarketError(
            MarketFailureCause.QUOTA_EXHAUSTED, "Quota épuisé."))
        cash_account = _account(client, headers, name="CTO liquide", kind="cto")
        _holding(client, headers, cash_account["id"], quantity="100", unit_cost_cents=50)
        equity_account = _account(client, headers, name="CTO actions", kind="cto")
        _holding(client, headers, equity_account["id"], symbol="MWRD",
                 asset_class="equity", quantity="10", unit_cost_cents=9_000)

        accounts = {a["account_name"]: a for a in _get(client, headers).json()["tax"]["accounts"]}
        # The priced one still answers, in full.
        assert accounts["CTO liquide"]["regime"] == "pfu"
        # The unpriced one refuses alone, without taking the other down.
        assert accounts["CTO actions"]["regime"] is None
        assert "prix" in accounts["CTO actions"]["unavailable_reason"]


# --------------------------------------------------------------------------
# Stress tests: measured pasts, never forecasts.
# --------------------------------------------------------------------------


class TestStressTests:
    def test_each_scenario_carries_its_period_and_its_source(self, client):
        headers = _register(client)
        _holding(client, headers, _account(client, headers)["id"])

        scenarios = _get(client, headers).json()["stress"]["scenarios"]
        assert [s["shock"]["key"] for s in scenarios] == ["2008", "2020", "2022"]
        assert scenarios[0]["shock"]["period"] == "octobre 2007 - mars 2009"
        assert "MSCI World" in scenarios[0]["shock"]["source"]
        assert scenarios[2]["shock"]["period"] == "année civile 2022"

    def test_the_2008_bond_figure_stays_positive_a_shock_is_not_always_a_loss(
        self, client, monkeypatch
    ):
        """Government bonds rallied on the flight to quality while equities
        collapsed. Flooring every class at a loss would erase the one thing a
        stress test can show a household: which holdings cushioned which."""
        headers = _register(client)
        _install_quote(monkeypatch, quote=_quote(price_cents=10_000))
        account = _account(client, headers)["id"]
        _holding(client, headers, account, symbol="OBLI", asset_class="bond",
                 quantity="10", unit_cost_cents=9_000)

        [crisis_2008, *_rest] = _get(client, headers).json()["stress"]["scenarios"]
        [bond] = [c for c in crisis_2008["by_class"] if c["asset_class"] == "bond"]
        assert bond["impact_bps"] == 500
        assert bond["stressed_value_cents"] > bond["current_value_cents"]
        assert crisis_2008["impact_cents"] > 0

    def test_a_class_with_no_historical_data_is_named_never_invented_at_zero(
        self, client, monkeypatch
    ):
        """Bitcoin did not exist in 2008. Folding crypto in at 0 % would claim
        it was measured and untouched."""
        headers = _register(client)
        _install_quote(monkeypatch, provider="coingecko", quote=_quote(symbol="BTC"))
        _holding(client, headers, _account(client, headers, kind="crypto_exchange")["id"],
                 symbol="BTC", asset_class="crypto", quantity="1", unit_cost_cents=500_000,
                 is_fractionable=True)

        [crisis_2008, covid_2020, _bear] = _get(client, headers).json()["stress"]["scenarios"]
        assert crisis_2008["classes_without_data"] == ["crypto"]
        [crypto_2008] = [c for c in crisis_2008["by_class"] if c["asset_class"] == "crypto"]
        assert crypto_2008["impact_bps"] is None
        assert crypto_2008["stressed_value_cents"] is None
        # 2020 DOES have a Bitcoin figure, so the two scenarios must differ.
        assert covid_2020["classes_without_data"] == []


# --------------------------------------------------------------------------
# FIRE, on a household that is actually saving.
# --------------------------------------------------------------------------


class TestFire:
    def test_a_positive_capacity_produces_a_timeline_and_a_retirement_drawdown(
        self, client, db
    ):
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])

        fire = _get(client, headers, months=120).json()["fire"]
        assert fire["independence"]["unavailable_reason"] is None
        assert fire["independence"]["months_to_independence"] > 0
        assert fire["independence"]["independent_on"]
        # The assumptions travel with the figure they produced -- design §10.
        assert fire["independence"]["withdrawal_rate_bps"] == 400
        assert fire["independence"]["annual_return_bps"] == 300

        retirement = fire["retirement"]
        assert retirement["tax_regime"] == "pfu"
        assert retirement["initial_cents"] == 1_000_000
        assert len(retirement["points"]) > 0
        assert all(point["balance_cents"] >= 0 for point in retirement["points"])

    def test_the_retirement_drawdown_refuses_on_a_capital_of_zero(self, client, db):
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)

        fire = _get(client, headers).json()["fire"]
        assert fire["retirement"] is None
        assert "capital" in fire["retirement_unavailable_reason"]
        # And it is NOT the independence refusal: this household saves.
        assert fire["independence"]["unavailable_reason"] is None

    def test_a_household_with_no_ledger_at_all_cannot_have_a_target_capital(self, client):
        """Three refusals share `None` on the FIRE panel and must never share
        a sentence: unmeasurable expenses (here), a non-positive capacity, and
        a target beyond the fifty-year bound."""
        headers = _register(client)
        body = _get(client, headers).json()
        assert body["fire"] is None
        assert "trois mois complets" in body["fire_unavailable_reason"]

    def test_electing_bareme_taxes_the_drawdown_at_the_marginal_rate(self, client, db):
        headers = _register(client)
        _seed_capacity(db, _user_id(db, "projection@example.fr"), 200_000)
        _holding(client, headers, _account(client, headers)["id"])

        fire = _get(client, headers, marginal_rate_bps=4_100).json()["fire"]
        assert fire["retirement"]["tax_regime"] == "bareme"
        assert fire["retirement"]["marginal_rate_bps"] == 4_100


# --------------------------------------------------------------------------
# Isolation. Bob's own read is asserted FIRST, so a fixture that silently
# wrote nothing cannot make Alice's empty answer pass vacuously.
# --------------------------------------------------------------------------


def test_isolation_holds_on_every_projected_figure(client, db):
    alice = _register(client, "alice-proj@example.fr")
    bob = _register(client, "bob-proj@example.fr")
    _seed_capacity(db, _user_id(db, "bob-proj@example.fr"), 200_000)
    _holding(client, bob, _account(client, bob, name="PEA de Bob", kind="pea",
                                   opened_on="2010-01-01")["id"],
             symbol="BOBCASH", quantity="10000", unit_cost_cents=50)

    # Bob's own report proves the seeding actually landed.
    bob_body = _get(client, bob).json()
    assert bob_body["capacity"]["median_cents"] == 200_000
    assert bob_body["portfolio"]["positions_total"] == 1
    assert bob_body["portfolio"]["market_value_cents"] == 1_000_000
    assert bob_body["monte_carlo"]["initial_cents"] == 1_000_000
    assert bob_body["tax"]["accounts"][0]["account_name"] == "PEA de Bob"
    assert bob_body["stress"]["scenarios"][0]["portfolio_value_cents"] == 1_000_000

    # Alice sees none of it -- and gets her own refusals, not Bob's figures.
    alice_body = _get(client, alice).json()
    assert alice_body["capacity"] is None
    assert alice_body["portfolio"]["positions_total"] == 0
    assert alice_body["portfolio"]["market_value_cents"] == 0
    assert alice_body["monte_carlo"] is None
    assert alice_body["tax"] is None
    assert alice_body["fire"] is None
    assert alice_body["stress"]["scenarios"] == []


def test_the_route_requires_authentication(client):
    assert client.get("/api/projection", params={"seed": SEED}).status_code == 401


def test_an_archived_investment_account_leaves_every_projection(client, db):
    """The same rule `/api/portfolio/valuation` already applies: an archived
    envelope is how the operator says it is no longer part of his patrimoine,
    and counting it would inflate the Monte Carlo's starting capital, the tax
    bill and every stress figure at once."""
    headers = _register(client)
    account = _account(client, headers)
    _holding(client, headers, account["id"])
    assert _get(client, headers).json()["monte_carlo"]["initial_cents"] == 1_000_000

    client.delete(f"/api/portfolio/accounts/{account['id']}", headers=headers)
    after = _get(client, headers).json()
    assert after["portfolio"]["positions_total"] == 0
    assert after["monte_carlo"] is None
    assert after["tax"] is None
