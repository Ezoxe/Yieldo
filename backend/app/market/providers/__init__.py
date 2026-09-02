"""The five market providers, by name -- one instance each, real network by
default (`transport=None`).

The single place `/api/connections` (Task 6) and, later, the valuation
client (Task 9) look up "the Finnhub provider" or "the provider for
`exchangerate_api`" without importing five separate modules by name.
`PROVIDERS`' keys are exactly `models.api_key.MARKET_PROVIDERS`, checked by
`test_provider_registry.py` so the two can never drift apart -- a provider
added to one without the other would either be unreachable from
`/api/connections` or accept a key `POST /api/connections` had no
provider to validate.
"""

from app.market.providers.alpha_vantage import AlphaVantageProvider
from app.market.providers.coingecko import CoinGeckoProvider
from app.market.providers.exchangerate_api import ExchangeRateApiProvider
from app.market.providers.finnhub import FinnhubProvider
from app.market.providers.frankfurter import FrankfurterProvider

PROVIDERS = {
    "finnhub": FinnhubProvider(),
    "alpha_vantage": AlphaVantageProvider(),
    "coingecko": CoinGeckoProvider(),
    "frankfurter": FrankfurterProvider(),
    "exchangerate_api": ExchangeRateApiProvider(),
}
