import type {
  Connection,
  PortfolioAllocation,
  PortfolioValuation,
  PositionValuation,
  PriceQuote,
} from "../../lib/types";

/**
 * The operator's real state: no key registered anywhere.
 *
 * `requires_key` is read off the LIVE `GET /api/connections` on the seeded
 * fixture, not guessed: CoinGecko's free tier and Frankfurter both need none,
 * and the three that do are Finnhub, Alpha Vantage and ExchangeRate-API. A
 * fixture where every provider looked alike could not tell "no key entered"
 * from "no key needed" — two states with two different remedies, one of which
 * is "nothing to do".
 */
export const NO_KEY_CONNECTIONS: Connection[] = [
  {
    provider: "finnhub",
    configured: false,
    requires_key: true,
    last_used_at: null,
    quota: { used: 0, limit: 60, ceiling: 48, remaining: 48, reset_at: null, can_call: true },
  },
  {
    provider: "alpha_vantage",
    configured: false,
    requires_key: true,
    last_used_at: null,
    quota: { used: 0, limit: 25, ceiling: 20, remaining: 20, reset_at: null, can_call: true },
  },
  {
    provider: "coingecko",
    configured: false,
    requires_key: false,
    last_used_at: null,
    quota: { used: 0, limit: 30, ceiling: 24, remaining: 24, reset_at: null, can_call: true },
  },
  {
    provider: "frankfurter",
    configured: false,
    requires_key: false,
    last_used_at: null,
    quota: { used: 3, limit: null, ceiling: null, remaining: null, reset_at: null, can_call: true },
  },
  {
    provider: "exchangerate_api",
    configured: false,
    requires_key: true,
    last_used_at: null,
    quota: {
      used: 0,
      limit: 1500,
      ceiling: 1200,
      remaining: 1200,
      reset_at: null,
      can_call: true,
    },
  },
];

export const EMPTY_VALUATION: PortfolioValuation = {
  reporting_currency: "EUR",
    declared: [],
    declared_total_cents: 0,
    cash: [],
    cash_total_cents: 0,
  positions: [],
  total: {
    market_value_cents: 0,
    cost_basis_cents: 0,
    unrealised_gain_cents: 0,
    positions_total: 0,
    positions_valued: 0,
    positions_missing_price: 0,
    positions_missing_fx: 0,
  },
  weight_by_instrument: [],
  weight_by_asset_class: [],
  weight_by_currency: [],
};

export const NO_TARGETS_ALLOCATION: PortfolioAllocation = {
  reporting_currency: "EUR",
  targets: [],
  report: null,
  unavailable_reason:
    "Aucune allocation cible n'est définie : déclarez la répartition visée par classe " +
    "d'actifs (leur somme doit faire 100 %) pour que Yieldo puisse mesurer l'écart avec " +
    "votre répartition actuelle.",
};

export function quote(overrides: Partial<PriceQuote> = {}): PriceQuote {
  return {
    price_cents: 15_000,
    as_of: "2026-08-12",
    fetched_at: "2026-08-12T09:00:00Z",
    source: "finnhub",
    is_stale: false,
    ...overrides,
  };
}

export function position(overrides: Partial<PositionValuation> = {}): PositionValuation {
  return {
    position_id: 1,
    account_id: 1,
    symbol: "AAPL",
    name: "Apple Inc.",
    asset_class: "equity",
    currency: "EUR",
    quantity: "10.000000000000000000",
    cost_basis_cents: 120_000,
    price: quote(),
    price_unavailable_reason: null,
    market_value_cents: 150_000,
    unrealised_gain_cents: 30_000,
    fx_unavailable_reason: null,
    market_value_reporting_cents: 150_000,
    cost_basis_reporting_cents: 120_000,
    unrealised_gain_reporting_cents: 30_000,
    ...overrides,
  };
}

/** A fresh holding, a STALE one and a MISSING one in the same portfolio — the
 *  three states the screen has to keep apart, in one fixture, so a test cannot
 *  pass by treating any two of them the same way. */
export const MIXED_VALUATION: PortfolioValuation = {
  reporting_currency: "EUR",
    declared: [],
    declared_total_cents: 0,
    cash: [],
    cash_total_cents: 0,
  positions: [
    position(),
    position({
      position_id: 2,
      symbol: "BTC",
      name: "Bitcoin",
      asset_class: "crypto",
      quantity: "0.250000000000000000",
      cost_basis_cents: 900_000,
      // Stale: `as_of` and `fetched_at` are the SAME day. A quote as of the
      // 12th that was retrieved on the 5th could not exist, and a fixture
      // that cannot happen proves nothing about the screen that renders it.
      price: quote({
        price_cents: 4_000_000,
        is_stale: true,
        as_of: "2026-08-05",
        fetched_at: "2026-08-05T09:00:00Z",
        source: "coingecko",
      }),
      market_value_cents: 1_000_000,
      unrealised_gain_cents: 100_000,
      market_value_reporting_cents: 1_000_000,
      cost_basis_reporting_cents: 900_000,
      unrealised_gain_reporting_cents: 100_000,
    }),
    position({
      position_id: 3,
      symbol: "MC.PA",
      name: "LVMH",
      asset_class: "equity",
      quantity: "3.000000000000000000",
      cost_basis_cents: 180_000,
      price: null,
      price_unavailable_reason:
        "Aucune clé n'est enregistrée pour Finnhub : ajoutez-en une dans Réglages → " +
        "Connexions pour activer cette donnée de marché.",
      market_value_cents: null,
      unrealised_gain_cents: null,
      market_value_reporting_cents: null,
      cost_basis_reporting_cents: null,
      unrealised_gain_reporting_cents: null,
    }),
  ],
  total: {
    market_value_cents: 1_150_000,
    cost_basis_cents: 1_020_000,
    unrealised_gain_cents: 130_000,
    positions_total: 3,
    positions_valued: 2,
    positions_missing_price: 1,
    positions_missing_fx: 0,
  },
  weight_by_instrument: [
    { key: "BTC", value_cents: 1_000_000, weight: 0.8695652173913043 },
    { key: "AAPL", value_cents: 150_000, weight: 0.13043478260869565 },
  ],
  weight_by_asset_class: [
    { key: "crypto", value_cents: 1_000_000, weight: 0.8695652173913043 },
    { key: "equity", value_cents: 150_000, weight: 0.13043478260869565 },
  ],
  weight_by_currency: [{ key: "EUR", value_cents: 1_150_000, weight: 1 }],
};

/**
 * A drift carrying BOTH outcomes at once: one trade the engine could size, and
 * one it refused to.
 *
 * Every figure below reconciles against `MIXED_VALUATION` — 11 500,00 EUR
 * valued, 10 000,00 EUR of crypto and 1 500,00 EUR of equity. Against a
 * 86,50 / 13,50 target the gap is 52,50 EUR each way: 0,0013125 BTC at
 * 40 000,00 EUR a unit, which is fractionable and gets an order, versus 0,35
 * of an AAPL share at 150,00 EUR, which is NOT fractionable and gets the
 * refusal instead of a zero-unit order. A fixture whose numbers did not
 * actually produce that refusal would be a test passing for the wrong reason.
 */
export const DRIFTED_ALLOCATION: PortfolioAllocation = {
  reporting_currency: "EUR",
  targets: [
    { id: 1, asset_class: "crypto", target_bps: 8_650 },
    { id: 2, asset_class: "equity", target_bps: 1_350 },
  ],
  report: {
    total_value_cents: 1_150_000,
    holdings_total: 3,
    holdings_valued: 2,
    drifts: [
      {
        asset_class: "crypto",
        target_bps: 8_650,
        current_bps: 8_696,
        current_value_cents: 1_000_000,
        target_value_cents: 994_750,
        drift_cents: -5_250,
        drift_bps: 46,
      },
      {
        asset_class: "equity",
        target_bps: 1_350,
        current_bps: 1_304,
        current_value_cents: 150_000,
        target_value_cents: 155_250,
        drift_cents: 5_250,
        drift_bps: -46,
      },
    ],
    trades: [
      {
        symbol: "BTC",
        asset_class: "crypto",
        action: "sell",
        quantity: "0.001312500000000000",
        estimated_value_cents: 5_250,
      },
    ],
    refusals: [
      {
        symbol: "AAPL",
        asset_class: "equity",
        reason:
          "« AAPL » n'est pas fractionnable : l'écart à corriger (52,50 EUR) représente " +
          "moins d'une unité au prix actuel (150,00 EUR). Aucun ordre n'est proposé plutôt " +
          "qu'une part fractionnée.",
      },
    ],
  },
  unavailable_reason: null,
};
