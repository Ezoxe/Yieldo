import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import type { InvestmentAccount, Lot, PositionValuation } from "../../lib/types";
import { PortfolioEditor } from "./PortfolioEditor";

const ACCOUNTS: InvestmentAccount[] = [
  {
    id: 4,
    name: "PEA Boursorama",
    kind: "pea",
    currency: "EUR",
    opened_on: "2019-04-01",
    archived: false,
  },
  { id: 9, name: "Kraken", kind: "crypto_exchange", currency: "EUR", opened_on: null, archived: false },
];

function position(overrides: Partial<PositionValuation>): PositionValuation {
  return {
    position_id: 77,
    account_id: 4,
    symbol: "AAPL",
    name: "Apple Inc.",
    asset_class: "equity",
    currency: "EUR",
    quantity: "15.000000000000000000",
    cost_basis_cents: 234_000,
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

const POSITIONS: PositionValuation[] = [
  position({}),
  position({
    position_id: 78,
    account_id: 9,
    symbol: "BTC-EUR",
    name: "Bitcoin",
    asset_class: "crypto",
    quantity: "0.000000000000000000",
  }),
];

const LOTS: Lot[] = [
  {
    id: 1,
    position_id: 77,
    quantity: "12.000000000000000000",
    unit_cost_cents: 15_000,
    acquired_on: "2026-01-15",
  },
  {
    id: 2,
    position_id: 77,
    quantity: "3.000000000000000000",
    unit_cost_cents: 18_000,
    acquired_on: "2026-02-02",
  },
];

function renderEditor(props: Partial<React.ComponentProps<typeof PortfolioEditor>> = {}) {
  return render(
    <PortfolioEditor
      accounts={ACCOUNTS}
      archivedAccounts={[]}
      positions={POSITIONS}
      lots={LOTS}
      onChanged={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PortfolioEditor", () => {
  it("names each account by its envelope, not by the wire code", async () => {
    renderEditor();
    const pea = screen.getByTestId("yd-editor-account-4");
    expect(pea).toHaveTextContent("PEA Boursorama");
    expect(screen.getByTestId("yd-editor-account-kind-4")).toHaveTextContent("PEA");
    expect(pea).toHaveTextContent("ouvert le 1er avril 2019");

    const kraken = screen.getByTestId("yd-editor-account-9");
    expect(kraken).toHaveTextContent("Kraken");
    // "crypto_exchange" is a wire value, not French.
    expect(screen.getByTestId("yd-editor-account-kind-9")).toHaveTextContent(
      "Plateforme d'échange crypto",
    );
    expect(kraken).toHaveTextContent("date d'ouverture non renseignée");
  });

  it("shows a position's quantity as the sum of its lots, and says so", async () => {
    renderEditor();
    const card = screen.getByTestId("yd-editor-position-77");
    // The figure and its provenance travel together: nothing here is a stored
    // total, and the count of lots behind it is on screen beside it.
    expect(card).toHaveTextContent(/15 unités/);
    expect(card).toHaveTextContent(/somme de 2 lots/);
  });

  it("says a position with no lot holds nothing, rather than showing a zero", async () => {
    renderEditor();
    const card = screen.getByTestId("yd-editor-position-78");
    expect(card).toHaveTextContent(
      /Aucun lot déclaré : cette position ne détient encore rien tant qu'une acquisition n'y est pas enregistrée/,
    );
  });

  it("lists every lot with the three things one acquisition is made of", async () => {
    renderEditor();
    const lot = screen.getByTestId("yd-editor-lot-1");
    expect(lot).toHaveTextContent("12");
    expect(lot).toHaveTextContent("150,00 €");
    expect(lot).toHaveTextContent("15 janvier 2026");
  });

  it("never runs a quantity through the money formatter", async () => {
    renderEditor();
    // 12 units through `formatCents` would read "0,12 €"; the euro sign must
    // appear only on the unit cost.
    const quantity = screen.getByTestId("yd-editor-lot-quantity-1");
    expect(quantity.textContent).not.toContain("€");
    expect(quantity).toHaveTextContent("12");
  });

  it("opens the account form, and the position form under the account it belongs to", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: /Ajouter un compte/ }));
    expect(screen.getByLabelText(/Nom du compte/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Annuler/ }));

    await user.click(
      within(screen.getByTestId("yd-editor-account-9")).getByRole("button", {
        name: /Déclarer une position/,
      }),
    );
    expect(screen.getByLabelText(/Compte d'investissement/)).toHaveValue("9");
  });

  it("archives an account only after asking, and says what archiving does", async () => {
    const remove = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onChanged });

    await user.click(
      within(screen.getByTestId("yd-editor-account-4")).getByRole("button", { name: /Archiver/ }),
    );
    expect(remove).not.toHaveBeenCalled();
    // Truthful about what the API actually does: `DELETE /accounts` sets
    // `archived` and nothing else -- nothing is deleted -- but the valuation
    // now excludes the envelope's position from the total until it is
    // restored. Saying "the position keeps being valued" would be exactly
    // the stale claim this sentence made before the backend was fixed.
    expect(
      screen.getByText(
        /Archiver « PEA Boursorama » \? Le compte quitte cette liste, et la position qu'il détient cesse d'être comptée dans le total tant que le compte n'est pas réactivé/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Confirmer/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/portfolio/accounts/4"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("lists an archived account and restores it on request", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    renderEditor({
      onChanged,
      archivedAccounts: [
        { id: 12, name: "Ancien PEA", kind: "pea", currency: "EUR", opened_on: null, archived: true },
      ],
    });

    const archived = screen.getByTestId("yd-editor-archived-account-12");
    expect(archived).toHaveTextContent("Ancien PEA");

    await user.click(within(archived).getByRole("button", { name: /Réactiver/ }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/portfolio/accounts/12", { archived: false }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows no archived-accounts panel when there is nothing to restore", () => {
    renderEditor({ archivedAccounts: [] });
    expect(screen.queryByTestId("yd-editor-archived")).not.toBeInTheDocument();
  });

  it("warns that deleting a position takes its lots with it", async () => {
    const remove = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      within(screen.getByTestId("yd-editor-position-77")).getByRole("button", {
        name: /Supprimer la position/,
      }),
    );
    expect(
      screen.getByText(
        /Supprimer la position AAPL \? Ses 2 lots sont supprimés avec elle, définitivement/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Confirmer/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/portfolio/positions/77"));
  });

  it("deletes one lot after asking, naming which", async () => {
    const remove = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      within(screen.getByTestId("yd-editor-lot-1")).getByRole("button", { name: /Supprimer/ }),
    );
    expect(
      screen.getByText(/Supprimer le lot du 15 janvier 2026 \? La position en comptera 1/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Confirmer/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/portfolio/lots/1"));
  });

  it("surfaces a refused deletion rather than looking as though it worked", async () => {
    const { ApiError } = await import("../../lib/api");
    vi.spyOn(api, "delete").mockRejectedValue(new ApiError(404, "Lot introuvable."));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onChanged });

    await user.click(
      within(screen.getByTestId("yd-editor-lot-1")).getByRole("button", { name: /Supprimer/ }),
    );
    await user.click(screen.getByRole("button", { name: /Confirmer/ }));

    expect(await screen.findByText("Lot introuvable.")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("asks for an account first when there is none, since a position needs one", () => {
    renderEditor({ accounts: [], positions: [], lots: [] });
    expect(
      screen.getByText(
        /Aucun compte d'investissement : une position se déclare dans une enveloppe, alors commencez par en créer une/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajouter un compte/ })).toBeInTheDocument();
  });
});
