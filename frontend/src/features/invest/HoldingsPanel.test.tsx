import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import { HoldingsPanel } from "./HoldingsPanel";

const CARDS = [
  {
    venue_id: 1, venue: "alpaca", label: "Alpaca réel", mode: "live", ok: true, message: null,
    cash: [{ currency: "USD", amount_cents: 152035 }],
    assets: [{ symbol: "AAPL", quantity: "3.5", value_cents: 80570, currency: "USD" }],
    fetched_at: "2026-10-25T20:00:00Z",
  },
  {
    venue_id: 2, venue: "kraken", label: "Kraken", mode: "live", ok: true, message: null,
    cash: [{ currency: "EUR", amount_cents: 25050 }],
    assets: [{ symbol: "XXBT", quantity: "0.0123", value_cents: null, currency: null }],
    fetched_at: "2026-10-25T20:00:00Z",
  },
  {
    venue_id: 3, venue: "binance", label: "Binance", mode: "live", ok: false,
    message: "Binance a refusé la clé (HTTP 401).", cash: [], assets: [],
    fetched_at: "2026-10-25T20:00:00Z",
  },
];

afterEach(() => vi.restoreAllMocks());

describe("HoldingsPanel", () => {
  it("reads nothing until asked", () => {
    const get = vi.spyOn(api, "get");
    render(<HoldingsPanel />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Lire mes avoirs" })).toBeInTheDocument();
  });

  it("shows each broker's cash and positions in its own currency", async () => {
    vi.spyOn(api, "get").mockResolvedValue(CARDS as never);
    render(<HoldingsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Lire mes avoirs" }));

    const alpaca = await screen.findByRole("region", { name: "Alpaca réel" });
    expect(alpaca).toHaveTextContent("1 520,35 USD");
    expect(within(alpaca).getByRole("cell", { name: "AAPL" })).toBeInTheDocument();
    expect(alpaca).toHaveTextContent("805,70 USD");
    const kraken = screen.getByRole("region", { name: "Kraken" });
    expect(kraken).toHaveTextContent("250,50 €");
    expect(kraken).toHaveTextContent("0,0123");
    expect(kraken).toHaveTextContent("non fournie par le courtier");
  });

  it("keeps a broker that could not be read, with its own refusal", async () => {
    vi.spyOn(api, "get").mockResolvedValue(CARDS as never);
    render(<HoldingsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Lire mes avoirs" }));

    const binance = await screen.findByRole("region", { name: "Binance" });
    expect(binance).toHaveTextContent("Binance a refusé la clé (HTTP 401).");
  });

  it("says there is nothing to read when no real broker is connected", async () => {
    vi.spyOn(api, "get").mockResolvedValue([] as never);
    render(<HoldingsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Lire mes avoirs" }));

    expect(await screen.findByText(/Aucun courtier réel connecté/)).toBeInTheDocument();
  });
});
