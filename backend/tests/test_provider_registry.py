"""`market/providers/PROVIDERS`: the registry every one of the five
providers is looked up through.

Two things this file exists to prove, beyond a plain smoke test:

* The registry's keys are EXACTLY `models.api_key.MARKET_PROVIDERS` --
  neither more nor fewer -- so a provider can never be reachable from one
  but not the other.
* Each concrete provider actually satisfies the protocol its domain
  requires (`QuoteProvider` for equities/crypto, `FxProvider` for
  currencies), not just "happens to have similarly named methods".
"""

from app.market.client import FxProvider, QuoteProvider
from app.market.providers import PROVIDERS
from app.models import MARKET_PROVIDERS


def test_the_registry_has_exactly_the_five_declared_market_providers():
    assert set(PROVIDERS) == set(MARKET_PROVIDERS)


def test_finnhub_alpha_vantage_and_coingecko_satisfy_the_quote_provider_protocol():
    for name in ("finnhub", "alpha_vantage", "coingecko"):
        assert isinstance(PROVIDERS[name], QuoteProvider)


def test_frankfurter_and_exchangerate_api_satisfy_the_fx_provider_protocol():
    for name in ("frankfurter", "exchangerate_api"):
        assert isinstance(PROVIDERS[name], FxProvider)


def test_every_providers_declared_name_matches_its_registry_key():
    for key, provider in PROVIDERS.items():
        assert provider.name == key


def test_requires_key_is_true_for_the_three_keyed_providers_and_false_for_the_two_free_ones():
    """A regression the registry alone can't catch structurally -- proves
    the flag is set correctly on the actual live instances, not just on a
    provider class in isolation."""
    assert PROVIDERS["finnhub"].requires_key is True
    assert PROVIDERS["alpha_vantage"].requires_key is True
    assert PROVIDERS["exchangerate_api"].requires_key is True
    assert PROVIDERS["coingecko"].requires_key is False
    assert PROVIDERS["frankfurter"].requires_key is False
