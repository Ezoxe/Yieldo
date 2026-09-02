import { describe, expect, it } from "vitest";

import type { PositionValuation } from "../../lib/types";
import { priceStateOf, staleAgeSentence } from "./priceState";

function position(overrides: Partial<PositionValuation> = {}): PositionValuation {
  return {
    position_id: 1,
    account_id: 1,
    symbol: "AAPL",
    name: "Apple Inc.",
    asset_class: "equity",
    currency: "EUR",
    quantity: "10.000000000000000000",
    cost_basis_cents: 120_000,
    price: null,
    price_unavailable_reason: null,
    market_value_cents: null,
    unrealised_gain_cents: null,
    fx_unavailable_reason: null,
    market_value_reporting_cents: null,
    cost_basis_reporting_cents: null,
    unrealised_gain_reporting_cents: null,
    ...overrides,
  };
}

const QUOTE = {
  price_cents: 15_000,
  as_of: "2026-08-12",
  fetched_at: "2026-08-12T09:00:00Z",
  source: "finnhub",
  is_stale: false,
};

describe("priceStateOf", () => {
  it("tells a fresh price from a stale one, and neither is a failure", () => {
    expect(priceStateOf(position({ price: QUOTE })).kind).toBe("fresh");
    expect(priceStateOf(position({ price: { ...QUOTE, is_stale: true } })).kind).toBe("stale");
  });

  it("reports a missing price as missing, carrying the cause verbatim", () => {
    const state = priceStateOf(
      position({ price_unavailable_reason: "Aucune clé n'est enregistrée pour Finnhub." }),
    );
    expect(state.kind).toBe("missing");
    if (state.kind !== "missing") throw new Error("expected missing");
    // Verbatim: the screen never rewords one of the five causes.
    expect(state.reason).toBe("Aucune clé n'est enregistrée pour Finnhub.");
  });

  it("does not call a zero-quantity position missing: nothing was ever asked for", () => {
    // engines/portfolio.py values this at a real 0 without consulting a price.
    // Counting it as "missing" would overstate what could not be valued.
    const state = priceStateOf(
      position({ quantity: "0.000000000000000000", market_value_cents: 0 }),
    );
    expect(state.kind).toBe("not_required");
  });

  it("a stale price is a distinct state from a missing one, never the same branch", () => {
    const stale = priceStateOf(position({ price: { ...QUOTE, is_stale: true } }));
    const missing = priceStateOf(position({ price_unavailable_reason: "Quota épuisé." }));
    expect(stale.kind).not.toBe(missing.kind);
  });
});

describe("staleAgeSentence", () => {
  it("names the age in hours on the same day", () => {
    expect(staleAgeSentence("2026-08-12T09:00:00Z", new Date("2026-08-12T14:00:00Z"))).toBe(
      "relevé il y a 5 heures",
    );
  });

  it("says less than an hour rather than rounding to zero", () => {
    expect(staleAgeSentence("2026-08-12T09:00:00Z", new Date("2026-08-12T09:20:00Z"))).toBe(
      "relevé il y a moins d'une heure",
    );
  });

  it("says hier for one day and counts days beyond", () => {
    expect(staleAgeSentence("2026-08-11T09:00:00Z", new Date("2026-08-12T14:00:00Z"))).toBe(
      "relevé hier",
    );
    expect(staleAgeSentence("2026-08-05T09:00:00Z", new Date("2026-08-12T14:00:00Z"))).toBe(
      "relevé il y a 7 jours",
    );
  });

  it("returns null rather than inventing an age it could not measure", () => {
    expect(staleAgeSentence("pas une date", new Date("2026-08-12T14:00:00Z"))).toBeNull();
    // A timestamp in the future is not an age either.
    expect(staleAgeSentence("2026-09-01T09:00:00Z", new Date("2026-08-12T14:00:00Z"))).toBeNull();
  });
});
