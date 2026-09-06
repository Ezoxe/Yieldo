import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import type { InvestmentAccount } from "../../lib/types";
import { AccountForm } from "./AccountForm";

const EXISTING: InvestmentAccount = {
  id: 4,
  name: "PEA Boursorama",
  kind: "pea",
  currency: "EUR",
  opened_on: "2019-04-01",
  archived: false, declared_value_cents: null, declared_value_on: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountForm", () => {
  it("declares an account through POST, with the kind the user chose", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(EXISTING);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<AccountForm onSaved={onSaved} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Nom du compte/), "PEA Boursorama");
    await user.selectOptions(screen.getByLabelText(/Type d'enveloppe/), "pea");
    await user.type(screen.getByLabelText(/Date d'ouverture/), "2019-04-01");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/portfolio/accounts", {
        name: "PEA Boursorama",
        kind: "pea",
        currency: "EUR",
        opened_on: "2019-04-01", declared_value_cents: null, declared_value_on: null,
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("amends an existing account through PATCH, prefilled with what it holds", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue(EXISTING);
    const user = userEvent.setup();
    render(<AccountForm account={EXISTING} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/Nom du compte/)).toHaveValue("PEA Boursorama");
    expect(screen.getByLabelText(/Date d'ouverture/)).toHaveValue("2019-04-01");

    await user.clear(screen.getByLabelText(/Nom du compte/));
    await user.type(screen.getByLabelText(/Nom du compte/), "PEA BoursoBank");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith("/portfolio/accounts/4", {
        name: "PEA BoursoBank",
        kind: "pea",
        currency: "EUR",
        opened_on: "2019-04-01", declared_value_cents: null, declared_value_on: null,
      });
    });
  });

  it("refuses an unnamed account at the field, and sends nothing", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Donnez un nom à ce compte, par exemple « PEA Boursorama » : c'est ce qui le distinguera de vos autres enveloppes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom du compte/)).toHaveAttribute("aria-invalid", "true");
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a currency that is not a three-letter code", async () => {
    const post = vi.spyOn(api, "post");
    const user = userEvent.setup();
    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Nom du compte/), "CTO");
    await user.clear(screen.getByLabelText(/Devise/));
    await user.type(screen.getByLabelText(/Devise/), "eu");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText(
        "Devise illisible : saisissez un code ISO de trois lettres, par exemple EUR ou USD.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("upper-cases the currency it sends, so eur and EUR are one code", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(EXISTING);
    const user = userEvent.setup();
    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Nom du compte/), "Kraken");
    await user.selectOptions(screen.getByLabelText(/Type d'enveloppe/), "crypto_exchange");
    await user.clear(screen.getByLabelText(/Devise/));
    await user.type(screen.getByLabelText(/Devise/), "usd");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/portfolio/accounts", {
        name: "Kraken",
        kind: "crypto_exchange",
        currency: "USD",
        opened_on: null, declared_value_cents: null, declared_value_on: null,
      });
    });
  });

  it("says what an undated PEA costs, without calling it an error", async () => {
    // `models/investment_account.py`: the PEA's five-year exemption counts
    // from the envelope's opening date. Undated it cannot be applied — that is
    // a consequence, not a refusal, and the form still saves.
    const post = vi.spyOn(api, "post").mockResolvedValue(EXISTING);
    const user = userEvent.setup();
    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/Type d'enveloppe/), "pea");
    expect(
      screen.getByText(/l'exonération au bout de 5 ans ne pourra pas être appliquée/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nom du compte/), "PEA");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it("carries no such warning for a CTO, which has no holding-period rule", async () => {
    const user = userEvent.setup();
    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/Type d'enveloppe/), "cto");
    expect(screen.queryByText(/exonération/)).not.toBeInTheDocument();
  });

  it("shows the backend's own refusal when it rejects the payload", async () => {
    const { ApiError } = await import("../../lib/api");
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(422, "Type de compte d'investissement inconnu : pea_pmee"),
    );
    const user = userEvent.setup();
    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/Nom du compte/), "PEA");
    await user.click(screen.getByRole("button", { name: /Enregistrer/ }));

    expect(
      await screen.findByText("Type de compte d'investissement inconnu : pea_pmee"),
    ).toBeInTheDocument();
  });
});
