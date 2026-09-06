import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import type { InvestmentAccount } from "../../lib/types";
import { PositionForm } from "./PositionForm";

const ACCOUNTS: InvestmentAccount[] = [
  { id: 4, name: "PEA Boursorama", kind: "pea", currency: "EUR", opened_on: null, archived: false, declared_value_cents: null, declared_value_on: null },
  { id: 9, name: "Kraken", kind: "crypto_exchange", currency: "EUR", opened_on: null, archived: false, declared_value_cents: null, declared_value_on: null },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PositionForm", () => {
  it("registers the instrument, then opens the position on it", async () => {
    // Two calls, in that order: `POST /instruments` is a find-or-create keyed
    // on (symbol, asset_class), and the position needs the id it answers with.
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValueOnce({
        id: 31,
        symbol: "AAPL",
        name: "Apple Inc.",
        asset_class: "equity",
        currency: "USD",
        is_fractionable: false,
      })
      .mockResolvedValueOnce({ id: 77, investment_account_id: 4, instrument_id: 31 });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <PositionForm accounts={ACCOUNTS} accountId={4} onSaved={onSaved} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/Symbole coté/), "AAPL");
    await user.type(screen.getByLabelText(/Nom de l'instrument/), "Apple Inc.");
    await user.selectOptions(screen.getByLabelText(/Classe d'actifs/), "equity");
    await user.clear(screen.getByLabelText(/Devise de cotation/));
    await user.type(screen.getByLabelText(/Devise de cotation/), "USD");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0]).toEqual([
      "/portfolio/instruments",
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        asset_class: "equity",
        currency: "USD",
        is_fractionable: false,
      },
    ]);
    expect(post.mock.calls[1]).toEqual([
      "/portfolio/positions",
      { investment_account_id: 4, instrument_id: 31 },
    ]);
    expect(onSaved).toHaveBeenCalled();
  });

  it("defaults an instrument to non-fractionable, the conservative answer", () => {
    render(<PositionForm accounts={ACCOUNTS} accountId={4} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/Fractionnable/)).not.toBeChecked();
  });

  it("sends is_fractionable when the household says the instrument is", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValueOnce({
        id: 12,
        symbol: "BTC-EUR",
        name: "Bitcoin",
        asset_class: "crypto",
        currency: "EUR",
        is_fractionable: true,
      })
      .mockResolvedValueOnce({ id: 78, investment_account_id: 9, instrument_id: 12 });
    const user = userEvent.setup();
    render(<PositionForm accounts={ACCOUNTS} accountId={9} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Symbole coté/), "BTC-EUR");
    await user.type(screen.getByLabelText(/Nom de l'instrument/), "Bitcoin");
    await user.selectOptions(screen.getByLabelText(/Classe d'actifs/), "crypto");
    await user.click(screen.getByLabelText(/Fractionnable/));
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0][1]).toMatchObject({ is_fractionable: true });
    expect(post.mock.calls[1][1]).toEqual({ investment_account_id: 9, instrument_id: 12 });
  });

  it("refuses an empty symbol at the field, and registers nothing", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    render(<PositionForm accounts={ACCOUNTS} accountId={4} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Nom de l'instrument/), "Apple");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Indiquez le symbole sous lequel l'instrument est coté, par exemple AAPL ou BTC-EUR : c'est ce qu'un fournisseur de données sait valoriser.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses an unnamed instrument at its own field", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    render(<PositionForm accounts={ACCOUNTS} accountId={4} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Symbole coté/), "AAPL");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Donnez un nom lisible à cet instrument, par exemple « Apple Inc. » : le symbole seul est illisible dans un tableau.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("prints the backend's duplicate refusal verbatim, and does not open a second position", async () => {
    const { ApiError } = await import("../../lib/api");
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValueOnce({
        id: 31,
        symbol: "AAPL",
        name: "Apple Inc.",
        asset_class: "equity",
        currency: "EUR",
        is_fractionable: false,
      })
      .mockRejectedValueOnce(
        new ApiError(422, "Une position existe déjà pour cet instrument dans ce compte."),
      );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<PositionForm accounts={ACCOUNTS} accountId={4} onSaved={onSaved} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Symbole coté/), "AAPL");
    await user.type(screen.getByLabelText(/Nom de l'instrument/), "Apple Inc.");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText("Une position existe déjà pour cet instrument dans ce compte."),
    ).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("lets the household move the position to another of its accounts", async () => {
    const user = userEvent.setup();
    render(<PositionForm accounts={ACCOUNTS} accountId={4} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const select = screen.getByLabelText(/Compte d'investissement/);
    expect(select).toHaveValue("4");
    await user.selectOptions(select, "9");
    expect(select).toHaveValue("9");
  });

  it("says a position holds nothing until a lot is added", () => {
    // The screen must not leave the household thinking the position itself
    // carries a quantity — the next step is what gives it one.
    render(<PositionForm accounts={ACCOUNTS} accountId={4} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(
      screen.getByText(/Une position déclarée seule ne détient encore rien/),
    ).toBeInTheDocument();
  });
});
